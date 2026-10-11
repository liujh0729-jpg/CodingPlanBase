import { Injectable } from '@nestjs/common';
import { normalizeApiPrefix } from './gateway.constants';

export interface CachedChannel {
  id: number;
  type: number;
  name: string;
  keys: string[];
  keyIndex: number;
  baseUrl: string;
  apiPrefix: string;
  models: string[];
  group: string;
  priority: number;
  weight: number;
  autoBan: boolean;
  modelMapping: Record<string, string>;
  headerOverride: Record<string, string>;
  paramOverride: Record<string, unknown>;
  isManaged: boolean;
}

@Injectable()
export class ChannelCacheService {
  private channels: CachedChannel[] = [];

  setChannels(
    rows: Array<{
      id: number;
      type: number;
      name: string;
      key: string;
      baseUrl: string;
      apiPrefix: string;
      models: string;
      group: string;
      priority: number;
      weight: number;
      autoBan: number;
      modelMapping: string;
      headerOverride: string;
      paramOverride: string;
      isManaged: number;
    }>,
  ) {
    this.channels = rows
      .filter((row) => row.group && row.name)
      .map((row) => ({
        id: row.id,
        type: row.type,
        name: row.name,
        keys: row.key
          .split('\n')
          .map((item) => item.trim())
          .filter(Boolean),
        keyIndex: 0,
        baseUrl: row.baseUrl,
        apiPrefix: normalizeApiPrefix(row.apiPrefix),
        models: parseModelList(row.models),
        group: row.group,
        priority: row.priority,
        weight: row.weight,
        autoBan: row.autoBan === 1,
        modelMapping: parseJsonRecord(row.modelMapping),
        headerOverride: parseJsonRecord(row.headerOverride),
        paramOverride: parseJsonObject(row.paramOverride),
        isManaged: row.isManaged === 1,
      }))
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * 渠道选择（镜像 newapi GetRandomSatisfiedChannel）：
   * 先按模型过滤（支持 '*' 通配），再取最高 priority 层，层内按 weight 加权随机；
   * 全层 weight 为 0 时按均权处理（每个渠道有效权重 100）。
   * `excludeChannelIds` 是本次请求已经失败的渠道，故障转移靠它逐层排除。
   */
  select(
    group: string,
    model: string,
    excludeChannelIds: number[] = [],
  ): CachedChannel | null {
    const candidates = this.channels.filter(
      (channel) =>
        channel.keys.length > 0 &&
        (channel.group
          .split(',')
          .map((g) => g.trim())
          .includes(group) ||
          channel.group.split(',').includes('auto')) &&
        !excludeChannelIds.includes(channel.id) &&
        (channel.models.includes('*') ||
          channel.models.includes(model) ||
          Object.values(channel.modelMapping).includes(model)),
    );
    if (candidates.length === 0) return null;
    const topPriority = candidates[0].priority;
    const tier = candidates.filter(
      (channel) => channel.priority === topPriority,
    );
    const totalWeight = tier.reduce((sum, channel) => sum + channel.weight, 0);
    if (totalWeight <= 0) {
      return tier[Math.floor(Math.random() * tier.length)];
    }
    let roll = Math.random() * totalWeight;
    for (const channel of tier) {
      roll -= channel.weight;
      if (roll <= 0) return channel;
    }
    return tier[tier.length - 1];
  }

  /** 指定类型且分组的托管渠道（取最小 id，保持与 DB 侧 managedAipddChannel 一致）。 */
  findManaged(type: number, group: string): CachedChannel | null {
    const matched = this.channels.filter(
      (channel) =>
        channel.isManaged &&
        channel.type === type &&
        channel.keys.length > 0 &&
        (channel.group
          .split(',')
          .map((g) => g.trim())
          .includes(group) ||
          channel.group.split(',').includes('auto')),
    );
    if (matched.length === 0) return null;
    return matched.reduce((best, item) => (item.id < best.id ? item : best));
  }

  /** 同渠道内多 key 轮询；上游返回 key 级错误时可调用方换 key 重试。 */
  pickKey(channel: CachedChannel): string {
    const key = channel.keys[channel.keyIndex % channel.keys.length];
    channel.keyIndex = (channel.keyIndex + 1) % channel.keys.length;
    return key;
  }

  mappedModel(channel: CachedChannel, requested: string): string {
    return channel.modelMapping[requested] || requested;
  }
}

/**
 * 空模型清单＝接受该分组下的全部模型（与管理界面「留空表示全部」同一口径），
 * 缓存里统一用 '*' 通配表示，否则这种渠道会被选路永久跳过。
 */
function parseModelList(raw: string): string[] {
  const models = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return models.length > 0 ? models : ['*'];
}

function parseJsonRecord(raw: string): Record<string, string> {
  const value = parseJsonObject(raw);
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') out[key] = item;
  }
  return out;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
