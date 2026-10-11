import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ModelConfig {
  modelName: string;
  quotaType: number;
  modelRatio: number; // 输入 元 / 1M tokens
  completionRatio: number;
  cacheReadRatio: number;
  cacheWriteRatio: number;
  callCnyPrice: number;
  groupRatio: number;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  cnyCost(cfg: ModelConfig, usage: TokenUsage): number {
    if (cfg.quotaType === 1) return cfg.callCnyPrice;
    const inCny =
      (usage.promptTokens * cfg.modelRatio +
        usage.completionTokens * cfg.modelRatio * cfg.completionRatio +
        usage.cacheReadTokens * cfg.modelRatio * cfg.cacheReadRatio +
        usage.cacheWriteTokens * cfg.modelRatio * cfg.cacheWriteRatio) /
      1_000_000;
    return inCny * cfg.groupRatio;
  }

  /** quota = 人民币成本 × QuotaPerUnit；markup 倍率用于反推上游批发成本（利润 = 零售 − 批发）。 */
  async computeQuota(cfg: ModelConfig, usage: TokenUsage) {
    const [perUnit, markup] = await Promise.all([
      this.settings.getNumber('quota_per_unit'),
      this.settings.getNumber('pricing_markup'),
    ]);
    const cny = this.cnyCost(cfg, usage);
    const quota = Math.max(0, Math.round(cny * perUnit));
    const wholesaleCny = markup > 0 ? cny / markup : cny;
    return { quota, cny, wholesaleCny };
  }

  /**
   * 结算扣费：扣的是「这个人在这个租户里」的那份额度（`tenant_members`），
   * 原子递减，余额不足时扣到 0（不阻断已完成的请求）。
   * 同一个人换到别的租户，花的是另一个租户划的额度，两边互不影响。
   */
  async settle(params: {
    user: { id: number; username: string };
    /** 令牌归属的租户＝本次调用的记账租户 */
    tenantId: number;
    /** 该成员在本租户内的剩余额度，用于把实扣收拢到不超过余额 */
    memberQuota: number;
    token: { id: number; name: string; unlimitedQuota: boolean };
    cfg: ModelConfig;
    usage: TokenUsage;
    channelId: number | null;
    channelName: string;
    group: string;
    stream: boolean;
    useTimeMs: number;
    ip: string;
    requestId: string;
  }) {
    const { quota, cny, wholesaleCny } = await this.computeQuota(
      params.cfg,
      params.usage,
    );
    const actual = Math.min(quota, Math.max(0, params.memberQuota));
    // updateMany：账号/成员关系/令牌/渠道可能在请求进行中被人删除，计费不应因此抛错
    if (actual > 0) {
      await this.prisma.tenantMember.updateMany({
        where: { tenantId: params.tenantId, userId: params.user.id },
        data: {
          quota: { decrement: actual },
          usedQuota: { increment: actual },
        },
      });
      // 成员消耗同时计入租户，平台侧才看得出这个租户用了多少
      await this.prisma.tenant.updateMany({
        where: { id: params.tenantId },
        data: { usedQuota: { increment: actual } },
      });
    }
    await this.prisma.tenantMember.updateMany({
      where: { tenantId: params.tenantId, userId: params.user.id },
      data: { requestCount: { increment: 1 } },
    });
    if (params.token.unlimitedQuota) {
      await this.prisma.token.updateMany({
        where: { id: params.token.id },
        data: {
          usedQuota: { increment: quota },
          accessedAt: Math.floor(Date.now() / 1000),
        },
      });
    } else {
      await this.prisma.token.updateMany({
        where: { id: params.token.id },
        data: {
          remainQuota: { decrement: quota },
          usedQuota: { increment: quota },
          accessedAt: Math.floor(Date.now() / 1000),
        },
      });
      // 计费在响应之后落库，同一瞬间的并发请求会同时通过额度校验并把余额扣成负数；
      // 归零让令牌上限从下一次调用起立即生效，也让管理端不会显示负额度
      await this.prisma.token.updateMany({
        where: { id: params.token.id, remainQuota: { lt: 0 } },
        data: { remainQuota: 0 },
      });
    }
    if (params.channelId) {
      await this.prisma.channel.updateMany({
        where: { id: params.channelId },
        data: { usedQuota: { increment: quota } },
      });
    }
    const log = await this.prisma.log.create({
      data: {
        userId: params.user.id,
        tenantId: params.tenantId,
        type: 2, // Consume
        username: params.user.username,
        tokenName: params.token.name,
        modelName: params.cfg.modelName,
        quota,
        promptTokens: params.usage.promptTokens,
        completionTokens: params.usage.completionTokens,
        useTime: params.useTimeMs,
        isStream: params.stream,
        channelId: params.channelId,
        channelName: params.channelName,
        tokenId: params.token.id,
        group: params.group,
        ip: params.ip,
        requestId: params.requestId,
        other: JSON.stringify({
          retail_cny: Number(cny.toFixed(6)),
          wholesale_cny: Number(wholesaleCny.toFixed(6)),
          profit_cny: Number((cny - wholesaleCny).toFixed(6)),
          quota_per_unit: await this.settings.getNumber('quota_per_unit'),
        }),
      },
    });
    return { quota, actual, cny, logId: log.id };
  }
}
