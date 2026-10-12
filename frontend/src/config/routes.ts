export type BaseRoute = {
  path?: string;
  name?: string;
  icon?: string;
  type?: "group";
  hideInMenu?: boolean;
  routes?: BaseRoute[];
};

export type AdminSection = {
  key: string;
  name: string;
  icon: string;
  desc: string;
  /** 板块所需的最低角色（默认 10 平台管理员 / 100 超级管理员）；未达门槛不进侧栏，深链也判无权限。 */
  minRole?: number;
};

/** 租户管理板块：结构与 AdminSection 一致，只是门槛由「必须是当前租户的管理员」固定，不再分级。 */
export type ConsoleSection = {
  key: string;
  name: string;
  icon: string;
  desc: string;
};

export const ADMIN_PATH_PREFIX = "/admin";
export const CONSOLE_PATH = "/console";
/** 租户对平台的订购（下单 + 单据）在前台「设置」下的路径，下单资格 = 当前租户的管理员；平台管理员 / 超管看到的是全平台单据。 */
export const ORDERS_PATH = "/orders";

/**
 * 平台管理后台板块：侧栏菜单项 + 子路由（`/admin/<key>`）。
 * 菜单、顶栏标题、页面 hero 文案同源，新增板块只改这一处。
 * 分工口径：系统管理员管理租户，租户管理员在 /console 管理自家 User。
 * 门槛：额度换算、零售倍率、上游接入与开放注册是平台级参数，收在「模型设置」（minRole 100）。
 */
export const ADMIN_SECTIONS: AdminSection[] = [
  {
    key: "overview",
    name: "总览",
    icon: "dashboard",
    desc: "平台运行与用量总览：调用量、消耗额度、折算成本（元）、错误数与待办事项。",
  },
  {
    key: "tenants",
    name: "租户管理",
    icon: "shop",
    desc: "开通 / 停用租户、划拨与回收租户额度池，并下钻该租户的成员与管理员、软件权益与订购记录；把已有账号补加为该租户成员也在这里做。",
  },
  {
    key: "users",
    name: "账号管理",
    icon: "peoples",
    desc: "全平台账号检索与处置：一个账号可属于多个租户，在某个租户里各有一份额度与租户内权限（成员 / 管理员）。建号可指定归属租户，未归属＝平台直属，其额度由平台在这里分配；已归属账号的额度也在点名的租户里划拨。",
  },
  {
    key: "orders",
    name: "订单管理",
    icon: "order",
    desc: "租户购买软件产品与服务的订单：按单号 / 租户 / 商品名检索，待支付单可向支付平台核对到账，按已服务天数试算退款。",
  },
  {
    key: "payments",
    name: "支付管理",
    icon: "pay",
    desc: "在线支付（租户订阅软件 / 买断功能 / 额度包）：收款概览、渠道开关与凭据自检、商品与套餐配置。",
  },
  {
    key: "channels",
    name: "渠道管理",
    icon: "api",
    desc: "大模型上游渠道：优先级 + 权重选路、多密钥轮换、调用失败自动换渠道、模型重定向、连通性测试与自动禁用；可拉取上游模型清单并勾选入库价目表。",
  },
  {
    key: "tokens",
    name: "全部令牌",
    icon: "key",
    desc: "全部账号签发的 sk- 调用令牌：额度、模型白名单、IP 白名单与有效期。",
  },
  {
    key: "models",
    name: "价目表",
    icon: "chip",
    desc: "模型零售价：手工新增模型、按 token 或按次计价、补全/缓存倍率与模型倍率；被管理员钉住的定价可一键恢复目录价，非目录托管的行可删除。",
  },
  {
    key: "logs",
    name: "全平台日志",
    icon: "file-done",
    desc: "两块台账分列：调用日志按账号 / 租户 / 类型 / 模型 / 渠道 / 时间筛，含折算金额与计费快照（渠道、令牌删除后仍保留当时的归属）；额度流水是全平台成员额度变动台账，每一笔都看得出动谁的、记在哪个租户、由谁操作。",
  },
  {
    key: "settings",
    name: "模型设置",
    icon: "setting",
    desc: "模型接入与换算参数：AIPDD 目录接入向导与同步间隔、额度换算（1 元对应额度）、零售定价倍率、开放注册与注册赠送。渠道与模型本身在「渠道管理」新建、「价目表」新增。",
    minRole: 100,
  },
];

/**
 * 板块可见性的唯一判定：角色门槛由 `minRole` 声明（默认 10 = 平台管理员），
 * 侧栏、深链门控与「前往模型设置」类入口提示都走这里，口径不会分叉。
 */
export function adminSectionAllowed(
  item: AdminSection,
  isRoot: boolean,
): boolean {
  return (item.minRole ?? 10) <= (isRoot ? 100 : 10);
}

export function adminRouteFor(isRoot: boolean): BaseRoute {
  return {
    path: "/",
    routes: [
      {
        type: "group",
        name: "平台管理后台",
        routes: ADMIN_SECTIONS.filter((item) => adminSectionAllowed(item, isRoot)).map(
          (item) => ({
            path: `${ADMIN_PATH_PREFIX}/${item.key}`,
            name: item.name,
            icon: item.icon,
          }),
        ),
      },
    ],
  };
}

/**
 * 租户这一层的管理板块：路由 `/console/<板块>`，菜单项渲染在前台侧栏的「本租户管理」分组里。
 * 门槛是「当前租户的管理员」（`tenant_members.role = 5`），与全局身份无关：
 * 同一个人可以在 A 租户看到这组、在 B 租户看不到。
 * 对平台的订购不在这里：那是租户对平台的交易，收在前台「设置 → 订购管理」。
 */
export const CONSOLE_SECTIONS: ConsoleSection[] = [
  {
    key: "users",
    name: "用户管理",
    icon: "peoples",
    desc: "本租户的 User：建号、拉已有账号加入、启停、重置密码、设定租户内权限（成员 / 管理员），并从租户额度池划拨与回收额度。",
  },
  {
    key: "logs",
    name: "模型使用记录",
    icon: "audit",
    desc: "本租户全部 User 的模型调用与额度流水：模型、令牌、tokens 与折算金额；上游渠道与批发成本属平台侧，不在这里。",
  },
];

/**
 * 前台导航：租户底座交付给使用方的界面——
 * AI 服务（工作台 / 模型与价格 / 用量与额度）+ 本租户管理（用户管理 / 模型使用记录，仅本租户管理员）
 * + 设置（API 令牌 / 账号设置 / 订购管理）。
 * **一棵树按权限长内容**：租户管理员不再另切一棵管理树、也不在顶栏单开入口；
 * 他的管理动作就是前台侧栏里多出「本租户管理」这一组，切租户后按新租户里的角色重新决定显不显示。
 * 订购管理对「当前租户的管理员」与平台管理员 / 超管都可见：租户管理员在这里向平台下单，
 * 平台管理员 / 超管看到的是全平台订购记录；租户里的普通成员没有这一项（订购是租户对平台的交易，他不参与）。
 * 一个账号可以属于多个租户，切到哪个租户就是哪个租户的身份与额度——顶栏的租户切换器负责这件事。
 */
export function baseRouteFor(options: {
  canOrder: boolean;
  canManageTenant: boolean;
}): BaseRoute {
  const settingsRoutes: BaseRoute[] = [
    { path: "/keys", name: "API 令牌", icon: "key" },
    { path: "/account", name: "账号设置", icon: "idcard" },
  ];
  if (options.canOrder) {
    settingsRoutes.push({ path: ORDERS_PATH, name: "订购管理", icon: "order" });
  }
  const routes: BaseRoute[] = [
    {
      type: "group",
      name: "AI 服务",
      routes: [
        { path: "/", name: "工作台", icon: "dashboard" },
        { path: "/models", name: "模型与价格", icon: "chip" },
        { path: "/usage", name: "用量与额度", icon: "audit" },
      ],
    },
  ];
  // 非管理员不渲染这一组（不置灰）：分组下没有项时 withRouteIcons 会整组丢掉。
  // 组名取「本租户管理」而不是「租户管理」：后者是平台侧板块（开通 / 停用各家租户），同屏不能重名。
  if (options.canManageTenant) {
    routes.push({
      type: "group",
      name: "本租户管理",
      routes: CONSOLE_SECTIONS.map((item) => ({
        path: `${CONSOLE_PATH}/${item.key}`,
        name: item.name,
        icon: item.icon,
      })),
    });
  }
  routes.push({ type: "group", name: "设置", routes: settingsRoutes });
  return { path: "/", routes };
}

export const PAGE_META: Record<
  string,
  { title: string; description: string }
> = {
  "/": { title: "工作台", description: "当前租户给的额度余量、调用概览与快捷入口。" },
  "/models": {
    title: "模型与价格",
    description: "网关可路由的全部模型与计费口径。",
  },
  "/keys": {
    title: "API 令牌",
    description: "签发 sk- 密钥，供 OpenAI / Anthropic 兼容接口调用；令牌归属当前租户，切租户后换一个租户各管各的。",
  },
  "/usage": {
    title: "用量与额度",
    description: "当前租户给的额度余量、消耗流水与调用日志。",
  },
  "/account": {
    title: "账号设置",
    description: "账号资料、登录密码、所属租户与 Chandler.work 平台账号绑定。",
  },
  [ORDERS_PATH]: {
    title: "订购管理",
    description: "向平台订购软件能力：当前租户的管理员选购下单与自家单据，平台管理员 / 超管看全平台订购记录。",
  },
  [CONSOLE_PATH]: {
    title: "本租户管理",
    description: "管理本租户的 User 与本租户的模型使用记录。",
  },
  "/admin": {
    title: "平台管理后台",
    description: "租户、账号、渠道、令牌、计费、日志与模型设置。",
  },
  // 各板块标题 / 说明与侧栏菜单同源（ADMIN_SECTIONS / CONSOLE_SECTIONS），顶栏与页面 hero 直接取这里。
  ...Object.fromEntries(
    ADMIN_SECTIONS.map((item) => [
      `${ADMIN_PATH_PREFIX}/${item.key}`,
      { title: item.name, description: item.desc },
    ]),
  ),
  ...Object.fromEntries(
    CONSOLE_SECTIONS.map((item) => [
      `${CONSOLE_PATH}/${item.key}`,
      { title: item.name, description: item.desc },
    ]),
  ),
};
