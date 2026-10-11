import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  CHANNEL_STATUS,
  CHANNEL_TYPE_AIPDD,
  channelProtocol,
  isKeyRejection,
  isRetryableStatus,
  ipMatches,
  joinBaseUrl,
  parseIpRules,
  redactKeys,
  upstreamAuthHeaders,
  upstreamPath,
} from './gateway.constants';
import type { ModelConfig, TokenUsage } from './billing.service';
import { BillingService } from './billing.service';
import { ChannelCacheService, CachedChannel } from './channel-cache.service';
import { ChannelsService } from './channels.service';
import { TokensService } from './tokens.service';

export interface RelayContext {
  token: Awaited<ReturnType<TokensService['verify']>>['token'];
  user: Awaited<ReturnType<TokensService['verify']>>['user'];
  /** 令牌归属租户里这个账号的成员身份：额度、用量都记在它上面。 */
  membership: Awaited<ReturnType<TokensService['verify']>>['membership'];
}

/** 一次上游调用的失败描述；`status === 0` 表示连接层失败，没有上游响应可透传。 */
interface UpstreamFailure {
  status: number;
  contentType: string;
  /** 未掩码的上游原文，仅用于密钥级失败判定 */
  body: string;
  /** 已按渠道密钥掩码并截断，进日志与管理界面 */
  message: string;
  retryable: boolean;
}

type UpstreamOutcome =
  | { ok: true; upstream: globalThis.Response }
  | { ok: false; failure: UpstreamFailure };

type Attempt =
  | { ok: true; channel: CachedChannel; upstream: globalThis.Response }
  | { ok: false; channel: CachedChannel; failure: UpstreamFailure };

/** 一次客户端请求最多尝试的渠道数 / 同一渠道内最多轮换的密钥数。 */
const MAX_CHANNEL_ATTEMPTS = 3;
const MAX_KEY_ATTEMPTS = 3;

@Injectable()
export class RelayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly cache: ChannelCacheService,
    private readonly billing: BillingService,
    private readonly channels: ChannelsService,
  ) {}

  async authenticate(request: {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
  }): Promise<RelayContext> {
    const raw = extractClientKey(request);
    if (!raw) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, 'missing api key');
    }
    const { token, user, membership } = await this.tokens.verify(raw);
    if (token.allowIps) {
      const clientIp = normalizeIp(request.ip || '');
      const allowed = parseIpRules(token.allowIps);
      if (allowed.length > 0 && !ipMatches(clientIp, allowed)) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          '来源 IP 不在令牌白名单内',
        );
      }
    }
    return { token, user, membership };
  }

  async listModels(ctx: RelayContext) {
    const rows = await this.prisma.gatewayModel.findMany({
      orderBy: { id: 'asc' },
    });
    const group = ctx.token.group || ctx.user.userGroup || 'default';
    return {
      object: 'list',
      data: rows
        .filter((row) => {
          // 留空 = 不限分组（与令牌 IP 白名单、模型白名单同一口径）
          const groups = row.enableGroups
            .split(',')
            .map((g) => g.trim())
            .filter(Boolean);
          return groups.length === 0 || groups.includes(group);
        })
        .map((row) => ({
          id: row.modelName,
          object: 'model',
          created: Math.floor(row.createdAt.getTime() / 1000),
          owned_by: row.vendorName || 'gateway',
        })),
    };
  }

  async chat(
    ctx: RelayContext,
    body: Record<string, unknown>,
    path: string,
    requestHeaders: Record<string, string | string[] | undefined>,
    clientIp: string,
    response: Response,
  ) {
    const model = typeof body.model === 'string' ? body.model : '';
    if (!model) {
      throw new BusinessException(ErrorCode.VALIDATION_ERROR, '缺少 model');
    }
    if (ctx.token.modelLimitsOn) {
      const limits = ctx.token.modelLimits
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);
      if (limits.length > 0 && !limits.includes(model)) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          `令牌不允许访问模型 ${model}`,
        );
      }
    }
    if (ctx.membership.quota <= 0) {
      throw new BusinessException(
        ErrorCode.QUOTA_EXCEEDED,
        '当前租户内额度不足，请联系该租户管理员分配额度',
      );
    }
    const group = ctx.token.group || ctx.user.userGroup || 'default';
    const stream = Boolean(body.stream);
    const started = Date.now();
    const requestId = randomUUID();
    const cfg = await this.modelConfig(model);

    // 故障转移：一次请求最多试 MAX_CHANNEL_ATTEMPTS 个渠道，失败的渠道进排除名单后
    // 由 select() 重新加权选路（同层剩余渠道 → 次高优先级层）。客户端在拿到上游
    // 有效响应之前收不到任何字节，因此全部失败时透传最后一次的 upstream 状态与报文（已掩码密钥）。
    const excluded: number[] = [];
    let last: Attempt | null = null;
    for (let attempt = 0; attempt < MAX_CHANNEL_ATTEMPTS; attempt++) {
      const channel = this.pickChannel(group, model, excluded);
      if (!channel) break;
      excluded.push(channel.id);
      const outcome = await this.callUpstream(
        channel,
        body,
        path,
        model,
        stream,
        requestHeaders,
      );
      if (outcome.ok) {
        last = { ok: true, channel, upstream: outcome.upstream };
        break;
      }
      last = { ok: false, channel, failure: outcome.failure };
      await this.autoBanIfNeeded(channel, outcome.failure);
      await this.recordError(
        ctx,
        channel,
        model,
        outcome.failure.message,
        requestId,
        clientIp,
      );
      if (!outcome.failure.retryable) break;
    }

    if (!last) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        `没有可用渠道支持模型 ${model}（请检查渠道状态、分组与模型列表）`,
      );
    }
    if (!last.ok) {
      const { failure } = last;
      if (failure.status === 0) {
        throw new BusinessException(
          ErrorCode.SERVICE_UNAVAILABLE,
          `上游连接失败: ${failure.message}`,
        );
      }
      response
        .status(failure.status)
        .set('Content-Type', failure.contentType)
        .send(failure.body);
      return;
    }

    const { channel, upstream } = last;
    const isAnthropicUpstream = channelProtocol(channel.type) === 'anthropic';

    let usage: TokenUsage;
    if (stream && upstream.body) {
      usage = await this.pipeStream(
        upstream.body,
        response,
        isAnthropicUpstream,
      );
    } else {
      const json = (await upstream.json()) as Record<string, unknown>;
      usage = extractUsage(json, isAnthropicUpstream);
      response.status(200).json(json);
    }

    await this.billing.settle({
      user: { id: ctx.user.id, username: ctx.user.username },
      tenantId: ctx.token.tenantId,
      memberQuota: ctx.membership.quota,
      token: {
        id: ctx.token.id,
        name: ctx.token.name,
        unlimitedQuota: ctx.token.unlimitedQuota,
      },
      cfg: { ...cfg, modelName: model },
      usage,
      channelId: channel.id,
      channelName: channel.name,
      group,
      stream,
      useTimeMs: Date.now() - started,
      ip: normalizeIp(clientIp),
      requestId,
    });
  }

  /** 流式转发：原样透传 SSE，同时旁路解析最后一个带 usage 的块。 */
  private async pipeStream(
    body: ReadableStream<Uint8Array>,
    response: Response,
    anthropic: boolean,
  ): Promise<TokenUsage> {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    let sawUsage = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      response.write(value);
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const candidate = extractUsage(JSON.parse(data), anthropic);
          if (
            candidate.promptTokens > 0 ||
            candidate.completionTokens > 0 ||
            sawUsage
          ) {
            usage = candidate;
            sawUsage = true;
          }
        } catch {
          // 单行非完整 JSON（Anthropic 的 usage 分布在多个事件里）：忽略该行
        }
      }
    }
    response.end();
    return usage;
  }

  /**
   * 本轮未试过的渠道里选一个：常规选路（优先级分层 + 层内权重）为空时退到托管 AIPDD
   * 渠道——模型全集兜底，保证「上游刚发布、本地目录还没同步」的窗口期不阻断调用；
   * 兜底渠道也已在排除名单里时返回 null，交回上层结束故障转移。
   */
  private pickChannel(
    group: string,
    model: string,
    excluded: number[],
  ): CachedChannel | null {
    const channel =
      this.cache.select(group, model, excluded) ??
      this.cache.findManaged(CHANNEL_TYPE_AIPDD, group);
    if (!channel || excluded.includes(channel.id)) return null;
    return channel;
  }

  /**
   * 单渠道一次调用：密钥级失败（401/403/报文含 invalid api key）在同一渠道内换下一个
   * key 重试，最多 MAX_KEY_ATTEMPTS 次；其余失败（含连不上）立即返回，由上层决定是否换渠道。
   * 上游报文按该渠道已知密钥做掩码后才出参，避免回显的密钥进日志与渠道备注。
   */
  private async callUpstream(
    channel: CachedChannel,
    body: Record<string, unknown>,
    path: string,
    model: string,
    stream: boolean,
    requestHeaders: Record<string, string | string[] | undefined>,
  ): Promise<UpstreamOutcome> {
    const protocol = channelProtocol(channel.type);
    const isAnthropicUpstream = protocol === 'anthropic';
    const payload: Record<string, unknown> = {
      ...body,
      model: this.cache.mappedModel(channel, model),
    };
    if (stream && !isAnthropicUpstream && path === '/v1/chat/completions') {
      const options = (payload.stream_options || {}) as Record<string, unknown>;
      payload.stream_options = { ...options, include_usage: true };
    }
    Object.assign(payload, channel.paramOverride);

    const keyAttempts = Math.min(
      Math.max(channel.keys.length, 1),
      MAX_KEY_ATTEMPTS,
    );
    let failure: UpstreamFailure = {
      status: 0,
      contentType: 'application/json',
      body: '',
      message: '渠道没有可用密钥',
      retryable: false,
    };
    for (let i = 0; i < keyAttempts; i++) {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...upstreamAuthHeaders(protocol, this.cache.pickKey(channel)),
        ...channel.headerOverride,
      };
      if (isAnthropicUpstream) {
        headers['anthropic-version'] =
          firstHeader(requestHeaders, 'anthropic-version') || '2023-06-01';
      }
      let upstream: globalThis.Response;
      try {
        upstream = await fetch(
          joinBaseUrl(
            channel.baseUrl,
            channel.apiPrefix,
            upstreamPath(
              channel.apiPrefix,
              isAnthropicUpstream ? '/v1/messages' : path,
            ),
          ),
          {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // 连不上是渠道整体不可用（域名/网络），换 key 没有意义，直接交给上层换渠道
        return {
          ok: false,
          failure: {
            status: 0,
            contentType: 'application/json',
            body: message,
            message,
            retryable: true,
          },
        };
      }
      if (upstream.ok) return { ok: true, upstream };

      // 透传前必须掩码：上游错误报文里的 key 是平台侧的渠道密钥，不是调用方自己的，
      // 原样回给租户等于把上游密钥泄露给所有租户。
      const raw = redactKeys(
        await upstream.text().catch(() => ''),
        channel.keys,
      );
      const keyRejected = isKeyRejection(upstream.status, raw);
      failure = {
        status: upstream.status,
        contentType: upstream.headers.get('content-type') || 'application/json',
        body: raw.slice(0, 4000),
        message: `HTTP ${upstream.status}: ${raw.slice(0, 200)}`,
        retryable: keyRejected || isRetryableStatus(upstream.status),
      };
      if (!keyRejected) break;
    }
    return { ok: false, failure };
  }

  private async autoBanIfNeeded(
    channel: CachedChannel,
    failure: UpstreamFailure,
  ) {
    if (channel.autoBan && isKeyRejection(failure.status, failure.body)) {
      await this.prisma.channel.update({
        where: { id: channel.id },
        data: {
          status: CHANNEL_STATUS.AUTO_DISABLED,
          remark: `自动禁用：上游密钥被拒 HTTP ${failure.status}`.slice(0, 250),
        },
      });
      await this.channels.refreshCache();
    }
  }

  private async recordError(
    ctx: RelayContext,
    channel: CachedChannel,
    model: string,
    content: string,
    requestId: string,
    clientIp: string,
  ) {
    await this.prisma.log.create({
      data: {
        userId: ctx.user.id,
        tenantId: ctx.token.tenantId,
        type: 5, // Error
        username: ctx.user.username,
        tokenName: ctx.token.name,
        modelName: model,
        channelId: channel.id,
        channelName: channel.name,
        tokenId: ctx.token.id,
        group: ctx.token.group,
        content,
        requestId,
        ip: normalizeIp(clientIp),
      },
    });
  }

  private async modelConfig(modelName: string): Promise<ModelConfig> {
    let row = await this.prisma.gatewayModel.findUnique({
      where: { modelName },
    });
    if (!row) {
      // 未知模型先按 0 价放行（可用性优先），定价页或目录同步补价后生效
      row = await this.prisma.gatewayModel.create({
        data: {
          modelName,
          priceSource: 'auto',
          modelRatio: 0,
          completionRatio: 1,
        },
      });
    }
    return {
      modelName: row.modelName,
      quotaType: row.quotaType,
      modelRatio: row.modelRatio,
      completionRatio: row.completionRatio,
      cacheReadRatio: row.cacheReadRatio,
      cacheWriteRatio: row.cacheWriteRatio,
      callCnyPrice: row.callCnyPrice,
      groupRatio: row.groupRatio,
    };
  }
}

function extractClientKey(request: {
  headers: Record<string, string | string[] | undefined>;
}): string {
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const apiKey = request.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey) return apiKey.trim();
  const goog = request.headers['x-goog-api-key'];
  if (typeof goog === 'string' && goog) return goog.trim();
  return '';
}

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const value = headers[name];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function normalizeIp(ip: string): string {
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  return ip === '::1' ? '127.0.0.1' : ip;
}

function extractUsage(json: unknown, anthropic: boolean): TokenUsage {
  const empty: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
  const usage = (json as Record<string, unknown> | null)?.usage as
    Record<string, unknown> | undefined;
  if (!usage) return empty;
  if (anthropic) {
    return {
      promptTokens: Number(usage.input_tokens || 0),
      completionTokens: Number(usage.output_tokens || 0),
      cacheReadTokens: Number(usage.cache_read_input_tokens || 0),
      cacheWriteTokens: Number(usage.cache_creation_input_tokens || 0),
    };
  }
  const details = (usage.prompt_tokens_details || {}) as Record<
    string,
    unknown
  >;
  // OpenAI 字段优先；个别兼容网关按 Anthropic 命名返回，需要兜底否则漏计费
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const completionTokens = Number(
    usage.completion_tokens ?? usage.output_tokens ?? 0,
  );
  return {
    promptTokens,
    completionTokens,
    cacheReadTokens: Number(
      details.cached_tokens ?? usage.cache_read_input_tokens ?? 0,
    ),
    cacheWriteTokens: Number(
      details.cache_creation_input_tokens ??
        usage.cache_creation_input_tokens ??
        0,
    ),
  };
}
