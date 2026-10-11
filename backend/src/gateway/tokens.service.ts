import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { text } from '../common/api';
import {
  findInvalidIpRule,
  generateTokenKey,
  maskKey,
  parseIpRules,
} from './gateway.constants';

@Injectable()
export class TokensService {
  constructor(private readonly prisma: PrismaService) {}

  private toView(row: {
    id: number;
    userId: number;
    tenantId: number;
    key: string;
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
    createdAt: Date;
    accessedAt: number;
  }) {
    return {
      id: row.id,
      userId: row.userId,
      tenantId: row.tenantId,
      keyMasked: maskKey(row.key),
      name: row.name,
      status: row.status,
      remainQuota: row.remainQuota,
      unlimitedQuota: row.unlimitedQuota,
      usedQuota: row.usedQuota,
      modelLimitsOn: row.modelLimitsOn,
      modelLimits: row.modelLimits,
      allowIps: row.allowIps,
      expiredAt: row.expiredAt,
      group: row.group,
      createdAt: row.createdAt,
      accessedAt: row.accessedAt,
    };
  }

  /**
   * 令牌按「谁在哪个租户里发的」收口：同一账号在不同租户各有一套令牌，
   * 切租户后列表跟着换，不会把 A 租户发的令牌拿到 B 租户花额度。
   * 管理员全量视图（不传 userId）附带归属人与租户名。
   */
  async list(userId?: number, tenantId?: number | null) {
    const where =
      userId === undefined
        ? {}
        : tenantId
          ? { userId, tenantId }
          : { userId, tenantId: 0 };
    const rows = await this.prisma.token.findMany({
      where,
      orderBy: { id: 'desc' },
    });
    const views = rows.map((row) => this.toView(row));
    if (userId) return views;
    const [owners, tenants] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(rows.map((row) => row.userId))] } },
        select: { id: true, username: true, displayName: true },
      }),
      this.prisma.tenant.findMany({
        where: { id: { in: [...new Set(rows.map((row) => row.tenantId))] } },
        select: { id: true, name: true },
      }),
    ]);
    const names = new Map(
      owners.map((owner) => [owner.id, owner.displayName || owner.username]),
    );
    const tenantNames = new Map(tenants.map((row) => [row.id, row.name]));
    return views.map((view) => ({
      ...view,
      userName: names.get(view.userId) || '',
      tenantName: tenantNames.get(view.tenantId) || '',
    }));
  }

  /** 完整 sk- 密钥只在创建时返回一次，之后仅掩码展示。 */
  async create(
    userId: number,
    tenantId: number,
    input: {
      name?: string;
      remainQuota?: number;
      unlimitedQuota?: boolean;
      expiredAt?: number;
      modelLimitsOn?: boolean;
      modelLimits?: string;
      allowIps?: string;
      group?: string;
    },
  ) {
    if (!tenantId) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '请先创建或加入一个租户，再签发令牌：令牌要记在租户内，才知道扣谁的额度',
      );
    }
    const key = generateTokenKey();
    const row = await this.prisma.token.create({
      data: {
        userId,
        tenantId,
        key,
        name: text(input.name).slice(0, 64),
        remainQuota: Math.max(0, Math.trunc(Number(input.remainQuota ?? 0))),
        unlimitedQuota: input.unlimitedQuota !== false,
        expiredAt: normalizeExpiredAt(Number(input.expiredAt ?? -1)),
        modelLimitsOn: Boolean(input.modelLimitsOn),
        modelLimits: text(input.modelLimits),
        allowIps: normalizeAllowIps(text(input.allowIps)),
        group: text(input.group) || 'default',
      },
    });
    return { ...this.toView(row), key: `sk-${key}` };
  }

  async update(
    id: number,
    userId: number,
    tenantId: number | null,
    input: Record<string, unknown>,
    isAdmin: boolean,
  ) {
    const row = await this.prisma.token.findUnique({ where: { id } });
    if (!row || (!isAdmin && !this.owns(row, userId, tenantId))) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '令牌不存在');
    }
    const data: Record<string, unknown> = {};
    for (const field of [
      'name',
      'status',
      'remainQuota',
      'unlimitedQuota',
      'expiredAt',
      'modelLimitsOn',
      'modelLimits',
      'allowIps',
      'group',
    ] as const) {
      if (input[field] !== undefined) data[field] = input[field];
    }
    if (input.allowIps !== undefined) {
      data.allowIps = normalizeAllowIps(text(input.allowIps));
    }
    if (input.expiredAt !== undefined) {
      data.expiredAt = normalizeExpiredAt(Number(input.expiredAt));
    }
    const updated = await this.prisma.token.update({ where: { id }, data });
    return this.toView(updated);
  }

  async remove(id: number, userId: number, tenantId: number | null, isAdmin: boolean) {
    const row = await this.prisma.token.findUnique({ where: { id } });
    if (!row || (!isAdmin && !this.owns(row, userId, tenantId))) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '令牌不存在');
    }
    await this.prisma.token.delete({ where: { id } });
  }

  /** 归属判定：令牌属于「这个人在这个租户里发的那一把」，换租户就不是自己的了。 */
  private owns(
    row: { userId: number; tenantId: number },
    userId: number,
    tenantId: number | null,
  ) {
    return row.userId === userId && row.tenantId === (tenantId ?? 0);
  }

  /**
   * 网关鉴权：接受带/不带 sk- 前缀的密钥。
   * 令牌自带归属租户，所以调用落在签发它的那个租户里，扣该租户划给这个账号的额度。
   */
  async verify(rawKey: string) {
    const key = rawKey.trim().replace(/^sk-/, '').split('-')[0];
    const token = await this.prisma.token.findUnique({ where: { key } });
    if (!token || token.status !== 1) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '无效的 API 密钥');
    }
    if (!token.tenantId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '这把令牌没有归属租户（历史遗留），请在当前租户下重新签发',
      );
    }
    const [user, membership] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: token.userId } }),
      this.prisma.tenantMember.findUnique({
        where: {
          tenantId_userId: { tenantId: token.tenantId, userId: token.userId },
        },
        include: { tenant: { select: { status: true, name: true } } },
      }),
    ]);
    if (!user || user.status !== 1) {
      throw new BusinessException(ErrorCode.FORBIDDEN, '账号不可用');
    }
    if (!membership || membership.status !== 1) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '这个令牌所属的租户成员身份已停用或已移除',
      );
    }
    // 平台停用租户＝该租户下所有成员的调用一起停：这是「系统管理员管租户」的落点
    if (membership.tenant.status !== 1) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        `所属租户「${membership.tenant.name}」已被平台停用`,
      );
    }
    if (token.expiredAt >= 0 && token.expiredAt * 1000 < Date.now()) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '令牌已过期');
    }
    if (!token.unlimitedQuota && token.remainQuota <= 0) {
      throw new BusinessException(ErrorCode.QUOTA_EXCEEDED, '令牌剩余额度不足');
    }
    return { token, user, membership };
  }
}

/**
 * 白名单存归一化形式（逗号分隔、去重）。写错的规则在线上一律表现为「来源 IP 不在白名单内」，
 * 调用方看不出是笔误还是真没授权，所以非法规则直接拒收并点名是哪一条。
 */
function normalizeAllowIps(raw: string): string {
  const rules = [...new Set(parseIpRules(raw))];
  const bad = findInvalidIpRule(rules);
  if (bad) {
    throw new BusinessException(
      ErrorCode.VALIDATION_ERROR,
      `IP 白名单里的 "${bad}" 无法匹配：支持 * 、精确 IPv4/IPv6、CIDR 网段（如 5.6.7.0/24）、前缀通配（如 10.0.*）`,
    );
  }
  return rules.join(',');
}

/**
 * 有效期只有两个状态：非正数一律收成 -1（永不过期），其余是秒级时间戳。
 * `0` 也得收成 -1：网关按「>=0 即过期待判定」处理，留着 0 会变成界面显示「永不过期」、
 * 调用却被判「令牌已过期」，而 1970 年的时间戳不可能是有人想要的有效期。
 */
function normalizeExpiredAt(value: number): number {
  const seconds = Math.trunc(Number(value));
  if (!Number.isFinite(seconds)) return -1;
  return seconds <= 0 ? -1 : seconds;
}
