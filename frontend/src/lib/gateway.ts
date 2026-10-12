/** 与后端网关契约同源的展示层常量与换算（金额口径：quota ÷ quotaPerUnit = 元）。 */

/** 对外调用地址：网关由后端直接提供，部署时按公开域名覆盖 NEXT_PUBLIC_GATEWAY_URL。 */
export const GATEWAY_BASE_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL || "http://127.0.0.1:1690";

/**
 * 渠道类型不再在前端硬编码：编号沿用 new-api，名称、默认地址与路径前缀由后端
 * `/gateway/channels/presets` 下发（见 ChannelPreset），避免两处编号各改各的。
 */

export const CHANNEL_STATUS_LABEL: Record<number, string> = {
  0: "未知",
  1: "启用",
  2: "手动禁用",
  3: "自动禁用",
};

export const CHANNEL_STATUS_VARIANT: Record<number, string> = {
  0: "gray",
  1: "green",
  2: "orange",
  3: "red",
};

export const ROLE_LABEL: Record<number, string> = {
  0: "受限用户",
  1: "租户用户",
  10: "平台管理员",
  100: "超级管理员",
};

export const ROLE_VARIANT: Record<number, string> = {
  0: "gray",
  1: "blue",
  10: "violet",
  100: "green",
};

/**
 * 租户内权限（tenant_members.role）：全局身份里没有「租户管理员」这一档，
 * 它是某个人在某租户内的角色，切了租户就是另一个角色。
 */
export const MEMBER_ROLE_LABEL: Record<number, string> = {
  0: "不是本租户成员",
  1: "成员",
  5: "管理员",
};

export const MEMBER_ROLE_VARIANT: Record<number, string> = {
  0: "gray",
  1: "blue",
  5: "green",
};

/** 成员身份概览：会话视图与账号列表的 tenants[] 同源。 */
export type TenantBrief = {
  id: number;
  name: string;
  code: string;
  /** 租户本身的状态；账号列表的下钻视图不带这一列。 */
  status?: number;
  memberRole: number;
  memberStatus: number;
  quota: number;
  usedQuota: number;
  requestCount: number;
  joinedAt: string;
};

/**
 * 账号行（后端账号列表同源）：平台侧「账号管理」与租户侧「用户管理」共用一份形状。
 * 额度 / 用量 / 租户内权限都记在成员身份上，只有按租户筛时后端才回这些列；
 * 未筛归属时它们缺省，界面按「不落在任何租户」处理。
 */
export type AccountRow = {
  id: number;
  username: string;
  displayName: string;
  role: number;
  status: number;
  email: string;
  userGroup: string;
  affCode: string;
  chandlerLinked: boolean;
  lastLoginAt: number;
  createdAt: string;
  tenantCount: number;
  tenants: TenantBrief[];
  quota?: number;
  usedQuota?: number;
  requestCount?: number;
  memberRole?: number;
  memberStatus?: number;
};


export type AccountPage = {
  list: AccountRow[];
  total: number;
  page: number;
  pageSize: number;
};

/** 日志类型（LOG_TYPE）：界面只展示用户看得懂的口径。 */
export const LOG_TYPE_LABEL: Record<number, string> = {
  0: "其他",
  1: "充值",
  2: "调用消耗",
  3: "管理调整",
  4: "系统",
  5: "调用失败",
  6: "退款",
};

export const LOG_TYPE_VARIANT: Record<number, string> = {
  0: "gray",
  1: "green",
  2: "blue",
  3: "violet",
  4: "gray",
  5: "red",
  6: "orange",
};

/** quota → 元（保留 4 位，网关计费口径）。 */
export function quotaToCny(quota: number, perUnit: number) {
  if (!perUnit) return 0;
  return Number((Number(quota || 0) / perUnit).toFixed(4));
}

/** 千分位整数额度展示。 */
export function quotaText(value: number) {
  return Math.trunc(Number(value || 0)).toLocaleString("zh-CN");
}

/** 元金额展示：网关折算保留 4 位小数。 */
export function cnyText(value: number) {
  return `¥${Number(value || 0).toFixed(4)}`;
}

/** 支付金额展示：订单以「分」存储，界面统一按元两位小数。 */
export function fenText(fen: number) {
  return `¥${(Number(fen || 0) / 100).toFixed(2)}`;
}

/** 秒级时间戳（后端 expiredAt / accessedAt 用秒，-1 表示永不过期）。 */
export function epochText(seconds: number) {
  if (!seconds || seconds < 0) return "永不过期";
  return new Date(seconds * 1000).toLocaleString("zh-CN", { hour12: false });
}

export type ChannelRow = {
  id: number;
  type: number;
  name: string;
  keyMasked: string;
  keyCount: number;
  baseUrl: string;
  apiPrefix: string;
  models: string;
  group: string;
  priority: number;
  weight: number;
  status: number;
  autoBan: number;
  modelMapping: string;
  paramOverride: string;
  headerOverride: string;
  otherSettings: string;
  testModel: string;
  responseTime: number;
  balance: number;
  usedQuota: number;
  tag: string;
  remark: string;
  isManaged: number;
  createdAt: string;
};

/** 上游标准模板（后端 channel-presets 同源）：选它即带出类型编号、默认地址与路径前缀。 */
export type ChannelPreset = {
  key: string;
  type: number;
  nameZh: string;
  nameEn: string;
  protocol: "openai" | "anthropic";
  baseUrl: string;
  apiPrefix: string;
  keyHint?: string;
  website: string;
  creatable: boolean;
};

export type TokenRow = {
  id: number;
  userId: number;
  keyMasked: string;
  key?: string;
  name: string;
  status: number;
  remainQuota: number;
  unlimitedQuota: boolean;
  usedQuota: number;
  modelLimitsOn: boolean;
  modelLimits: string;
  allowIps: string;
  expiredAt: number;
  group: string;
  createdAt: string;
  accessedAt: number;
};

export type ModelRow = {
  id: number;
  modelName: string;
  description: string;
  tags: string;
  vendorName: string;
  quotaType: number;
  modelRatio: number;
  completionRatio: number;
  cacheReadRatio: number;
  cacheWriteRatio: number;
  callCnyPrice: number;
  enableGroups: string;
  groupRatio: number;
  priceSource: string;
  endpoints: string;
  multimodal: boolean;
  priceCnyPerMIn: number;
  priceCnyPerMOut: number;
  /** 目录快照里没有这个模型（手工新增 / 上游入库 / 首次调用自动补）才可删；服务端仍做最终判定。 */
  deletable?: boolean;
};

/**
 * 价目表「大约花多少」预览：与后端 `billing.cnyCost()` 同一条公式，前端不再另算一套。
 * 按 token 的模型按「1K 输入 tokens」这一档折算并乘模型倍率；
 * 按次固定价就是标价本身，后端不乘倍率，这里也不乘。
 */
export function previewQuota(row: ModelRow, perUnit: number) {
  const cny =
    row.quotaType === 1
      ? row.callCnyPrice
      : ((1000 * row.modelRatio) / 1_000_000) * row.groupRatio;
  return Math.max(0, Math.round(cny * perUnit));
}

export type LogRow = {
  id: number;
  userId: number;
  /** 这笔消耗记在哪个租户里（平台全量视图附带）；0 = 无租户。 */
  tenantId?: number;
  tenantName?: string;
  type: number;
  content: string;
  username: string;
  tokenName: string;
  modelName: string;
  quota: number;
  promptTokens: number;
  completionTokens: number;
  useTime: number;
  isStream: boolean;
  channelId: number | null;
  channelName: string;
  tokenId: number | null;
  group: string;
  ip: string;
  requestId: string;
  other: string;
  createdAt: string;
};

/**
 * 租户侧可见的使用记录：接口不返回渠道归属与计费快照（`other` 里有批发价与毛利），
 * 上游渠道与利润是平台侧口径，不给租户看。
 */
export type ConsoleLogRow = Omit<
  LogRow,
  "channelId" | "channelName" | "tokenId" | "other"
>;

export type QuotaTxnRow = {  id: number;
  userId: number;
  /** 这笔流水记在哪个租户的成员身份上（0＝没有租户归属）。 */
  tenantId: number;
  type: string;
  delta: number;
  quotaAfter: number;
  operatorId: number;
  note: string;
  createdAt: string;
};

export const TXN_TYPE_LABEL: Record<string, string> = {
  TOPUP: "充值",
  ALLOCATE: "管理分配",
  DEDUCT: "管理扣减",
  REFUND: "退款",
  SIGNIN: "签到",
};

/** 租户订购软件后形成的租户权益（订阅 / 功能买断）。 */
export type EntitlementRow = {
  id: number;
  tenantId: number;
  productId: string;
  name: string;
  kind: string;
  expiresAt: number;
  enabled: number;
  createdAt: string;
  active?: boolean;
  tenantName?: string;
  tenantCode?: string;
};

/** 权益类型：与商品类型同口径，界面不露裸枚举。 */
export const ENTITLEMENT_KIND_LABEL: Record<string, string> = {
  subscription: "订阅",
  feature: "功能买断",
};

export type OrderRow = {
  id: number;
  userId: number;
  tenantId: number | null;
  merchantOrderNo: string;
  platformOrderNo: string;
  productType: string;
  productId: string;
  /** 商品展示名：按当前商品目录回显，目录里没有时退回商品编码。 */
  productName: string;
  amountFen: number;
  quotaGranted: number;
  serviceDays: number;
  status: string;
  tradeType: string;
  paidAt: number;
  refundedFen: number;
  createdAt: string;
};

/** 平台侧订单视图：附带归属租户与下单人账号，便于按租户核对。 */
export type AdminOrderRow = OrderRow & {
  username: string;
  userDisplayName: string;
  tenantName: string;
  tenantCode: string;
};

/** 租户（Tenant）＝平台交付给 B 端客户的独立工作区，拥有自己的 User 与额度池。 */
export type TenantRow = {
  id: number;
  name: string;
  code: string;
  contact: string;
  status: number;
  quotaPool: number;
  usedQuota: number;
  expiresAt: number;
  remark: string;
  createdAt: string;
  /** 该租户的成员数（列表与下钻详情都带回）。 */
  memberCount?: number;
  entitlements?: EntitlementRow[];
};

export type TenantOption = { id: number; name: string; code: string };

/** 租户概览（本租户管理 / 订购管理共用）：额度池余量 + 池内已分配 / 已消耗 + 本租户的软件权益。 */
export type ConsoleOverview = TenantRow & {
  /** 本租户成员数与其中的管理员数（租户内权限两档）。 */
  memberCount: number;
  adminCount: number;
  allocatedQuota: number;
  consumedQuota: number;
  entitlements: EntitlementRow[];
};

/** 租户额度池流水（TenantQuotaTxn）：note 是当时动作用的说明，delta 正负即方向。 */
export type TenantPoolTxnRow = {
  id: number;
  tenantId: number;
  delta: number;
  quotaAfter: number;
  operatorId: number;
  note: string;
  createdAt: string;
};

export const POOL_TXN_LABEL: Record<string, string> = {
  ALLOCATE: "平台划拨",
  DEDUCT: "平台回收",
  TOPUP: "订购到账",
  RECLAIM: "租户内回收",
  REFUND: "退款回收",
};

/** 池流水说明：后端没写备注时会落动作枚举，界面统一翻成中文，不露裸枚举。 */
export function poolTxnText(note: string) {
  return POOL_TXN_LABEL[note] || note || "—";
}

export type RefundRow = {
  id: number;
  orderId: number;
  merchantRefundNo: string;
  amountFen: number;
  status: string;
  reason: string;
  createdAt: string;
};

export type OrderDetail = AdminOrderRow & {
  prepayInfo: unknown;
  raw: unknown;
  /** 「向支付平台核对」后的结论，只有带 ?reconcile=1 时才有。 */
  reconcileNote?: string;
  remainingFen: number;
  buyer: {
    id: number;
    username: string;
    displayName: string;
    role: number;
    quota: number;
  } | null;
  refunds: RefundRow[];
  entitlement: EntitlementRow | null;
};

export type RefundPreview = {
  merchantOrderNo: string;
  productType: string;
  amountFen: number;
  refundedFen: number;
  remainingFen: number;
  servedDays: number;
  daysTotal: number;
  suggestedRefundFen: number;
  note: string;
};

export type PaySummary = {
  days: number;
  orderCount: number;
  paidCount: number;
  paidFen: number;
  grantedQuota: number;
  refundedFen: number;
  pendingCount: number;
  activeEntitlements: number;
  recentPaidCount: number;
  recentPaidFen: number;
  byStatus: { status: string; count: number; amountFen: number }[];
  byProductType: {
    productType: string;
    count: number;
    amountFen: number;
    refundedFen: number;
  }[];
  /** 每个商品的历史单据（全时段、全状态）：删除商品时用来告诉管理员有没有人在用。 */
  productUsage: {
    productId: string;
    orderCount: number;
    pendingCount: number;
    paidCount: number;
  }[];
};

export type PayStatus = {
  enabled: boolean;
  baseUrl: string;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasApiKey: boolean;
  productCount: number;
  /** 后端判定「可下单」的商品 ID：价格大于 0、ID 不重复。表格里不在其中的行标「不可下单」。 */
  orderableIds: string[];
  /** 商品目录原始行（由后端统一归一，界面不再自己解析配置串）。 */
  products: PayProduct[];
  webhookPath: string;
};

export type PayProduct = {
  id: string;
  name: string;
  type: string;
  amountFen: number;
  quota: number;
  serviceDays: number;
};

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: "待支付",
  PAID: "已支付",
  FULFILLED: "已履约",
  REFUNDED: "已退款",
  CLOSED: "已关闭",
  FAILED: "失败",
};

/** 退款单状态：本站只记录「已提交」，成功/失败由平台回调或对账确认。 */
export const REFUND_STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "已提交",
  SUCCEEDED: "已退款",
  FAILED: "退款失败",
};

export const ORDER_STATUS_VARIANT: Record<string, string> = {
  PENDING: "orange",
  PAID: "blue",
  FULFILLED: "green",
  REFUNDED: "violet",
  CLOSED: "gray",
  FAILED: "red",
};

export const PRODUCT_TYPE_LABEL: Record<string, string> = {
  subscription: "订阅",
  feature: "功能买断",
  quota: "额度包",
};

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

function isIpv4(value: string) {
  return IPV4_PATTERN.test(value) && value.split(".").every((part) => Number(part) <= 255);
}

/** 与后端 `gateway.constants.ts` 的 `findInvalidIpRule()` 同口径：返回第一条无法匹配的写法。 */
export function findInvalidIpRule(raw: string): string | null {
  for (const rule of raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)) {
    if (rule === "*") continue;
    if (rule.includes("/")) {
      const [network, prefix] = rule.split("/");
      if (isIpv4(network) && /^\d{1,2}$/.test(prefix) && Number(prefix) <= 32) continue;
      return rule;
    }
    if (rule.endsWith("*")) {
      const head = rule.slice(0, -1);
      if (head === "" || /^[\d.]+$/.test(head)) continue;
      return rule;
    }
    if (isIpv4(rule)) continue;
    // IPv6 只参与精确匹配（后端不做 v6 段运算）
    if (rule.includes(":") && /^[0-9a-fA-F:]+$/.test(rule)) continue;
    return rule;
  }
  return null;
}

/** IP 白名单的表单校验：填了匹配不上的写法，线上只会报「来源 IP 不在白名单内」，看不出是笔误。 */
export function ipRulesRule() {
  return {
    validator: (_: unknown, value?: string) => {
      const bad = findInvalidIpRule(value || "");
      return bad
        ? Promise.reject(
            new Error(`「${bad}」无法匹配：只支持 * 、精确 IPv4/IPv6、CIDR 网段（如 5.6.7.0/24）、前缀通配（如 10.0.*）`),
          )
        : Promise.resolve();
    },
  };
}
