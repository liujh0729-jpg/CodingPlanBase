import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { UsersService } from '../users/users.service';
import { TenantsService } from '../tenants/tenants.service';
import {
  CurrentUser,
  MEMBER_ROLE_ADMIN,
  ROLE_ADMIN,
} from '../auth/current-user';
import { verifyToken } from '../auth/jwt';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { maskKey } from '../gateway/gateway.constants';
import { text } from '../common/api';

export type ProductType = 'subscription' | 'feature' | 'quota';

export type OrderFilters = {
  keyword?: string;
  status?: string;
  productType?: string;
  userId?: number;
  tenantId?: number;
};

/**
 * 订单查询范围：null = 全平台（平台管理员视图）；tenantId = 某租户的订购记录；
 * userId = 单个下单人。关键字覆盖本站单号、平台单号、商品（下单时留档的商品名与商品 ID）、
 * 租户名称/编码与下单人账号。
 */
function orderWhere(
  scope: { tenantId?: number; userId?: number } | null,
  filters: OrderFilters,
  productNameIds: string[],
): Prisma.PaymentOrderWhereInput {
  const keyword = (filters.keyword || '').trim();
  return {
    ...(scope || {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.productType ? { productType: filters.productType } : {}),
    ...(keyword
      ? {
          OR: [
            { merchantOrderNo: { contains: keyword } },
            { platformOrderNo: { contains: keyword } },
            { productId: { contains: keyword } },
            ...(productNameIds.length
              ? [{ productId: { in: productNameIds } }]
              : []),
            { tenant: { name: { contains: keyword } } },
            { tenant: { code: { contains: keyword } } },
            { user: { username: { contains: keyword } } },
            { user: { displayName: { contains: keyword } } },
          ],
        }
      : {}),
  };
}

export interface ChandlerProduct {
  id: string;
  name: string;
  type: ProductType;
  amountFen: number;
  quota?: number;
  serviceDays?: number;
}

/**
 * chandler.work 平台客户端（B 端支付：订阅软件、购买功能、额度包）。
 * 鉴权约定（实测结论，勿混用）：
 * - 下单 /v1/pay/orders、退款 /v1/me/refunds：`Authorization: Apikey <平台 API Key>`；
 *   终端用户 token 会被租户守卫拦成 404 client.not_found
 * - 预支付 prepay：终端用户 Bearer token（平台按调用者身份定位付款人）
 * - 查单 GET /v1/pay/orders/{no}：公开（订单号即能力）
 * - webhook 验签 key = sha256_hex(client_secret)，不是 secret 本身
 */
@Injectable()
export class ChandlerService {
  private readonly logger = new Logger(ChandlerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly users: UsersService,
    private readonly tenants: TenantsService,
  ) {}

  async enabled(): Promise<boolean> {
    return this.settings.getBool('chandler_enabled');
  }

  private async assertEnabled() {
    if (!(await this.enabled())) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '未开通在线支付');
    }
  }

  private async config() {
    const baseUrl = (
      process.env.CHANDLER_BASE_URL ||
      (await this.settings.get('chandler_base_url')) ||
      'https://app.chandler.work'
    ).replace(/\/$/, '');
    return {
      baseUrl,
      clientId: String(process.env.CHANDLER_CLIENT_ID || '').trim(),
      clientSecret: String(process.env.CHANDLER_CLIENT_SECRET || '').trim(),
      apiKey: String(process.env.CHANDLER_API_KEY || '').trim(),
    };
  }

  /**
   * 商品目录原始行：只做类型/数值归一，不过滤。
   * 管理界面要看清每一行（含下不了单的），才能告诉管理员「为什么前台买不到」。
   */
  async rawProducts(): Promise<ChandlerProduct[]> {
    try {
      const parsed: unknown = JSON.parse(
        await this.settings.get('chandler_products'),
      );
      if (!Array.isArray(parsed)) return [];
      return parsed.map((item) => {
        const row = item as Record<string, unknown>;
        return {
          id: String(row.id ?? ''),
          name: String(row.name ?? row.id ?? ''),
          type: (['subscription', 'feature', 'quota'].includes(String(row.type))
            ? String(row.type)
            : 'quota') as ProductType,
          amountFen: Math.trunc(Number(row.amountFen || 0)),
          quota: Math.max(0, Math.trunc(Number(row.quota || 0))),
          serviceDays: Math.max(0, Math.trunc(Number(row.serviceDays || 0))),
        };
      });
    } catch {
      return [];
    }
  }

  /** 可下单目录：必须有商品 ID、价格大于 0，且 ID 不重复（重复时保留第一条）。 */
  async products(): Promise<ChandlerProduct[]> {
    const out: ChandlerProduct[] = [];
    const seen = new Set<string>();
    for (const item of await this.rawProducts()) {
      if (!item.id || item.amountFen <= 0 || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
    return out;
  }

  /** 商品编码 → 商品名：订单列表/详情/权益都以当前目录的展示名回显。 */
  async productNameMap(): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const item of await this.products()) map.set(item.id, item.name);
    return map;
  }

  // ---------- OAuth 联合登录 ----------

  async getAuthorizeUrl(redirectUri: string, state: string) {
    await this.assertEnabled();
    const { baseUrl, clientId } = await this.config();
    if (!clientId) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '未配置 CHANDLER_CLIENT_ID',
      );
    }
    const url = new URL('/v1/oauth/authorize', baseUrl + '/');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return url.toString();
  }

  /**
   * 授权码换 token：
   * - 带本系统访问令牌 → 把平台身份绑定到当前账号（会话不变，支付与权益挂在当前账号上）；
   * - 不带 → 按平台主体号映射/创建本地影子账户并签发新会话（联合登录）。
   * 平台刷新/换票 4xx → 409 引导重新登录（不是 502）。
   */
  async loginWithCode(code: string, redirectUri: string, sessionToken = '') {
    await this.assertEnabled();
    const cfg = await this.config();
    let tokenJson: Record<string, unknown>;
    try {
      const response = await fetch(`${cfg.baseUrl}/v1/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          throw new BusinessException(
            ErrorCode.CONFLICT,
            '授权已失效，请重新登录',
          );
        }
        throw new Error(`HTTP ${response.status}`);
      }
      tokenJson = (await response.json()) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `账号平台暂不可用: ${String(error).slice(0, 200)}`,
      );
    }
    const accessToken = text(tokenJson.access_token);
    const identity = await this.fetchMe(cfg.baseUrl, accessToken);
    if (sessionToken.trim()) {
      const payload = verifyToken(sessionToken.trim(), 'access');
      const user = await this.users.linkChandler(
        payload.uid,
        identity.sub,
        accessToken,
      );
      return { linked: true, user };
    }
    const session = await this.users.upsertChandlerUser(
      identity.sub,
      identity.username,
      identity.displayName,
      accessToken,
    );
    return session;
  }

  private async fetchMe(
    baseUrl: string,
    accessToken: string,
  ): Promise<{ sub: string; username: string; displayName: string }> {
    const response = await fetch(`${baseUrl}/v1/user/info`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '平台用户信息获取失败',
      );
    }
    const json = (await response.json()) as Record<string, unknown>;
    const data = (json.data || json) as Record<string, unknown>;
    const sub = text(data.id) || text(data.user_id) || text(data.open_id);
    if (!sub) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '平台未返回稳定主体号',
      );
    }
    return {
      sub,
      username:
        text(data.username) || text(data.name) || `chandler${sub.slice(0, 6)}`,
      displayName:
        text(data.nickname) || text(data.display_name) || text(data.name),
    };
  }

  // ---------- 支付（B 端） ----------

  /**
   * 下单人必须是某个租户下的租户管理员：订单归属租户，不归属个人账号。
   * 平台管理员不开自己的单——软件是卖给租户的。
   */
  async createOrder(user: CurrentUser, productId: string) {
    await this.assertEnabled();
    const tenant = await this.tenants.purchaserTenant(user);
    const product = (await this.products()).find(
      (item) => item.id === productId,
    );
    if (!product) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '商品不存在或已下架');
    }
    const cfg = await this.config();
    if (!cfg.apiKey || !cfg.clientId) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '服务端缺少 CHANDLER_API_KEY / CHANDLER_CLIENT_ID',
      );
    }
    const merchantOrderNo = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const created = await this.prisma.paymentOrder.create({
      data: {
        userId: user.uid,
        tenantId: tenant.id,
        merchantOrderNo,
        productType: product.type,
        productId: product.id,
        amountFen: product.amountFen,
        quotaGranted: product.quota || 0,
        serviceDays: product.serviceDays || 0,
      },
    });
    // 下单 body 的字段名是 application_id（值为 OAuth client_id）；退款接口才用 client_id
    const upstream = await this.apikeyRequest(
      cfg,
      'POST',
      '/v1/pay/orders',
      {
        application_id: cfg.clientId,
        merchant_order_no: merchantOrderNo,
        amount: product.amountFen,
        subject: product.name,
        body: product.name,
      },
      merchantOrderNo,
    );
    const platformOrderNo = this.pickOrderNo(upstream);
    await this.prisma.paymentOrder.update({
      where: { id: created.id },
      data: {
        platformOrderNo,
        raw: JSON.stringify(upstream).slice(0, 60000),
      },
    });
    return {
      merchantOrderNo,
      platformOrderNo,
      amountFen: product.amountFen,
      productName: product.name,
      productType: product.type,
    };
  }

  /**
   * 订单可见性：下单人本人，或同一租户的租户管理员——
   * 换人接手时也能把自家租户的待支付单付掉。
   * 「租户管理员」是成员关系上的角色，所以按 (订单租户, 调用者) 查成员表。
   */
  private async canAccess(
    uid: number,
    order: { userId: number; tenantId: number | null },
  ) {
    if (order.userId === uid) return true;
    if (!order.tenantId) return false;
    const membership = await this.prisma.tenantMember.findUnique({
      where: {
        tenantId_userId: { tenantId: order.tenantId, userId: uid },
      },
    });
    return Boolean(
      membership?.status === 1 && membership?.role === MEMBER_ROLE_ADMIN,
    );
  }

  /** 预支付必须由终端用户在 chandler 平台的 Bearer token 调用（平台据此定位付款人）。 */
  async prepay(
    user: { uid: number },
    merchantOrderNo: string,
    tradeType: string,
  ) {
    await this.assertEnabled();
    const payer = await this.prisma.user.findUnique({
      where: { id: user.uid },
    });
    if (!payer?.chandlerToken) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '当前账号未绑定 Chandler.work，请先在账户设置里完成授权登录',
      );
    }
    const order = await this.prisma.paymentOrder.findUnique({
      where: { merchantOrderNo },
    });
    if (!order || !(await this.canAccess(user.uid, order))) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '订单不存在');
    }
    if (order.status !== 'PENDING') {
      throw new BusinessException(ErrorCode.ORDER_STATE, '订单状态不允许支付');
    }
    if (!order.platformOrderNo) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '平台订单号缺失，请重新下单',
      );
    }
    const cfg = await this.config();
    const upstream = await this.bearerRequest(
      cfg,
      payer.chandlerToken,
      'POST',
      `/v1/pay/orders/${order.platformOrderNo}/prepay`,
      { trade_type: tradeType || 'native' },
    );
    const info = (upstream?.data || upstream || {}) as Record<string, unknown>;
    await this.prisma.paymentOrder.update({
      where: { id: order.id },
      data: {
        prepayInfo: JSON.stringify(info).slice(0, 60000),
        tradeType: tradeType || 'native',
      },
    });
    return info;
  }

  /** ?reconcile=1：对超时 pending 单主动查单对账（webhook 可能延迟，命中已付即幂等履约）。 */
  async queryOrder(
    user: { uid: number; role: number },
    merchantOrderNo: string,
    reconcile: boolean,
  ) {
    await this.assertEnabled();
    const order = await this.prisma.paymentOrder.findUnique({
      where: { merchantOrderNo },
    });
    // 平台管理员可查全平台订单；租户侧只能查自家租户的
    if (!order || (user.role < ROLE_ADMIN && !(await this.canAccess(user.uid, order)))) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '订单不存在');
    }
    const reconcileNote = reconcile
      ? await this.reconcilePending(order)
      : '';
    const fresh = await this.prisma.paymentOrder.findUnique({
      where: { id: order.id },
    });
    return fresh && { ...this.orderView(fresh), reconcileNote };
  }

  /**
   * 主动查单对账，返回一句能直接给界面显示的结论。
   * 平台的钱已经退了/没退、webhook 到没到，本站都只能靠这次查询确认，
   * 所以「没查成」必须说清是查不动还是真的没付，不能一律报成未支付。
   */
  private async reconcilePending(order: {
    id: number;
    platformOrderNo: string;
    status: string;
    amountFen: number;
  }): Promise<string> {
    if (order.status !== 'PENDING') {
      // 界面自己有状态徽标，这里不重复报状态名，只说结论
      return '订单已不在待支付状态，无需对账';
    }
    if (!order.platformOrderNo) {
      return '平台单号没有回填，本站无法查单，请作废后重新下单';
    }
    const cfg = await this.config();
    try {
      const response = await fetch(
        `${cfg.baseUrl}/v1/pay/orders/${order.platformOrderNo}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) {
        return `支付平台查单失败（HTTP ${response.status}），请稍后再试`;
      }
      const json = (await response.json()) as Record<string, unknown>;
      const data = (json.data || json) as Record<string, unknown>;
      const upstreamStatus = text(data.status).toLowerCase();
      if (!(upstreamStatus.includes('paid') || upstreamStatus.includes('success'))) {
        return `支付平台侧状态为「${upstreamStatus || '未知'}」，仍未收到付款`;
      }
      const granted = await this.fulfill(
        order.id,
        Math.trunc(Number(data.amount_paid || 0)) || order.amountFen,
      );
      return granted
        ? '支付平台已确认收款，权益与额度本次入账'
        : '支付平台已确认收款（本站此前已入账）';
    } catch (error) {
      return `支付平台暂不可达：${String(error).slice(0, 120)}`;
    }
  }

  async listOrders(
    scope: { tenantId?: number; userId?: number } | null,
    filters: OrderFilters,
    page: number,
    pageSize: number,
    offset: number,
  ) {
    const products = await this.products();
    const names = new Map(products.map((item) => [item.id, item.name]));
    // 商品名不在订单表里，检索时先把命中的商品名换成商品 ID 再去查单
    const keyword = (filters.keyword || '').trim();
    const productNameIds = keyword
      ? products
          .filter(
            (item) =>
              item.name.toLowerCase().includes(keyword.toLowerCase()) ||
              item.id.toLowerCase().includes(keyword.toLowerCase()),
          )
          .map((item) => item.id)
      : [];
    const where = orderWhere(scope, filters, productNameIds);
    const [rows, total] = await Promise.all([
      this.prisma.paymentOrder.findMany({
        where,
        include: {
          user: { select: { username: true, displayName: true } },
          tenant: { select: { name: true, code: true } },
        },
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.paymentOrder.count({ where }),
    ]);
    return {
      list: rows.map((row) => ({
        ...this.orderView(row),
        username: row.user?.username || '',
        userDisplayName: row.user?.displayName || '',
        tenantName: row.tenant?.name || '',
        tenantCode: row.tenant?.code || '',
        productName: names.get(row.productId) || row.productId,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 订单详情：本体 + 平台留档 + 退款记录 + 租户已授予的软件权益 + 下单人。
   * `?reconcile=1` 先向支付平台查单对账再取详情，并把结论放进 reconcileNote。
   */
  async orderDetail(merchantOrderNo: string, reconcile = false) {
    if (reconcile) await this.assertEnabled();
    const find = () =>
      this.prisma.paymentOrder.findUnique({
        where: { merchantOrderNo },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              role: true,
            },
          },
          tenant: { select: { id: true, name: true, code: true } },
          refunds: { orderBy: { id: 'desc' } },
        },
      });
    let order = await find();
    if (!order) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '订单不存在');
    }
    let reconcileNote = '';
    if (reconcile) {
      reconcileNote = await this.reconcilePending(order);
      // 对账可能刚把单子推成已履约，状态、paidAt 都要取最新的
      order = (await find()) ?? order;
    }
    const entitlement = order.tenantId
      ? await this.prisma.tenantEntitlement.findUnique({
          where: {
            tenantId_productId: {
              tenantId: order.tenantId,
              productId: order.productId,
            },
          },
        })
      : null;
    const productName =
      (await this.productNameMap()).get(order.productId) || order.productId;
    return {
      ...this.orderView(order),
      productName,
      username: order.user?.username || '',
      userDisplayName: order.user?.displayName || '',
      tenantName: order.tenant?.name || '',
      tenantCode: order.tenant?.code || '',
      raw: redactSecrets(safeJson(order.raw)),
      reconcileNote,
      remainingFen: order.amountFen - order.refundedFen,
      buyer: order.user,
      tenant: order.tenant,
      refunds: order.refunds,
      entitlement,
    };
  }

  /**
   * 支付概览（金额单位：分）：收款/退款合计、订单状态分布、商品类型分布与近 N 天收款。
   * 「已收款」口径为 paidAt>0，即真正付过钱的单，待支付与失败单不计入。
   */
  async paySummary(days: number) {
    const since = new Date(Date.now() - days * 86400_000);
    const [byStatus, byProduct, byProductOrders, paid, refunded, recent] =
      await Promise.all([
        this.prisma.paymentOrder.groupBy({
          by: ['status'],
          _count: { _all: true },
          _sum: { amountFen: true },
        }),
        this.prisma.paymentOrder.groupBy({
          by: ['productType'],
          where: { paidAt: { gt: 0 } },
          _count: { _all: true },
          _sum: { amountFen: true, refundedFen: true },
        }),
        this.prisma.paymentOrder.groupBy({
          by: ['productId', 'status'],
          _count: { _all: true },
        }),
        this.prisma.paymentOrder.aggregate({
          where: { paidAt: { gt: 0 } },
          _count: { _all: true },
          _sum: { amountFen: true, quotaGranted: true },
        }),
        this.prisma.paymentOrder.aggregate({
          _sum: { refundedFen: true },
        }),
        this.prisma.paymentOrder.aggregate({
          where: { paidAt: { gt: 0 }, createdAt: { gte: since } },
          _count: { _all: true },
          _sum: { amountFen: true },
        }),
      ]);
    const [pending, entitlements] = await Promise.all([
      this.prisma.paymentOrder.count({ where: { status: 'PENDING' } }),
      this.prisma.tenantEntitlement.count({ where: { enabled: 1 } }),
    ]);
    // 每个商品的历史单据：删除商品前要能说出「有没有人买过、有没有单没付完」
    const usage = new Map<
      string,
      { productId: string; orderCount: number; pendingCount: number; paidCount: number }
    >();
    for (const row of byProductOrders) {
      const item = usage.get(row.productId) ?? {
        productId: row.productId,
        orderCount: 0,
        pendingCount: 0,
        paidCount: 0,
      };
      item.orderCount += row._count._all;
      if (row.status === 'PENDING') item.pendingCount += row._count._all;
      if (row.status === 'PAID' || row.status === 'FULFILLED')
        item.paidCount += row._count._all;
      usage.set(row.productId, item);
    }
    return {
      days,
      orderCount: paid._count._all + pending,
      paidCount: paid._count._all,
      paidFen: paid._sum.amountFen || 0,
      grantedQuota: paid._sum.quotaGranted || 0,
      refundedFen: refunded._sum.refundedFen || 0,
      pendingCount: pending,
      activeEntitlements: entitlements,
      recentPaidCount: recent._count._all,
      recentPaidFen: recent._sum.amountFen || 0,
      byStatus: byStatus.map((row) => ({
        status: row.status,
        count: row._count._all,
        amountFen: row._sum.amountFen || 0,
      })),
      byProductType: byProduct.map((row) => ({
        productType: row.productType,
        count: row._count._all,
        amountFen: row._sum.amountFen || 0,
        refundedFen: row._sum.refundedFen || 0,
      })),
      productUsage: [...usage.values()],
    };
  }

  /** 支付渠道自检：凭据是否齐备（只报有无，绝不回显明文），商品目录给管理界面按原始行展示。 */
  async payStatus() {
    const cfg = await this.config();
    const [rows, orderable] = await Promise.all([
      this.rawProducts(),
      this.products(),
    ]);
    return {
      enabled: await this.enabled(),
      baseUrl: cfg.baseUrl,
      hasClientId: Boolean(cfg.clientId),
      hasClientSecret: Boolean(cfg.clientSecret),
      hasApiKey: Boolean(cfg.apiKey),
      productCount: orderable.length,
      orderableIds: orderable.map((item) => item.id),
      products: rows,
      webhookPath: '/pay/webhook',
    };
  }

  /** 只读试算：订阅按「已服务天数扣减」，可退额 = 订单额 × 剩余天数 / 服务期（B 端口径）。 */
  async refundPreview(merchantOrderNo: string) {
    const order = await this.prisma.paymentOrder.findUnique({
      where: { merchantOrderNo },
    });
    if (!order) throw new BusinessException(ErrorCode.NOT_FOUND, '订单不存在');
    if (order.status !== 'FULFILLED' && order.status !== 'PAID') {
      throw new BusinessException(ErrorCode.ORDER_STATE, '订单状态不允许退款');
    }
    const remaining = order.amountFen - order.refundedFen;
    let suggested = remaining;
    let servedDays = 0;
    let daysTotal = order.serviceDays;
    if (
      order.productType === 'subscription' &&
      order.serviceDays > 0 &&
      order.paidAt > 0
    ) {
      servedDays = Math.min(
        order.serviceDays,
        Math.floor((Date.now() / 1000 - order.paidAt) / 86400),
      );
      daysTotal = order.serviceDays;
      suggested = Math.max(
        0,
        Math.min(
          remaining,
          Math.round((order.amountFen * (daysTotal - servedDays)) / daysTotal),
        ),
      );
    }
    return {
      merchantOrderNo,
      productType: order.productType,
      amountFen: order.amountFen,
      refundedFen: order.refundedFen,
      remainingFen: remaining,
      servedDays,
      daysTotal,
      suggestedRefundFen: suggested,
      note:
        order.productType === 'subscription' && order.serviceDays > 0
          ? '订阅按已服务天数折算；退款额 ≥ 折算额将自动回收权益'
          : '非订阅商品需整单退款才回收权益/额度',
    };
  }

  /** 管理端退款：金额必须显式正数（平台没有缺省=全额语义）；退款即执行。 */
  async refund(
    operatorUid: number,
    merchantOrderNo: string,
    amountFen: number,
    reason: string,
  ) {
    await this.assertEnabled();
    const order = await this.prisma.paymentOrder.findUnique({
      where: { merchantOrderNo },
    });
    if (!order) throw new BusinessException(ErrorCode.NOT_FOUND, '订单不存在');
    if (order.status !== 'FULFILLED' && order.status !== 'PAID') {
      throw new BusinessException(ErrorCode.ORDER_STATE, '订单状态不允许退款');
    }
    if (!Number.isInteger(amountFen) || amountFen <= 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '退款金额必须为显式正整数（分）',
      );
    }
    const remaining = order.amountFen - order.refundedFen;
    if (amountFen > remaining) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        `退款额不得超过可退余额 ${remaining} 分`,
      );
    }
    const cfg = await this.config();
    const merchantRefundNo = `refund-${order.merchantOrderNo}`;
    // 退款接口 body 严格解析：client_id + 显式 amount，不带多余字段
    const upstream = await this.apikeyRequest(
      cfg,
      'POST',
      '/v1/me/refunds',
      {
        client_id: cfg.clientId,
        order_no: order.platformOrderNo,
        merchant_refund_no: merchantRefundNo,
        amount: amountFen,
        reason: reason || '管理员退款',
      },
      merchantRefundNo,
    );
    await this.prisma.paymentRefund.create({
      data: {
        orderId: order.id,
        merchantRefundNo,
        amountFen,
        status: 'SUBMITTED',
        reason,
      },
    });
    const fullRefunded = amountFen >= remaining;
    await this.prisma.paymentOrder.update({
      where: { id: order.id },
      data: {
        status: fullRefunded ? 'REFUNDED' : order.status,
        refundedFen: order.refundedFen + amountFen,
      },
    });
    await this.reclaimOnRefund(order, amountFen, upstream);
    return { merchantRefundNo, amountFen };
  }

  /**
   * 退款回收口径（软件卖给租户）：
   * - 订阅：退款额 ≥ 剩余价值折算额 → 回收租户权益；否则保留权益并记 ALERT 人工复核
   * - 功能买断 / 额度包：整单退款才回收
   * 额度包到账进的是租户额度池，回收也从池里扣；池已被租户分给 User 时扣不动，
   * 记 ALERT 交人工（退款已在平台侧提交，不能因为回收失败再抛错）。
   */
  private async reclaimOnRefund(
    order: {
      id: number;
      userId: number;
      tenantId: number | null;
      productId: string;
      productType: string;
      amountFen: number;
      quotaGranted: number;
      refundedFen: number;
      serviceDays: number;
      paidAt: number;
    },
    amountFen: number,
    upstream: Record<string, unknown>,
  ) {
    if (!order.tenantId) {
      this.logger.warn(
        `ALERT 订单 ${order.id} 没有租户归属，退款后无法回收权益/额度，请人工核对`,
      );
      return;
    }
    const remainingValue = this.remainingValueFen(order);
    const fullRefunded = amountFen >= order.amountFen - order.refundedFen;
    const revokeNeeded =
      order.productType === 'subscription'
        ? amountFen >= remainingValue && remainingValue > 0
        : fullRefunded;
    if (order.productType === 'subscription' && amountFen < remainingValue) {
      this.logger.warn(
        `ALERT 退款低于剩余价值，租户权益保留人工复核：订单 ${order.id} 退 ${amountFen} 分 / 剩余价值 ${remainingValue} 分`,
      );
    }
    if (!revokeNeeded) return;
    await this.tenants.revokeEntitlement(order.tenantId, order.productId);
    if (order.quotaGranted > 0) {
      try {
        await this.tenants.adjustPool(
          0,
          order.tenantId,
          -order.quotaGranted,
          `订单退款回收额度（${text(upstream?.trace_id)}）`,
          'REFUND',
        );
      } catch {
        this.logger.warn(
          `ALERT 退款回收额度失败：订单 ${order.id} 需回收 ${order.quotaGranted}，租户额度池余量不足，请人工核对`,
        );
      }
    }
  }

  private remainingValueFen(order: {
    productType: string;
    amountFen: number;
    serviceDays: number;
    paidAt: number;
    refundedFen?: number;
  }): number {
    const remaining = order.amountFen - (order.refundedFen || 0);
    if (
      order.productType !== 'subscription' ||
      order.serviceDays <= 0 ||
      order.paidAt <= 0
    ) {
      return remaining;
    }
    const servedDays = Math.min(
      order.serviceDays,
      Math.floor((Date.now() / 1000 - order.paidAt) / 86400),
    );
    return Math.max(
      0,
      Math.min(
        remaining,
        Math.round(
          (order.amountFen * (order.serviceDays - servedDays)) /
            order.serviceDays,
        ),
      ),
    );
  }

  /** webhook 与主动对账共用幂等履约：状态机推进成功的那一个调用才发放权益/额度。 */
  async fulfill(orderId: number, paidFen: number) {
    const updated = await this.prisma.paymentOrder.updateMany({
      where: { id: orderId, status: { in: ['PENDING', 'PAID'] } },
      data: { status: 'FULFILLED', paidAt: Math.floor(Date.now() / 1000) },
    });
    if (updated.count !== 1) return false;
    const order = await this.prisma.paymentOrder.findUnique({
      where: { id: orderId },
    });
    if (!order) return false;
    if (!order.tenantId) {
      this.logger.warn(
        `ALERT 订单 ${order.id} 无租户归属，履约无处入账，请人工核对`,
      );
      return true;
    }
    if (
      order.productType === 'subscription' ||
      order.productType === 'feature'
    ) {
      const expiresAt =
        order.productType === 'subscription' && order.serviceDays > 0
          ? Math.floor(Date.now() / 1000) + order.serviceDays * 86400
          : 0;
      await this.tenants.grantEntitlement({
        tenantId: order.tenantId,
        productId: order.productId,
        name:
          (await this.productNameMap()).get(order.productId) || order.productId,
        kind: order.productType,
        expiresAt,
      });
    }
    if (order.quotaGranted > 0) {
      await this.tenants.grantPool(
        order.tenantId,
        order.quotaGranted,
        `订购到账 ${order.merchantOrderNo}（${paidFen || order.amountFen} 分）`,
      );
    }
    return true;
  }

  async fulfillByWebhook(body: Record<string, unknown>): Promise<boolean> {
    const data = (body.data || body) as Record<string, unknown>;
    const merchantOrderNo =
      text(data.merchant_order_no) || text(data.merchantOrderNo);
    const platformOrderNo = text(data.order_no) || text(data.orderNo);
    const status = (
      text(data.status) ||
      text(data.event) ||
      text(data.type)
    ).toLowerCase();
    const paid = /paid|success|complete/.test(status);
    const amount = Math.trunc(
      Number(data.amount_paid || data.paid_amount || data.amount || 0),
    );
    let order = null as null | { id: number };
    if (merchantOrderNo) {
      order = await this.prisma.paymentOrder.findUnique({
        where: { merchantOrderNo },
        select: { id: true },
      });
    }
    if (!order && platformOrderNo) {
      order = await this.prisma.paymentOrder.findFirst({
        where: { platformOrderNo },
        select: { id: true },
      });
    }
    if (!order) {
      this.logger.warn(
        `webhook 未匹配到订单: ${JSON.stringify(body).slice(0, 300)}`,
      );
      return false;
    }
    if (!paid) return false;
    return this.fulfill(order.id, amount);
  }

  /** webhook 验签：HMAC-SHA256(rawBody)，key = sha256_hex(client_secret)。 */
  async verifyWebhook(
    rawBody: Buffer | undefined,
    signature: string,
  ): Promise<boolean> {
    const { clientSecret } = await this.config();
    if (!clientSecret || !rawBody || !signature) return false;
    const key = createHash('sha256').update(clientSecret).digest('hex');
    const expected = createHmac('sha256', key).update(rawBody).digest('hex');
    const given = signature.replace(/^sha256=/i, '').trim();
    try {
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(given, 'hex');
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  private pickOrderNo(upstream: Record<string, unknown>): string {
    const data = (upstream?.data || upstream || {}) as Record<string, unknown>;
    return text(data.order_no) || text(data.orderNo);
  }

  orderView(order: {
    id: number;
    merchantOrderNo: string;
    platformOrderNo: string;
    tenantId: number | null;
    productType: string;
    productId: string;
    amountFen: number;
    quotaGranted: number;
    serviceDays: number;
    status: string;
    tradeType: string;
    prepayInfo: string;
    paidAt: number;
    refundedFen: number;
    createdAt: Date;
  }) {
    return {
      id: order.id,
      merchantOrderNo: order.merchantOrderNo,
      platformOrderNo: order.platformOrderNo,
      tenantId: order.tenantId,
      productType: order.productType,
      productId: order.productId,
      amountFen: order.amountFen,
      quotaGranted: order.quotaGranted,
      serviceDays: order.serviceDays,
      status: order.status,
      tradeType: order.tradeType,
      prepayInfo: safeJson(order.prepayInfo),
      paidAt: order.paidAt,
      refundedFen: order.refundedFen,
      createdAt: order.createdAt,
    };
  }

  private async apikeyRequest(
    cfg: { baseUrl: string; apiKey: string },
    method: string,
    path: string,
    body: Record<string, unknown>,
    idempotencyKey?: string,
  ) {
    const response = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Apikey ${cfg.apiKey}`,
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      this.logger.error(
        `chandler ${method} ${path} failed: ${response.status} ${JSON.stringify(json).slice(0, 300)}`,
      );
      const message =
        text((json?.error as Record<string, unknown>)?.message) ||
        text(json?.message);
      // 404 client.not_found 的常见真因是调用者不是应用 admin+ 成员，而非 client_id 配错
      if (response.status === 404 || /not_found/i.test(message)) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          '下单/退款被拒：API Key 对应账号需为目标应用 owner/admin/finance 成员',
        );
      }
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `支付平台拒绝: ${message || `HTTP ${response.status}`}`,
      );
    }
    return json;
  }

  private async bearerRequest(
    cfg: { baseUrl: string },
    token: string,
    method: string,
    path: string,
    body: Record<string, unknown>,
  ) {
    const response = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      // 4xx 是用户可修的（登录态失效需重登），5xx 才是平台的
      if (response.status >= 400 && response.status < 500) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '登录态已失效，请重新登录后再支付',
        );
      }
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '支付平台暂时不可用',
      );
    }
    return json;
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** 报文里可能是凭据的字段名：留档展示前一律掩码。 */
const SECRET_KEY_RE = /(token|secret|sign|api[-_]?key|password|authorization|cert)/i;

/**
 * 平台留档报文是给管理员排障看的，不是凭据回显口：
 * 命中凭据字段的字符串值按「前 4 后 4」掩码，其余原样保留。
 */
function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] =
      SECRET_KEY_RE.test(key) && typeof item === 'string'
        ? maskKey(item)
        : redactSecrets(item);
  }
  return out;
}
