import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import {
  AIPDD_CATALOG_PATH,
  CHANNEL_STATUS,
  CHANNEL_TYPE_AIPDD,
} from './gateway.constants';
import { ChannelsService } from './channels.service';

/** 目录条目的宽松解析结构（兼容 camelCase / snake_case 上游报文）。 */
interface CatalogModel {
  name: string;
  vendor?: string;
  description?: string;
  pricingModel?: string; // per_token | per_call
  currency?: string; // awcoin | usd | cny
  promptPerMillion?: number;
  completionPerMillion?: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
  pricePerCall?: number;
  endpoints?: string[];
}

interface CatalogPayload {
  schemaVersion: string;
  revision: string;
  rmbPerUnit?: number; // 批发币种 → 人民币
  models: CatalogModel[];
  raw: unknown;
}

@Injectable()
export class CatalogService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CatalogService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastSyncAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly channels: ChannelsService,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.channels.refreshCache();
    } catch (error) {
      // P2021 = 表不存在：全新库首启动时这是「还没安装」，不是故障。
      // 进程必须活着，`/install` 向导才有地方建表；其他错误照旧抛出。
      if ((error as { code?: string })?.code !== 'P2021') throw error;
      this.logger.warn(
        '数据库里还没有表结构，已跳过渠道缓存预热：请用浏览器打开 /install 完成安装',
      );
    }
    this.startScheduler();
  }

  /** key 优先级镜像 newapi：托管渠道 DB > 首次设置向导 > 环境变量兜底。 */
  async resolveAipddKey(): Promise<string> {
    const managed = await this.channels.managedAipddChannel();
    const fromChannel = managed?.key
      .split('\n')
      .map((item) => item.trim())
      .find(Boolean);
    if (fromChannel) return fromChannel;
    const fromWizard = await this.settings.get('aipdd_api_key');
    if (fromWizard) return fromWizard;
    return String(process.env.AIPDD_API_KEY || '').trim();
  }

  /**
   * 首次接入只收密钥：目录来源是 AIPDD 平台的固定地址（`aipdd_base_url` 默认值，
   * 可被 `AIPDD_BASE_URL` 环境变量覆盖），界面不提供输入，避免把平台地址写成半成品。
   */
  async setup(input: { key?: string }) {
    const key = String(input.key || '').trim();
    if (!key)
      throw new BusinessException(ErrorCode.VALIDATION_ERROR, '缺少 API Key');
    await this.settings.set('aipdd_api_key', key);
    return this.sync(true);
  }

  async status() {
    const [snapshot, modelCount, aipddKey] = await Promise.all([
      this.prisma.catalogSnapshot.findUnique({ where: { id: 1 } }),
      this.prisma.gatewayModel.count(),
      this.resolveAipddKey(),
    ]);
    return {
      hasKey: Boolean(aipddKey),
      modelCount,
      revision: snapshot?.revision || '',
      syncedAt: snapshot?.syncedAt || null,
      sourceBaseUrl: snapshot?.sourceBaseUrl || '',
    };
  }

  /**
   * 拉取 {base}/v1/new-api/catalog 并落库：
   * 批发价（目录币种）→ 零售人民币：× 目录给出的「每单位人民币」汇率 × markup。
   */
  async sync(force = false) {
    const key = await this.resolveAipddKey();
    if (!key) {
      if (force) {
        throw new BusinessException(
          ErrorCode.BAD_REQUEST,
          '尚未配置 AIPDD API Key',
        );
      }
      return null;
    }
    const baseUrl = (await this.settings.get('aipdd_base_url')).replace(
      /\/$/,
      '',
    );
    let catalog: CatalogPayload;
    try {
      const response = await fetch(`${baseUrl}${AIPDD_CATALOG_PATH}`, {
        headers: { Authorization: `Bearer ${key}`, 'x-api-key': key },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      catalog = parseCatalog(await response.json());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!force) {
        this.logger.warn(`目录同步失败，沿用上次快照: ${message}`);
        return null;
      }
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `目录同步失败: ${message}`,
      );
    }

    await this.prisma.catalogSnapshot.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        schemaVersion: catalog.schemaVersion,
        revision: catalog.revision,
        sourceBaseUrl: baseUrl,
        payload: JSON.stringify(catalog.raw),
        syncedAt: new Date(),
      },
      update: {
        schemaVersion: catalog.schemaVersion,
        revision: catalog.revision,
        sourceBaseUrl: baseUrl,
        payload: JSON.stringify(catalog.raw),
        syncedAt: new Date(),
      },
    });

    const markup = await this.settings.getNumber('pricing_markup');
    const rateToCny = (catalog.rmbPerUnit || 0) * (markup || 1);

    const syncedNames: string[] = [];
    for (const model of catalog.models) {
      if (!model.name) continue;
      syncedNames.push(model.name);
      const existing = await this.prisma.gatewayModel.findUnique({
        where: { modelName: model.name },
      });
      // 管理员钉过价（manual/pinned）的模型跳过同步覆盖；auto（首次调用自动生成）与 catalog 均由同步接管
      if (
        existing &&
        existing.priceSource !== 'catalog' &&
        existing.priceSource !== 'auto'
      ) {
        continue;
      }
      const data = this.catalogPriceData(model, rateToCny);
      if (existing) {
        await this.prisma.gatewayModel.update({
          where: { modelName: model.name },
          data,
        });
      } else {
        await this.prisma.gatewayModel.create({
          data: { modelName: model.name, ...data },
        });
      }
    }

    // 托管渠道同步：模型全集 + 名称兜底；密钥以渠道自身为准（运行期改渠道 key 即刻生效）
    const managed = await this.channels.managedAipddChannel();
    if (syncedNames.length > 0) {
      const models = syncedNames.join(',');
      if (managed) {
        await this.prisma.channel.update({
          where: { id: managed.id },
          data: { models, baseUrl, group: managed.group || 'default' },
        });
      } else {
        await this.prisma.channel.create({
          data: {
            type: CHANNEL_TYPE_AIPDD,
            name: 'AIPDD',
            key,
            baseUrl,
            models,
            group: 'default',
            status: CHANNEL_STATUS.ENABLED,
            isManaged: 1,
            priority: 10,
            weight: 100,
            remark: '目录同步托管渠道',
          },
        });
      }
      await this.channels.refreshCache();
    }
    return { revision: catalog.revision, models: syncedNames.length };
  }

  /**
   * 目录条目 → `gateway_model` 的价格字段（批发价 × 汇率 × markup → 零售人民币）。
   * 同步与「恢复目录价」共用这一处，避免同一套折算写两遍算出两种结果。
   */
  private catalogPriceData(model: CatalogModel, rateToCny: number) {
    const perMillionToCny = (value?: number) =>
      Math.max(0, Number(value || 0) * rateToCny);
    const promptCny =
      model.pricingModel === 'per_call'
        ? 0
        : perMillionToCny(model.promptPerMillion);
    const completionCny = perMillionToCny(model.completionPerMillion);
    return {
      description: model.description || '',
      vendorName: model.vendor || '',
      quotaType: model.pricingModel === 'per_call' ? 1 : 0,
      modelRatio: Number(promptCny.toFixed(6)),
      completionRatio:
        promptCny > 0 ? Number((completionCny / promptCny).toFixed(4)) : 1,
      cacheReadRatio:
        promptCny > 0
          ? Number(
              (perMillionToCny(model.cacheReadPerMillion) / promptCny).toFixed(
                4,
              ),
            )
          : 0,
      cacheWriteRatio:
        promptCny > 0
          ? Number(
              (perMillionToCny(model.cacheWritePerMillion) / promptCny).toFixed(
                4,
              ),
            )
          : 0,
      callCnyPrice: Number(perMillionToCny(model.pricePerCall).toFixed(6)),
      endpoints: (model.endpoints || ['chat']).join(','),
      priceSource: 'catalog',
    };
  }

  /**
   * 取消钉价并把这一行立刻恢复成目录价：读当前目录快照按同一条折算重算，
   * 点下按钮就是目录口径，不需要等下一次同步跑完才生效。
   */
  async resetToCatalogPrice(id: number) {
    const row = await this.prisma.gatewayModel.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '模型不存在');
    }
    if (row.priceSource !== 'manual') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '这个模型当前就是目录价，没有被钉住',
      );
    }
    const snapshot = await this.prisma.catalogSnapshot.findUnique({
      where: { id: 1 },
    });
    const parsed = snapshot
      ? parseCatalog(JSON.parse(snapshot.payload || '{}'))
      : null;
    const catalogModel = parsed?.models.find(
      (model) => model.name === row.modelName,
    );
    if (!parsed || !catalogModel) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `目录快照里没有 ${row.modelName}：它的价格不是同步来的，只能保持钉价或删掉这一行`,
      );
    }
    const markup = await this.settings.getNumber('pricing_markup');
    return this.prisma.gatewayModel.update({
      where: { id },
      data: this.catalogPriceData(
        catalogModel,
        (parsed.rmbPerUnit || 0) * (markup || 1),
      ),
    });
  }

  /**
   * 当前目录快照托管的模型名集合：价目表用它区分「同步托管的行」与
   * 「手工新增 / 首次调用自动补的行」，后者才可以删、前者删了会原样回来。
   */
  async managedNames(): Promise<Set<string>> {
    const snapshot = await this.prisma.catalogSnapshot.findUnique({
      where: { id: 1 },
    });
    if (!snapshot) return new Set();
    const parsed = parseCatalog(JSON.parse(snapshot.payload || '{}'));
    return new Set(parsed.models.map((model) => model.name).filter(Boolean));
  }

  /**
   * 删除价目表行：只放行走进快照之外的（手工新增、上游清单入库、首次调用自动补）。
   * 目录托管的行留在这里删不掉不是偷懒——下一次同步会按快照把它原样建回来，
   * 「删除」对它没有可观察效果，那一头该做的动作是钉价。
   */
  async remove(id: number) {
    const row = await this.prisma.gatewayModel.findUnique({ where: { id } });
    if (!row) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '模型不存在');
    }
    if ((await this.managedNames()).has(row.modelName)) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `${row.modelName} 由模型目录托管：删掉下一次同步就会建回来。要脱离目录价请在定价里钉住它`,
      );
    }
    // 历史调用日志按 modelName 留快照，不依赖这一行存在
    await this.prisma.gatewayModel.delete({ where: { id } });
    return null;
  }

  /**
   * 定时同步：每 60 秒醒一次，现场读「目录同步间隔」（超级管理员在模型设置里改），
   * 到点才真同步。这样改完间隔不必重启进程就能生效；0 表示关闭。
   */
  startScheduler() {
    this.stopScheduler();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
    void this.tick();
  }

  stopScheduler() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.running) return;
    const minutes = await this.intervalMinutes();
    if (minutes <= 0) return;
    if (Date.now() - this.lastSyncAt < minutes * 60_000) return;
    this.running = true;
    this.lastSyncAt = Date.now();
    try {
      await this.sync();
    } catch {
      // 上游不可达 / 目录未接入：定时任务不能因一次失败停摆，等下个间隔再试。
    } finally {
      this.running = false;
    }
  }

  /** 环境变量优先（部署期锁死用），否则取模型设置；夹到 0..1440，0 = 关闭。 */
  private async intervalMinutes(): Promise<number> {
    const fromEnv = Number(process.env.AIPDD_CATALOG_SYNC_INTERVAL_MINUTES);
    const value = Number.isFinite(fromEnv)
      ? fromEnv
      : Number(await this.settings.get('catalog_sync_interval_minutes'));
    return Math.min(1440, Math.max(0, Math.trunc(Number(value) || 0)));
  }
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function num(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function parseCatalog(raw: unknown): CatalogPayload {
  const root = (raw || {}) as Record<string, unknown>;
  const modelsRaw = Array.isArray(root.models) ? root.models : [];
  const awc = (root.awcoin_rate ||
    root.awcRate ||
    root.AWCoinRate ||
    {}) as Record<string, unknown>;
  const rmbPerUnit = num(
    pick(awc, ['RMBPerAWCoin', 'rmbPerAwcoin', 'rmb_per_awcoin']) ??
      pick(root, ['rmb_per_unit', 'rmbPerUnit']),
  );
  const models: CatalogModel[] = modelsRaw
    .map((item) => {
      const m = (item || {}) as Record<string, unknown>;
      const pricing = (m.pricing || m) as Record<string, unknown>;
      return {
        name: str(pick(m, ['name', 'model', 'modelName', 'model_name'])) || '',
        vendor: str(pick(m, ['vendor', 'vendorName', 'vendor_name'])),
        description: str(pick(m, ['description', 'desc'])),
        pricingModel:
          str(pick(pricing, ['pricingModel', 'pricing_model'])) || 'per_token',
        currency: str(pick(pricing, ['currency'])),
        promptPerMillion: num(
          pick(pricing, ['promptPerMillion', 'prompt_per_million']),
        ),
        completionPerMillion: num(
          pick(pricing, ['completionPerMillion', 'completion_per_million']),
        ),
        cacheReadPerMillion: num(
          pick(pricing, ['cacheReadPerMillion', 'cache_read_per_million']),
        ),
        cacheWritePerMillion: num(
          pick(pricing, ['cacheWritePerMillion', 'cache_write_per_million']),
        ),
        pricePerCall: num(
          pick(pricing, ['pricePerCall', 'price_per_call', 'price']),
        ),
        endpoints: Array.isArray(m.endpoints)
          ? (m.endpoints as unknown[]).map((e) => String(e))
          : Array.isArray(m.capabilities)
            ? (m.capabilities as unknown[]).map((e) => String(e))
            : undefined,
      };
    })
    .filter((model) => model.name);
  return {
    schemaVersion: str(pick(root, ['schema_version', 'schemaVersion'])) || '',
    revision:
      str(pick(root, ['revision', 'generated_at', 'generatedAt'])) || '',
    rmbPerUnit,
    models,
    raw,
  };
}
