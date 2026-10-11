import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Current } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user';
import { ok, pageParam, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { ChandlerService } from './chandler.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { TenantsService } from '../tenants/tenants.service';

@Controller('auth/chandler')
export class ChandlerAuthController {
  constructor(private readonly chandler: ChandlerService) {}

  @Get('status')
  async status() {
    return ok({ enabled: await this.chandler.enabled() });
  }

  @Get('authorize-url')
  async authorizeUrl(
    @Query('redirectUri') redirectUri: string,
    @Query('state') state: string,
  ) {
    return ok({
      url: await this.chandler.getAuthorizeUrl(
        text(redirectUri),
        text(state || ''),
      ),
    });
  }

  /**
   * 授权码回调：带本系统访问令牌时把平台身份绑定到当前账号（会话不变），
   * 不带时按联合登录签发影子账户会话。
   */
  @Post('callback')
  async callback(
    @Body() body: { code?: string; redirectUri?: string; accessToken?: string },
  ) {
    const result = await this.chandler.loginWithCode(
      text(body?.code),
      text(body?.redirectUri),
      text(body?.accessToken),
    );
    return ok(result);
  }
}

/**
 * 订购与支付：订单主体是租户（软件卖给租户）。
 * 平台管理员在此看到的是全平台订单，租户管理员自动收口到自己租户。
 */
@Controller('pay')
export class PayController {
  constructor(
    private readonly chandler: ChandlerService,
    private readonly tenants: TenantsService,
  ) {}

  @Get('products')
  async products() {
    return ok(await this.chandler.products());
  }

  @Post('orders')
  async createOrder(
    @Current() user: CurrentUser,
    @Body() body: { productId?: string },
  ) {
    return ok(await this.chandler.createOrder(user, text(body?.productId)));
  }

  @Post('orders/:no/prepay')
  async prepay(
    @Current() user: CurrentUser,
    @Param('no') no: string,
    @Body() body: { tradeType?: string },
  ) {
    // 付款人令牌由服务端保存（联合登录时落库），浏览器不需要接触
    return ok(
      await this.chandler.prepay(user, text(no), text(body?.tradeType)),
    );
  }

  @Get('orders')
  async list(
    @Current() user: CurrentUser,
    @Query() query: Record<string, string>,
  ) {
    const { page, pageSize, offset } = pageParam(
      query.page,
      query.pageSize,
      20,
    );
    const filters = {
      keyword: text(query.keyword),
      status: text(query.status),
      productType: text(query.productType),
    };
    if (user.isAdmin()) {
      return ok(
        await this.chandler.listOrders(
          null,
          {
            ...filters,
            tenantId: query.tenantId
              ? parseId(query.tenantId, '租户 ID')
              : undefined,
          },
          page,
          pageSize,
          offset,
        ),
      );
    }
    // 租户侧「订购记录」：tenantId 从会话推出，不接受前端传值
    const tenant = await this.tenants.requireTenant(user);
    return ok(
      await this.chandler.listOrders(
        { tenantId: tenant.id },
        filters,
        page,
        pageSize,
        offset,
      ),
    );
  }

  @Get('orders/:no')
  async get(
    @Current() user: CurrentUser,
    @Param('no') no: string,
    @Query('reconcile') reconcile: string,
  ) {
    return ok(
      await this.chandler.queryOrder(user, text(no), reconcile === '1'),
    );
  }

  /** 支付回调：验签 key = sha256_hex(client_secret)；body 需要原始字节，不能用解析后的 JSON 重序列化。 */
  @Post('webhook')
  async webhook(
    @Req() request: Request & { rawBody?: Buffer },
    @Res() response: Response,
  ) {
    const signature = String(
      request.headers['x-chandler-signature'] ||
        request.headers['signature'] ||
        request.headers['x-signature'] ||
        '',
    );
    const verified = await this.chandler.verifyWebhook(
      request.rawBody,
      signature,
    );
    if (!verified) {
      response.status(401).json({ code: 401, message: 'invalid signature' });
      return;
    }
    let handled = false;
    try {
      handled = await this.chandler.fulfillByWebhook(
        (request.body || {}) as Record<string, unknown>,
      );
    } catch {
      // 履约异常也要给平台 200 停止无意义重放？不：返回 500 让平台重试，幂等由状态机保证
      response.status(500).json({ code: 500, message: 'fulfill failed' });
      return;
    }
    response.json({ code: 0, message: 'ok', data: { handled } });
  }
}

@Controller('admin/orders')
export class AdminOrdersController {
  constructor(
    private readonly chandler: ChandlerService,
    private readonly users: UsersService,
  ) {}

  /** 全平台订单：按单号 / 租户 / 下单人 / 状态 / 商品类型筛选，退款与详情从这里下钻。 */
  @Get()
  async list(
    @Current() user: CurrentUser,
    @Query() query: Record<string, string>,
  ) {
    this.users.requireAdmin(user);
    const { page, pageSize, offset } = pageParam(
      query.page,
      query.pageSize,
      20,
    );
    return ok(
      await this.chandler.listOrders(
        null,
        {
          keyword: text(query.keyword),
          status: text(query.status),
          productType: text(query.productType),
          userId: query.userId ? parseId(query.userId, '用户 ID') : undefined,
          tenantId: query.tenantId
            ? parseId(query.tenantId, '租户 ID')
            : undefined,
        },
        page,
        pageSize,
        offset,
      ),
    );
  }

  /** 订单详情；`?reconcile=1` 先向支付平台查单对账再返回（待支付单用得上）。 */
  @Get(':no')
  async detail(
    @Current() user: CurrentUser,
    @Param('no') no: string,
    @Query('reconcile') reconcile: string,
  ) {
    this.users.requireAdmin(user);
    return ok(
      await this.chandler.orderDetail(text(no), reconcile === '1'),
    );
  }

  @Get(':no/refund-preview')
  async refundPreview(@Current() user: CurrentUser, @Param('no') no: string) {
    this.users.requireAdmin(user);
    return ok(await this.chandler.refundPreview(text(no)));
  }

  @Post(':no/refund')
  async refund(
    @Current() user: CurrentUser,
    @Param('no') no: string,
    @Body() body: { amountFen?: number; reason?: string },
  ) {
    this.users.requireAdmin(user);
    return ok(
      await this.chandler.refund(
        user.uid,
        text(no),
        Math.trunc(Number(body?.amountFen ?? 0)),
        text(body?.reason),
      ),
    );
  }
}

@Controller('admin/pay')
export class AdminPayController {
  constructor(
    private readonly chandler: ChandlerService,
    private readonly users: UsersService,
  ) {}

  @Get('status')
  async status(@Current() user: CurrentUser) {
    this.users.requireAdmin(user);
    return ok(await this.chandler.payStatus());
  }

  @Get('summary')
  async summary(
    @Current() user: CurrentUser,
    @Query('days') days?: string,
  ) {
    this.users.requireAdmin(user);
    const range = Math.min(365, Math.max(1, Number(days || 30)));
    return ok(await this.chandler.paySummary(Number.isFinite(range) ? range : 30));
  }
}

@Controller('admin/entitlements')
export class AdminEntitlementsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /** 全平台生效中的租户软件权益（订阅到期 / 功能买断）。 */
  @Get()
  async list(@Current() user: CurrentUser, @Query('tenantId') tenantId?: string) {
    this.users.requireAdmin(user);
    const now = Math.floor(Date.now() / 1000);
    const rows = await this.prisma.tenantEntitlement.findMany({
      where: tenantId
        ? { tenantId: parseId(tenantId, '租户 ID') }
        : { enabled: 1 },
      include: { tenant: { select: { name: true, code: true } } },
      orderBy: { id: 'desc' },
      take: 200,
    });
    return ok(
      rows.map((row) => ({
        ...row,
        active: row.enabled === 1 && (row.expiresAt === 0 || row.expiresAt > now),
      })),
    );
  }
}
