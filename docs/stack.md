# 技术栈与系统边界

## 选型

| 层 | 选型 |
|---|---|
| 前端 | Next.js 16 + React 19 + TypeScript + Tailwind 4 |
| 界面组件 | Ant Design 6 + pro-components，页面版式走本仓自有的 panel / stat-card / TabStrip 样式类 |
| 后端 | NestJS 11 + TypeScript |
| ORM / 库 | Prisma 5 + SQLite（`file:./dev.db`，WAL 模式，零外部依赖）；MySQL / PostgreSQL 用派生的方言 schema 与 DDL |
| 鉴权 | 本系统自签发 JWT（HS256），账号表 + 成员表两个身份轴：全局角色阶梯与租户内权限两档 |
| 包管理 | pnpm workspace |

本地端口：前端 `15889`，后端 `1690`。后端不加全局前缀，路径前缀即权限边界（`/console/*` 租户、`/admin/*` 平台、`/v1/*` 对外网关）。前台页 `app/orders/`（订购管理）按身份门控渲染：当前租户的管理员或全局身份 ≥10 才见菜单，租户管理员走「软件订购 + 订购记录」，平台管理员 / 超管只走「订购记录」；取数按板块分——单据与商品走 `/pay/*`（`GET /pay/orders` 对 `isAdmin()` 返回全平台、对租户管理员从会话收口到本租户），租户概览走 `/console/overview`（仅租户管理员请求，平台直属账号没有当前租户、不取，避免 403）。本租户的普通成员深链进去只会看到「无访问权限」，不会拿到越界数据。

## 调用边界

| 能力 | 谁负责 |
|---|---|
| 注册 / 登录 / 刷新 / 改密 / 全局身份与成员关系（创建、加入、切换租户）/ 租户内额度 | 本系统 `auth` + `users` 模块，账号与成员数据在本库 |
| 租户开通与启停、额度池、开通租户管理员与补加成员、本租户管理（本租户成员 + 本租户使用记录，前台侧栏「本租户管理」分组） | 本系统 `tenants` 模块 |
| 模型目录、渠道选路、转发与计费 | 本系统 `gateway` 模块，上游按模板自由配置（AIPDD 受管只是其中一个来源），载荷形状覆盖 OpenAI / Anthropic 两类兼容协议 |
| 计费参数与功能开关 | 本系统 `settings` 模块（`settings` 键值表） |
| 联合登录与 B 端支付 | 外部平台 Chandler.work，`chandler` 模块做契约适配 |

浏览器不直连 Nest，一律走 Next BFF：`/api/backend/*` 转发业务接口（自动附带 httpOnly Cookie 中的访问令牌，令牌接近过期时先续签再转发），`/api/auth/*` 处理登录、注销与平台回调。

## 令牌与角色

- 访问令牌 24h、刷新令牌 30d，载荷 `{ uid, username, role, tenantId, type }`——`tenantId` 就是本次会话的当前租户（`0` = 不在任何租户内），签发方默认 `codingplan-base`。它只是提示，不是授权：每个请求由 `jwt-auth.guard.ts` 用 `pickActiveMembership()` 按成员表重新确认，这条成员关系被停用或被移除就退到该账号的第一个可用租户，全都没有则是无租户视角。切租户走 `POST /auth/tenants/switch` 重新签发一整套令牌，否则前端状态和服务端记账会分叉。
- `JwtAuthGuard` 的放行清单分两类：整条放行的只有健康检查、`/auth/login|register|refresh`、`/auth/chandler*`、`/pay/webhook`、`/install`；`/pay/products`、`/settings/public`、`/gateway/models` 是**只读**放行（`PUBLIC_GET_PATHS` + `request.method === 'GET'`）。同一句路径整条放行的话，写口子会跟着一起敞开，只剩处理函数里的 `requireAdmin` 兜底——那是运气，不是设计。
- 网关转发端点 `/v1/*`（`models`、`chat/completions`、`completions`、`embeddings`、`messages`）由 `RelayController` 自行校验 `sk-` 令牌，全局守卫放行。
- 全局身份 `users.role`：`1` 普通用户、`10` 平台管理员、`100` 超级管理员；`0` 是沿用 newapi 的保留常量，不可授予。可授予阶梯为 `[1, 10, 100]`：低角色不能授予高角色，超管账号只能由超管处置且系统至少保留一个超管。
- 租户内权限 `tenant_members.role`：`1` 成员、`5` 租户管理员，只有这两档（`assertMemberRole` 拒其他值）。它与全局身份是两个轴：同一个普通用户可以在 A 租户当管理员、在 B 租户只是成员，平台管理员也可以被补加进某个租户当成员；`users` 表已经没有 `tenant_id`，旧口径「角色 5 必须挂租户 / 角色 ≥10 必须平台直属」随之退场。
- 额度与用量按 `(tenantId, userId)` 各记一份：`tenant_members` 的 `quota` / `used_quota` / `request_count`，`tokens.tenant_id`、`logs.tenant_id`、`quota_txns.tenant_id`（`0` = 迁移前的历史数据）。平台的额度处置接口必须点名在哪个租户里给，没有成员关系就 404，不存在「给账号发额度」。
- 平台级参数按身份收口：`SettingsController` 用 `ADMIN_WRITABLE`（支付三键）区分——其余 `DEFAULTS` 键一律要求 `isRoot()`，并带数值/布尔边界校验；写「模型设置」的可见性只有一个口径，即 `ADMIN_SECTIONS[].minRole` + `adminSectionAllowed()`，侧栏 `adminRouteFor(isRoot)` 与 `/admin/[section]` 的深链门控共用它。
- 设置是整表内存缓存：`SettingsService` 首次读取时缓存全表，只有经 `set()`（即 `PUT /settings`）的改动会即时生效；直接改 `settings` 表要重启进程才会被读到，测试与运维脚本因此一律走接口改配置。
- 侧栏按「路径前缀 + 身份」在两棵树里选一：`pro-layout.tsx` 取 `isPlatformArea = 路径以 /admin 开头 && isAdmin` → `adminRouteFor(isRoot)`（平台管理后台），否则 `baseRouteFor({ canOrder, canManageTenant: isTenantAdmin })`（前台）。前台只有一棵树，租户这一层的管理板块直接长在树里的「本租户管理」分组上——`canManageTenant` 为假时整组不渲染（`withRouteIcons` 会丢掉没有子项的分组），不是置灰；顶栏没有「管理菜单」入口，也不换区。`canOrder` 是「全局身份 ≥10 或在这个租户里是管理员」，所以当前租户的管理员与平台管理员 / 超管都在「设置」里看到订购管理，本租户的普通成员看不到。管理员在前台就是调用方，所以后台板块名不能与前台近义撞名（`全部令牌`/`价目表`/`全平台日志` 对应前台 `API 令牌`/`模型与价格`/`用量与额度`）；前台的「本租户管理」也不能撞后台的「租户管理」（那是对各家租户开通/启停的平台侧板块）。换区时整棵菜单树被替换，而 ProLayout 只在挂载时按 `route` 生成侧栏，所以 `<ProLayout key={areaKey}>` 强制重挂一次，否则客户端跳转后顶栏和页面换了、侧栏还停在上一区。`areaKey` 还带上当前租户（`${platform|front}:${me?.tenantId ?? 0}`）：租户是记账上下文，切过去以后每个板块都要按新租户重新取数，重挂一次性做到，页面不必各自把租户 ID 加进取数依赖里。深链到不属于当前身份菜单树的路由时，`menuActivePath()` 把选中态退回该区域首栏；它只改选中态，不改地址栏，页面内容仍由各自的门控负责。
- 两棵树的顶层都是分组（`type: 'group'`），所以 ProLayout 固定传 `menu={{ type: 'group' }}`：默认的 `sub` 模式会把分组渲染成可折叠 submenu，只有命中当前路径的那一组自动展开，其余分组的子项根本不在 DOM 里——用户返回前台只看到一个光秃秃的「设置」标题，就以为菜单丢了。分组模式下子项常驻可见，标题不可折叠。

## 网关选路与失败处理

- 一次调用最多试 3 个渠道（`MAX_CHANNEL_ATTEMPTS`），失败渠道靠 `ChannelCacheService.select(group, model, exclude)` 排除后重新加权选路；同渠道内密钥级失败先换 key（`MAX_KEY_ATTEMPTS`）。这两个上限是刻意的小常数，改大等于让调用方多等一轮超时。
- 换渠道必须发生在往客户端写第一个字节之前：`!upstream.ok` 的分支才允许 `response.send`，流式响应一旦开始透传就不能再回头换渠道。
- 上游报文出后端前一律过 `redactKeys(text, channel.keys)`（透传响应、`type=5` 日志、渠道备注三处都是），渠道密钥任何时候不能进界面或日志；管理端的 `key` 字段也只回 `keyMasked` + `keyCount`。
- 上游路径与鉴权头只有一个来源：`gateway.constants.ts` 的 `channelProtocol()` / `normalizeApiPrefix()` / `upstreamPath()` / `joinBaseUrl()` / `upstreamAuthHeaders()`。连通性测试（`channels.service.ts`）与线上转发（`relay.service.ts`）都调这五个函数，不再按 `channel.type` 写路径分支——新供应商是加模板，不是加分支。
- 类型编号的合法集合就是 `channel-presets.ts` 里那些模板（`isKnownChannelType()`），提交陌生编号 `422`；前台「上游模板」下拉与类型列的中文名都取 `GET /gateway/channels/presets`，`lib/gateway.ts` 不再自带类型表。模板只给 OpenAI / Anthropic 两类兼容载荷，Azure、Gemini 原生、Cohere、Bedrock 等请求体形状不同的源要的是协议适配器，因此不进模板。
- 「从上游拉取模型」只认已保存渠道的 id（`POST /gateway/channels/:id/fetch-models`）：Base URL 与密钥都从库里读，浏览器不出上游凭据，管理端填的地址不会变成出网目标；路径由同一个 `api_prefix` 派生（`{prefix}/models`），模板里因此没有独立的 `modelsPath` 字段；错误报文过 `redactKeys`。
- 价目表的写口子（`ModelsController`，全部 `requireAdmin`）：`POST /gateway/models` 手工新增一行（`priceSource: manual`，名字去空白后必填、≤120 字符，重名 `CONFLICT`「已在价目表里，请直接改定价」，数值经 `num()` 收成非负有限数）；`POST /gateway/models/import` 把上游清单勾选入库（`{ channelId, names }`，去重后 `createMany` 成 `priceSource: auto` / 倍率 0，同时把名字并进 `channel.models` 并在有变化时 `refreshCache()`——只写价格不写渠道清单的话选路选不到渠道）；`DELETE /gateway/models/:id` 委托 `catalog.remove()`，被目录托管的名字拒删。
- 「这行能不能删」是**服务端算出来的**：`GET /gateway/models` 每行带 `deletable = !managed.has(modelName)`，`managedNames()` 从 `CatalogSnapshot.payload` 解析。界面据此渲不渲染删除按钮（不置灰），而不是前端拿 `priceSource` 猜——猜错就是点一下必然 409。同理「恢复目录价」只在 `manual` 且真被目录托管的行出现。
- 生效中的前缀随渠道缓存行一起进内存（`CachedChannel.apiPrefix`，缺省兜底 `/v1`），改前缀走 `refreshCache()`，下一笔调用立即按新路径转发，不需要重启。

- 令牌 IP 白名单的规则也只有一个来源：`gateway.constants.ts` 的 `parseIpRules()`（切分/去空白）、`ipMatches()`（`*` / 精确 / IPv4 CIDR 掩码运算 / 前缀通配）、`findInvalidIpRule()`（点名句式）。`relay.service.ts` 用它们判来源，`tokens.service.ts` 在建/改时先 `findInvalidIpRule` 再入库——校验与判定共用同一套式子，不会出现「界面说支持 CIDR、后端只认前缀」这种口径漂移。前端 `lib/gateway.ts` 的 `findInvalidIpRule()` + `ipRulesRule()` 只给即时红字，服务端 422 才是最终判定。
- 令牌有效式的收口在 `tokens.service.ts`：`normalizeExpiredAt()` 把非正数一律收成 `-1`，所以 `expiredAt=0`（1970＝立刻过期）不可能出现，界面上的「永不过期」与网关的判定是同一件事。
- 额度换算比例的读法：`GET /gateway/wallet` 里的 `quotaPerUnit` 对任何登录用户开放（`/settings` 是管理员专属），因此前台「API 令牌」、后台「全部令牌」的表单提示与步进、后台「全平台日志」的 `≈ ¥` 金额行都经 `lib/quota.ts` 的 `useQuotaPerUnit()` 取同一个值，改设置即生效，不需要在每个页面各配一份。

## API 约定

```json
{ "code": 0, "message": "ok", "data": {} }
```

分页：`{ list, total, page, pageSize }`。业务错误用 `BusinessException(ErrorCode, message)`，HTTP 状态与业务码分离，前端只认 `code`。

### 平台全量台账：`all=1` 只有一个口径

`GET /gateway/logs?all=1` 与 `GET /gateway/wallet/txns?all=1` 是同一个形状：不带 `all` 时只看「我在这个租户里」的记录，带 `all=1` 时看全平台，但 `all` 是否生效由**服务端**再判一次 `user.isAdmin()`（界面不渲染入口不算收口）——非管理员带 `all=1` 不会 403，而是退回到自己的那份记录，同一句查询串换个人用只是范围变小，不会报错也不会多给。全量视图独有的筛选（`tenantId`、`channelId`）在非全量分支直接忽略，租户侧的取数不会被查询串里的参数扩大。

- `tenantId=none` 与 `tenantId=0` 同义：迁移前的历史数据与平台直属账号，界面上叫「无租户」，不能因为 `0` 是假值就在筛选里消失。
- 两个接口都在分页结果外多返回一个服务端聚合值：日志是 `_sum.quota`（合计消耗），流水是 `_sum.delta`（净变动）。页脚合计因此与换页无关，也不是当前页相加。
- 流水的全平台台账是 `users.service.ts` 的 `quotaTxnLedger()`：`findMany` + `count` + `aggregate` 并发，再按行内的 `userId` / `operatorId` / `tenantId` 批量补名字（一次 `user.findMany` 兼带操作人，一次 `tenant.findMany`），不在循环里查库。`operatorId=0` 是系统自动记账，前端显示「系统」。
- 日志的 `keyword` 是 `OR` 三列（`modelName` / `tokenName` / `username`），流水的 `keyword` 是 `OR` 三列（用户账号名 / 显示名 / `note`）；SQLite 的 `contains` 走 LIKE，中文可用，前提是请求真的以 UTF-8 发出（Git Bash 下 curl 的 `--data-urlencode` 会按本地码页编码，测中文关键词要自己百分号编码）。
- 时间维度统一是「最近 N 天」（`days`，1–365，越界忽略）：前端没有 dayjs，不引入日期选择器。
