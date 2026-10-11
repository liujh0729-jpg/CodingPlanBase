import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Current } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user';
import { ok, pageParam, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { UsersService } from '../users/users.service';
import { CatalogService } from './catalog.service';
import { ChannelsService } from './channels.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { TokensService } from './tokens.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

@Controller('gateway/channels')
export class ChannelsController {
  constructor(
    private readonly users: UsersService,
    private readonly channels: ChannelsService,
  ) {}

  @Get()
  async list(@Current() user: CurrentUser) {
    this.users.requireAdmin(user);
    return ok(await this.channels.list());
  }

  /**
   * 上游标准模板。必须声明在 `:id` 之前，否则 `presets` 会被当成渠道 ID 去 parseId。
   */
  @Get('presets')
  presets(@Current() user: CurrentUser) {
    this.users.requireAdmin(user);
    return ok(this.channels.presets());
  }

  @Get(':id')
  async get(@Current() user: CurrentUser, @Param('id') id: string) {
    this.users.requireAdmin(user);
    return ok(await this.channels.get(parseId(id, '渠道 ID')));
  }

  @Post()
  async create(
    @Current() user: CurrentUser,
    @Body() body: Record<string, unknown>,
  ) {
    this.users.requireAdmin(user);
    return ok(await this.channels.create(body || {}));
  }

  @Patch(':id')
  async update(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.users.requireAdmin(user);
    return ok(await this.channels.update(parseId(id, '渠道 ID'), body || {}));
  }

  @Post(':id/status')
  async status(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Body() body: { status?: number },
  ) {
    this.users.requireAdmin(user);
    return ok(
      await this.channels.setStatus(
        parseId(id, '渠道 ID'),
        Number(body?.status),
      ),
    );
  }

  @Post(':id/test')
  async test(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Body() body: { model?: string },
  ) {
    this.users.requireAdmin(user);
    return ok(
      await this.channels.test(parseId(id, '渠道 ID'), text(body?.model)),
    );
  }

  @Post(':id/fetch-models')
  async fetchModels(@Current() user: CurrentUser, @Param('id') id: string) {
    this.users.requireAdmin(user);
    return ok(await this.channels.fetchModels(parseId(id, '渠道 ID')));
  }

  @Delete(':id')
  async remove(@Current() user: CurrentUser, @Param('id') id: string) {
    this.users.requireAdmin(user);
    await this.channels.remove(parseId(id, '渠道 ID'));
    return ok(null);
  }
}

@Controller('gateway/tokens')
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  @Get()
  async list(@Current() user: CurrentUser, @Query('all') all?: string) {
    if (all === '1' && user.isAdmin()) return ok(await this.tokens.list());
    return ok(await this.tokens.list(user.uid, user.tenantId));
  }

  @Post()
  async create(
    @Current() user: CurrentUser,
    @Body() body: Record<string, unknown>,
  ) {
    return ok(
      await this.tokens.create(user.uid, user.tenantId ?? 0, (body || {}) as never),
    );
  }

  @Patch(':id')
  async update(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return ok(
      await this.tokens.update(
        parseId(id, '令牌 ID'),
        user.uid,
        user.tenantId,
        body || {},
        user.isAdmin(),
      ),
    );
  }

  @Delete(':id')
  async remove(@Current() user: CurrentUser, @Param('id') id: string) {
    await this.tokens.remove(
      parseId(id, '令牌 ID'),
      user.uid,
      user.tenantId,
      user.isAdmin(),
    );
    return ok(null);
  }
}

@Controller('gateway')
export class ModelsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly settings: SettingsService,
    private readonly catalog: CatalogService,
  ) {}

  /** 定价页数据：模型 + 换算参数（元 / 额度）。 */
  @Get('models')
  async list() {
    const rows = await this.prisma.gatewayModel.findMany({
      orderBy: { id: 'asc' },
    });
    const perUnit = await this.settings.getNumber('quota_per_unit');
    return ok({
      quotaPerUnit: perUnit,
      models: rows.map((row) => ({
        ...row,
        priceCnyPerMIn: row.modelRatio,
        priceCnyPerMOut: row.modelRatio * row.completionRatio,
      })),
    });
  }

  /**
   * 钉价只看价格字段：这几个是目录同步会覆盖的，管理员真改过才把这一行的价格冻住。
   * 备注 / 端点 / 可用分组属说明性元数据（`groupRatio`、`enableGroups` 同步从不写），
   * 改它们不该让模型从此跟不上目录调价。
   */
  static readonly PRICE_FIELDS = [
    'quotaType',
    'modelRatio',
    'completionRatio',
    'cacheReadRatio',
    'cacheWriteRatio',
    'callCnyPrice',
  ] as const;

  @Patch('models/:id')
  async update(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    this.users.requireAdmin(user);
    const modelId = parseId(id, '模型 ID');
    const existing = await this.prisma.gatewayModel.findUnique({
      where: { id: modelId },
    });
    if (!existing) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '模型不存在');
    }
    const data: Record<string, number | string | boolean> = {};
    for (const field of [
      'modelRatio',
      'completionRatio',
      'cacheReadRatio',
      'cacheWriteRatio',
      'callCnyPrice',
      'groupRatio',
    ] as const) {
      if (body[field] !== undefined) data[field] = Number(body[field]);
    }
    if (body.quotaType !== undefined) data.quotaType = Number(body.quotaType);
    if (body.enableGroups !== undefined)
      data.enableGroups = text(body.enableGroups);
    if (body.endpoints !== undefined) data.endpoints = text(body.endpoints);
    if (body.description !== undefined)
      data.description = text(body.description);
    // 只有真的改动了价格字段才钉住；只动备注、端点或倍率不改变定价来源
    const priceChanged = ModelsController.PRICE_FIELDS.some(
      (field) =>
        data[field] !== undefined &&
        String(existing[field]) !== String(data[field]),
    );
    if (priceChanged) data.priceSource = 'manual';
    return ok(
      await this.prisma.gatewayModel.update({
        where: { id: modelId },
        data,
      }),
    );
  }

  /** 恢复目录价：按当前快照立刻重算这一行的价格并交还给目录同步接管。 */
  @Post('models/:id/price/reset')
  async resetPrice(@Current() user: CurrentUser, @Param('id') id: string) {
    this.users.requireAdmin(user);
    return ok(
      await this.catalog.resetToCatalogPrice(parseId(id, '模型 ID')),
    );
  }
}

@Controller('gateway')
export class SetupController {
  constructor(
    private readonly users: UsersService,
    private readonly catalog: CatalogService,
  ) {}

  @Get('setup/status')
  async status(@Current() user: CurrentUser) {
    this.users.requireAdmin(user);
    return ok(await this.catalog.status());
  }

  @Post('setup')
  async setup(@Current() user: CurrentUser, @Body() body: { key?: string }) {
    // 这个入口只写入 aipdd_api_key（目录来源不可输入），与 PUT /settings 同一口径收给超管
    this.users.requireRoot(user);
    return ok(await this.catalog.setup(body || {}));
  }

  @Post('catalog/sync')
  async sync(@Current() user: CurrentUser) {
    this.users.requireAdmin(user);
    return ok(await this.catalog.sync(true));
  }
}

@Controller('gateway')
export class WalletController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly settings: SettingsService,
  ) {}

  @Get('wallet')
  async wallet(@Current() user: CurrentUser) {
    const me = await this.users.me(user);
    const perUnit = await this.settings.getNumber('quota_per_unit');
    return ok({
      tenantId: me.tenantId,
      tenantName: me.tenantName,
      quota: me.quota,
      usedQuota: me.usedQuota,
      requestCount: me.requestCount,
      quotaPerUnit: perUnit,
      usedCny: Number((me.usedQuota / (perUnit || 1)).toFixed(4)),
    });
  }

  @Get('wallet/txns')
  async txns(
    @Current() user: CurrentUser,
    @Query() query: Record<string, string>,
  ) {
    const { page, pageSize, offset } = pageParam(
      query.page,
      query.pageSize,
      20,
    );
    return ok(
      await this.users.quotaTxns(
        user.uid,
        page,
        pageSize,
        offset,
        user.tenantId ?? undefined,
      ),
    );
  }

  @Get('logs')
  async logs(
    @Current() user: CurrentUser,
    @Query() query: Record<string, string>,
  ) {
    const { page, pageSize, offset } = pageParam(
      query.page,
      query.pageSize,
      20,
    );
    const all = query.all === '1' && user.isAdmin();
    // 自己的视图按当前租户收口：同一个人换到别的租户，看到的是那边的流水
    const where = all
      ? query.userId
        ? { userId: parseId(query.userId, '用户 ID') }
        : {}
      : { userId: user.uid, tenantId: user.tenantId ?? 0 };
    const [list, total] = await Promise.all([
      this.prisma.log.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.log.count({ where }),
    ]);
    // 平台全量视图要能看出这一笔花在哪个租户里（同一个人可以同时属于多个租户）
    if (!all) return ok({ list, total, page, pageSize });
    const tenants = await this.prisma.tenant.findMany({
      where: { id: { in: [...new Set(list.map((row) => row.tenantId))] } },
      select: { id: true, name: true },
    });
    const tenantNames = new Map(tenants.map((row) => [row.id, row.name]));
    return ok({
      list: list.map((row) => ({
        ...row,
        tenantName: tenantNames.get(row.tenantId) || '',
      })),
      total,
      page,
      pageSize,
    });
  }

  @Get('stats')
  async stats(
    @Current() user: CurrentUser,
    @Query() query: Record<string, string>,
  ) {
    if (!user.isAdmin()) {
      throw new BusinessException(ErrorCode.ROLE_MISMATCH, '需要管理员权限');
    }
    const days = Math.min(90, Math.max(1, Number(query.days || 7)));
    const since = new Date(Date.now() - days * 86400_000);
    const where = { type: 2, createdAt: { gte: since } };
    const [byModel, totals, errors, users] = await Promise.all([
      this.prisma.log.groupBy({
        by: ['modelName'],
        where,
        _sum: { quota: true },
        _count: { _all: true },
        orderBy: { _sum: { quota: 'desc' } },
        take: 20,
      }),
      this.prisma.log.aggregate({
        where,
        _sum: { quota: true },
        _count: { _all: true },
      }),
      this.prisma.log.count({ where: { type: 5, createdAt: { gte: since } } }),
      this.prisma.user.count(),
    ]);
    const perUnit = await this.settings.getNumber('quota_per_unit');
    return ok({
      days,
      requestCount: totals._count._all,
      quota: totals._sum.quota || 0,
      cny: Number(((totals._sum.quota || 0) / (perUnit || 1)).toFixed(4)),
      errorCount: errors,
      userCount: users,
      byModel: byModel.map((row) => ({
        model: row.modelName,
        requests: row._count._all,
        quota: row._sum.quota || 0,
      })),
    });
  }
}
