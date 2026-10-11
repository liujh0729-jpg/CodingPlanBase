import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { text } from '../common/api';
import {
  CHANNEL_STATUS,
  CHANNEL_TYPE_AIPDD,
  CHANNEL_TYPE_OPENAI,
  channelProtocol,
  joinBaseUrl,
  maskKey,
  normalizeApiPrefix,
  redactKeys,
  upstreamAuthHeaders,
  upstreamPath,
} from './gateway.constants';
import {
  CHANNEL_PRESETS,
  creatablePresets,
  findPresetByKey,
  isKnownChannelType,
  type ChannelPreset,
} from './channel-presets';
import { ChannelCacheService } from './channel-cache.service';

@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ChannelCacheService,
  ) {}

  async refreshCache() {
    const rows = await this.prisma.channel.findMany({
      where: { status: CHANNEL_STATUS.ENABLED },
      select: {
        id: true,
        type: true,
        name: true,
        key: true,
        baseUrl: true,
        apiPrefix: true,
        models: true,
        group: true,
        priority: true,
        weight: true,
        autoBan: true,
        modelMapping: true,
        headerOverride: true,
        paramOverride: true,
        isManaged: true,
      },
      orderBy: [{ priority: 'desc' }, { id: 'asc' }],
    });
    this.cache.setChannels(rows);
  }

  /** 返回给管理端：key 永远掩码，绝不把上游密钥明文发给前端。 */
  private toAdmin(row: Record<string, unknown>) {
    const key = text(row.key);
    const keys = key.split('\n').filter(Boolean);
    return {
      ...row,
      key: undefined,
      keyCount: keys.length,
      keyMasked: keys.map((item) => maskKey(item)).join(', '),
    };
  }

  async list() {
    const rows = await this.prisma.channel.findMany({
      orderBy: [{ priority: 'desc' }, { id: 'asc' }],
    });
    return rows.map((row) =>
      this.toAdmin(row as unknown as Record<string, unknown>),
    );
  }

  async get(id: number) {
    const row = await this.prisma.channel.findUnique({ where: { id } });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '渠道不存在');
    return this.toAdmin(row);
  }

  async create(input: Record<string, unknown>) {
    const preset = resolvePreset(input);
    const data = this.normalizeInput(input);
    const name = (data.name || '').trim();
    if (!name)
      throw new BusinessException(ErrorCode.VALIDATION_ERROR, '渠道名称必填');
    const key = (data.key || '').trim();
    if (!key)
      throw new BusinessException(ErrorCode.VALIDATION_ERROR, '渠道密钥必填');
    // 模板只提供缺省值：表单里填了就按填的走，管理员要改地址/前缀随时能覆盖
    const type =
      data.type === undefined && preset
        ? preset.type
        : this.assertChannelType(data.type);
    const baseUrl = (data.baseUrl || (preset ? preset.baseUrl : '')).trim();
    // 没有 Base URL 的渠道能进选路池，但每次调用都会在连接层失败，所以要在建渠道时就拒
    if (!baseUrl)
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '渠道 Base URL 必填',
      );
    const apiPrefix =
      data.apiPrefix === undefined
        ? normalizeApiPrefix(preset?.apiPrefix)
        : data.apiPrefix;
    const created = await this.prisma.channel.create({
      data: { ...data, type, name, key, baseUrl, apiPrefix },
    });
    await this.refreshCache();
    return this.toAdmin(created);
  }

  async update(id: number, input: Record<string, unknown>) {
    const existing = await this.prisma.channel.findUnique({ where: { id } });
    if (!existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '渠道不存在');
    const data = this.normalizeInput(input);
    if (data.type !== undefined) data.type = this.assertChannelType(data.type);
    // key 留空表示不修改（编辑表单不回显旧密钥）
    if (!data.key) delete data.key;
    if (data.baseUrl !== undefined && !data.baseUrl)
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '渠道 Base URL 必填',
      );
    const updated = await this.prisma.channel.update({ where: { id }, data });
    await this.refreshCache();
    return this.toAdmin(updated);
  }

  async setStatus(id: number, status: number) {
    await this.prisma.channel.update({
      where: { id },
      data: {
        status,
        ...(status === CHANNEL_STATUS.ENABLED ? { remark: '' } : {}),
      },
    });
    await this.refreshCache();
    return this.get(id);
  }

  async remove(id: number) {
    const existing = await this.prisma.channel.findUnique({ where: { id } });
    if (!existing)
      throw new BusinessException(ErrorCode.NOT_FOUND, '渠道不存在');
    await this.prisma.channel.delete({ where: { id } });
    await this.refreshCache();
  }

  /** 手动测试：向渠道发一条最小请求，更新状态/响应时间/自动禁用。 */
  async test(id: number, model?: string) {
    const channel = await this.prisma.channel.findUnique({ where: { id } });
    if (!channel)
      throw new BusinessException(ErrorCode.NOT_FOUND, '渠道不存在');
    const useModel =
      text(model) ||
      text(channel.testModel) ||
      channel.models.split(',')[0]?.trim() ||
      '';
    if (!useModel) {
      throw new BusinessException(ErrorCode.VALIDATION_ERROR, '缺少测试模型');
    }
    const started = Date.now();
    const keys = channel.key.split('\n').filter(Boolean);
    const protocol = channelProtocol(channel.type);
    const path = upstreamPath(
      channel.apiPrefix,
      protocol === 'anthropic' ? '/v1/messages' : '/v1/chat/completions',
    );
    let okFlag = false;
    let message = '';
    try {
      const response = await fetch(
        joinBaseUrl(channel.baseUrl, channel.apiPrefix, path),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...upstreamAuthHeaders(protocol, keys[0] || ''),
          },
          body: JSON.stringify({
            model: useModel,
            messages: [{ role: 'user', content: 'ok?' }],
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      okFlag = response.ok;
      if (!okFlag) {
        // 报文会写进渠道备注并在列表展开行显示：先按本渠道密钥掩码再截断
        const raw = await response.text().catch(() => '');
        message = `HTTP ${response.status} ${redactKeys(raw, keys).slice(0, 200)}`;
      }
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    const elapsed = Date.now() - started;
    let status = channel.status;
    if (
      !okFlag &&
      channel.autoBan === 1 &&
      channel.status === CHANNEL_STATUS.ENABLED
    ) {
      status = CHANNEL_STATUS.AUTO_DISABLED;
    }
    if (okFlag && channel.status !== CHANNEL_STATUS.MANUALLY_DISABLED) {
      status = CHANNEL_STATUS.ENABLED;
    }
    await this.prisma.channel.update({
      where: { id },
      data: {
        responseTime: elapsed,
        status,
        remark: okFlag ? '' : message.slice(0, 250),
      },
    });
    await this.refreshCache();
    return { ok: okFlag, message, elapsed, status };
  }

  /**
   * 上游标准模板（new-api 的类型编号 + 默认地址 + 路径前缀）。
   * 含托管 AIPDD：列表页的「类型」列要靠它把编号翻成名字，表单下拉按 creatable 过滤。
   */
  presets() {
    return CHANNEL_PRESETS;
  }

  /**
   * 从上游拉取模型清单（new-api 渠道页的「获取模型列表」）：只读、不落库，
   * 结果由界面回填「模型」输入框。请求地址与密钥只取库里已存的渠道，界面不提交
   * Base URL，服务端就不会被指向任意主机。
   */
  async fetchModels(id: number) {
    const channel = await this.prisma.channel.findUnique({ where: { id } });
    if (!channel)
      throw new BusinessException(ErrorCode.NOT_FOUND, '渠道不存在');
    const keys = channel.key.split('\n').filter(Boolean);
    if (keys.length === 0)
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '渠道没有可用密钥，请先保存密钥',
      );
    const protocol = channelProtocol(channel.type);
    const path = upstreamPath(channel.apiPrefix, '/v1/models');
    let response: globalThis.Response;
    try {
      response = await fetch(
        joinBaseUrl(channel.baseUrl, channel.apiPrefix, path),
        {
          headers: upstreamAuthHeaders(protocol, keys[0]),
          signal: AbortSignal.timeout(20_000),
        },
      );
    } catch (error) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `上游连接失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const raw = await response.text().catch(() => '');
    if (!response.ok) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `上游返回 HTTP ${response.status} ${redactKeys(raw, keys).slice(0, 200)}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '上游模型清单不是合法 JSON',
      );
    }
    const models = extractModelIds(parsed);
    if (models.length === 0) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `上游没有返回可识别的模型清单（${path}）`,
      );
    }
    // modelsPath 回给界面：管理员能一眼确认「前缀」这一项是否真的按模板生效了
    return { models, modelsPath: path };
  }

  async managedAipddChannel() {
    return this.prisma.channel.findFirst({
      where: { type: CHANNEL_TYPE_AIPDD },
      orderBy: { id: 'asc' },
    });
  }

  /**
   * 类型编号决定转发报文与前缀模板，未知编号会静默按 OpenAI 兼容发出去并在上游失败，
   * 所以只认模板表里的编号；没传则按 new-api 的 1（OpenAI）处理。
   */
  private assertChannelType(value: unknown): number {
    const type = Number.isInteger(value) ? Number(value) : CHANNEL_TYPE_OPENAI;
    if (!isKnownChannelType(type)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `未知的渠道类型 ${type}，请从上游模板中选择`,
      );
    }
    return type;
  }

  private normalizeInput(input: Record<string, unknown>) {
    return {
      type: input.type === undefined ? undefined : Number(input.type),
      name: input.name === undefined ? undefined : text(input.name).trim(),
      key: input.key === undefined ? undefined : text(input.key).trim(),
      baseUrl:
        input.baseUrl === undefined ? undefined : text(input.baseUrl).trim(),
      apiPrefix:
        input.apiPrefix === undefined
          ? undefined
          : normalizeApiPrefix(input.apiPrefix),
      models:
        input.models === undefined ? undefined : text(input.models).trim(),
      group:
        input.group === undefined
          ? undefined
          : text(input.group).trim() || 'default',
      priority:
        input.priority === undefined ? undefined : Number(input.priority),
      weight: input.weight === undefined ? undefined : Number(input.weight),
      status: input.status === undefined ? undefined : Number(input.status),
      autoBan: input.autoBan === undefined ? undefined : Number(input.autoBan),
      modelMapping:
        input.modelMapping === undefined
          ? undefined
          : normalizeJsonField(input.modelMapping, '模型重定向', true),
      headerOverride:
        input.headerOverride === undefined
          ? undefined
          : normalizeJsonField(input.headerOverride, '请求头覆盖', true),
      paramOverride:
        input.paramOverride === undefined
          ? undefined
          : normalizeJsonField(input.paramOverride, '参数覆盖'),
      testModel:
        input.testModel === undefined
          ? undefined
          : text(input.testModel).trim(),
      tag: input.tag === undefined ? undefined : text(input.tag).trim(),
      remark: input.remark === undefined ? undefined : text(input.remark),
    };
  }
}

/**
 * 三个覆盖字段会原样参与选路与上游请求，缓存层对坏 JSON 只能兜成 `{}`（静默失效），
 * 所以入库前就校验：必须是 JSON 对象，`stringValuesOnly` 的字段值还必须都是字符串。
 */
function normalizeJsonField(
  value: unknown,
  label: string,
  stringValuesOnly = false,
): string {
  if (value === null) return '';
  let parsed: unknown = value;
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return '';
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        `${label} 不是合法的 JSON`,
      );
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new BusinessException(
      ErrorCode.VALIDATION_ERROR,
      `${label} 必须是 JSON 对象，例如 {"a":"b"}`,
    );
  }
  const record = parsed as Record<string, unknown>;
  if (stringValuesOnly) {
    for (const [key, item] of Object.entries(record)) {
      if (typeof item !== 'string') {
        throw new BusinessException(
          ErrorCode.VALIDATION_ERROR,
          `${label} 的 "${key}" 值必须是字符串`,
        );
      }
    }
  }
  return JSON.stringify(record);
}

/**
 * 建渠道时的上游模板：`preset` 传模板 key（见 channel-presets）。
 * 只在建渠道生效——编辑已有渠道时地址与前缀已落库，不该被模板悄悄覆盖回去。
 */
function resolvePreset(input: Record<string, unknown>): ChannelPreset | null {
  const raw = text(input.preset).trim();
  if (!raw) return null;
  const preset = findPresetByKey(raw);
  if (!preset || !preset.creatable) {
    throw new BusinessException(
      ErrorCode.VALIDATION_ERROR,
      `未知的上游模板 ${raw}，可选值：${creatablePresets()
        .map((item) => item.key)
        .join('/')}`,
    );
  }
  return preset;
}

/**
 * 模型清单的三种上游形状：OpenAI `{data:[{id}]}`、火山方舟 `{result:[{id}]}`、
 * Gemini `{models:[{name:"models/gemini-x"}]}`；统一取 id/name，去掉 `models/` 前缀后去重排序。
 */
function extractModelIds(payload: unknown): string[] {
  const record = (payload || {}) as Record<string, unknown>;
  const list = [record.data, record.result, record.models].find((item) =>
    Array.isArray(item),
  ) as unknown[] | undefined;
  if (!list) return [];
  const out = new Set<string>();
  for (const item of list) {
    const entry = (item || {}) as Record<string, unknown>;
    const model = text(
      typeof item === 'string' ? item : (entry.id ?? entry.name),
    )
      .replace(/^models\//, '')
      .trim();
    if (model) out.add(model);
  }
  return [...out].sort();
}
