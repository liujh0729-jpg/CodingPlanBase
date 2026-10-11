# Chandler.work 整合说明

本文是底座接入 Chandler.work（OAuth 联合登录 + B 端支付）的契约与实测结论汇总，对应代码在 `backend/src/chandler/`、`frontend/src/app/api/auth/chandler/`、`frontend/src/app/account/`、`frontend/src/app/console/`、`frontend/src/app/orders/`。平台自身的接口定义以其官方文档为准。

支付场景定位：B 端付费，即**租户**向本底座订阅软件、买断某个功能、购买额度包；不是 C 端内容消费或分账结算。付款动作由该租户的管理员（在这个租户的 `tenant_members.role = 5`，不是某个全局角色）发起，订单归属写在 `payment_orders.tenant_id`。

> 名词提醒：本文第 2 节里的「租户守卫」是 **Chandler 平台侧**的概念（调用者是否属于该 OAuth 应用所在的租户），与本底座的 `Tenant` 表无关。本底座里说「租户」一律指 `tenants` 表那一层。

## 1. 身份与鉴权模型

平台侧有三类身份，接口按身份守卫：

- **终端用户**：C 端买家，持 Bearer 会话令牌。访问令牌几小时过期，刷新令牌会因新登录轮换而失效。
- **应用成员**：在控制台被加入某个 OAuth 应用（client）的账号，角色 `owner` / `admin` / `developer` / `finance`。下单、退款等敏感接口按此角色守卫。
- **合作伙伴**：拥有应用、配置收款渠道（直连商户 / 特约商户）的主体。

| 方式 | 形式 | 用于 |
|---|---|---|
| Bearer | `Authorization: Bearer <用户访问令牌>` | 联合登录、用户态接口、预支付 |
| Apikey | `Authorization: Apikey <平台 API Key>` | 服务端下单、退款 |

服务端到服务端的调用一律用 Apikey，且该 API Key 所属账号必须对目标应用持 `owner` / `admin` / `finance` 角色，否则守卫照样拦截。

## 2. 接口鉴权决策表

| 动作 | 守卫 | 正确鉴权 |
|---|---|---|
| 下单 | 应用成员 + 租户守卫；终端用户令牌一律 404 `client.not_found` | Apikey |
| 预支付 | 无角色守卫，按调用者身份定位付款人（JSAPI 查 openid） | 付款人令牌（由服务端保存后代签） |
| 查单 | 公开（订单号即能力） | 可不带 |
| 退款（合作伙伴侧，记录即执行） | `owner` / `admin` / `finance` | Apikey |
| webhook 验签 | — | HMAC key = `sha256_hex(client_secret)`，对**原始请求体**计算 |

**要点：下单和退款永远不要用终端用户令牌；预支付必须用付款人身份。** 底座的做法是联合登录时把平台访问令牌写入 `users.chandler_token`（仅服务端可读），预支付时由后端取用，浏览器全程接触不到。

## 3. 坑点清单

1. 下单 404 `client.not_found` 不等于 `client_id` 配错，而是租户守卫命中：调用者不是应用成员。现象是「老账号能付、新注册用户全灭」。先确认账号在目标应用里的角色，再查配置。
2. 退款 400 `malformed JSON body` 多半不是 JSON 坏了，而是 body 带了平台不认识的字段（例如 `client_id`）被严格解析模式拒掉。平台的错误文案与真实原因经常对不上，别按字面猜。
3. 平台没有「金额缺省＝全额退款」语义，必须显式传正数；「全额退」由调用方先解析成订单全额再下发。
4. 下单 body 里应用标识字段名是 `application_id`（值为 OAuth `client_id`），支付配置与退款接口才用 `client_id`，两者别混。
5. 幂等：下单带 `Idempotency-Key`（底座复用 `merchant_order_no`），退款用 `refund-<merchant_order_no>`；重试与 webhook 重放都靠它兜底。
6. 刷新令牌：授权码模式之外要走平台专门的刷新端点，且刷新令牌可能已因新登录被轮换。业务侧必须把刷新的 4xx 映射成「请重新授权登录」（本系统返回 `CONFLICT` 并引导重绑），而不是笼统的「平台暂时不可用」。
7. 回调地址（`notify_url`）必须指向当前部署域名。换域名忘了改的结果是：用户已付款、平台已通知，但通知打到旧地址，本站永远不履约。
8. 微信 Native 的 `code_url` 只能扫码；支付宝返回的是可新窗口打开的支付链接。JSAPI（小程序内拉起）要求支付配置里的 `app_id` 与小程序 APPID 完全一致，否则预支付直接 400。
9. 直连商户模式需要平台侧确认线下合同后才可开通，未开通时下单返回 409；特约商户模式不受这个门控影响。

## 4. 本系统的落库形态

- `PaymentOrder`：`tenantId`（归属主体，取下单人**会话里的当前租户**，不是账号上的某个字段）、`userId`（经手下单并付款的、该租户的管理员）、`merchantOrderNo`（幂等键）、`platformOrderNo`、`productType`（`subscription` / `feature` / `quota`）、`amountFen`、`quotaGranted`、`serviceDays`、`status`、`tradeType`、`paidAt`、`refundedFen`。
- 履约落到租户：订阅与功能买断写 `tenant_entitlements`（`(tenantId, productId)` 唯一），订阅同时把 `Tenant.expiresAt` 往后顺延（只延长，不缩短既有服务期）；额度包把 `quotaGranted` 计入 `Tenant.quotaPool` 并写一条 `tenant_quota_txns`，不产生权益行。租户再从池里分给自家成员（`tenant_members.quota`）。
- 下单入口在前台「设置 → 订购管理」：当前租户的管理员才看得到「软件订购」页签并能下单（平台管理员 / 超管的前台也有这个菜单，但只有全平台「订购记录」）。其中「订购记录」页签只读（可继续支付、可主动查单对账，不能自助退款）。平台侧「订单管理」负责检索、详情、试算与退款。
- 商品清单在「管理后台 → 支付管理 → 商品与套餐」里增量维护（存 `settings.chandler_products`，JSON 数组：`id` / `name` / `type` / `amountFen` / `quota` / `serviceDays`），只有 `amountFen > 0` 且有 `id` 的条目会展示给租户。金额一律以人民币计，`amountFen` 为分。
- 平台侧接口（均需管理员）：`GET /admin/orders`（按单号 / 租户 / 商品 / 下单人 / 状态 / 类型检索）、`GET /admin/orders/:no`（订单 + 退款记录 + 租户权益 + 平台留档报文）、`GET /admin/orders/:no/refund-preview`（只读试算）、`POST /admin/orders/:no/refund`（执行退款）、`GET /admin/pay/status`（凭据自检，只报有无）、`GET /admin/pay/summary`（收款概览）。界面在「订单管理」与「支付管理」两个板块。
- 租户侧接口（当前租户的管理员）：`GET /pay/orders` 只返回会话所属租户的订单；租户 ID 由服务端从会话推出，不接受入参。本租户的普通成员、以及没有当前租户的账号访问都会被 `requireTenant` 拒（成员 20002、无租户 403）。下单同样过 `purchaserTenant`：租户被平台停用时报「租户已停用，无法订购」。
- 开关关闭时，`/auth/chandler/*` 与 `/pay/*` 全部拒绝，账户页与订购管理的订购区块显示「未开通在线支付」，额度改由平台划拨。

## 5. 支付体验

- 平台 webhook 可能延迟（实测有分钟级），所以前端在支付弹窗里轮询订单状态，后端对超时仍为待支付的订单主动查单对账；对账命中已支付即直接履约，与 webhook 共用同一个幂等履约函数。
- 错误文案要给行动指引：「登录态已失效，请重新授权后再支付」能解决问题，「支付平台暂时不可用」只会产生工单。4xx 是用户可自助修复的，5xx 才是平台侧故障。

## 6. 上线前验收清单

mock 掉平台边界的单测全绿不等于线上能跑——租户守卫、金额语义、严格字段解析这三类问题都在真实链路上才暴露。开通支付前逐条走一遍：

- [ ] 用「新绑定平台身份的租户管理员」下单 → 能出收款码（这正是坑点 1 的场景：账号不是应用成员时一律 404）
- [ ] 小额实付 → webhook 到账 → 租户权益续期或额度池增加，金额与商品配置一致
- [ ] 支付完成后页面 10 秒内显示成功（轮询 + 对账生效）
- [ ] 管理端发起退款 → 平台退款成功 → 权益回收或额度扣减
- [ ] 重放退款 webhook → 幂等跳过，不重复扣减
- [ ] 用已失效的绑定令牌发起预支付 → 返回引导重新授权的提示，而不是 502

## 7. 凭证清单

| 环境变量 | 用途 | 来源 |
|---|---|---|
| `CHANDLER_CLIENT_ID` / `CHANDLER_CLIENT_SECRET` | OAuth 客户端；secret 的 sha256 兼作 webhook 验签 key | 控制台创建应用时签发，secret 只显示一次 |
| `CHANDLER_API_KEY` | 服务端下单与退款（Apikey 鉴权） | 控制台个人中心，账号需 `owner` / `admin` / `finance` |
| `CHANDLER_BASE_URL` | 平台地址 | 按部署环境配置 |

凭据只从环境变量读取，管理界面不提供输入框，日志与接口响应不回显。

## 8. 排查顺序

1. 先看服务端日志里平台调用的 HTTP 状态码与平台错误码。
2. 文案与现象对不上时，优先怀疑守卫与字段 schema，而不是配置值。
3. 怀疑配置前先排除守卫：同一 `client_id` 下换个应用成员账号能通，说明配置没错。
4. 订单卡在待支付：确认 `notify_url` 指向当前域名，再用查单接口对账。
