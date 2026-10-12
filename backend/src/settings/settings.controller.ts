import { Body, Controller, Get, Put } from '@nestjs/common';
import { Current } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user';
import { ok, text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { maskKey } from '../gateway/gateway.constants';
import { DEFAULTS, SettingsService } from './settings.service';

const EDITABLE = new Set(Object.keys(DEFAULTS));

/**
 * 写入权限按「哪个板块在写」收口：模型设置是超级管理员的板块，
 * 其中的额度换算、零售倍率、目录来源密钥一旦改错会影响全平台计费；
 * 只有支付相关键跟着「支付管理」板块（平台管理员可见）开放。
 */
const ADMIN_WRITABLE = new Set([
  'chandler_enabled',
  'chandler_base_url',
  'chandler_products',
]);

/** 布尔键只认 'true' / 'false' 字面量——getBool 按字面比较，写 '1' 会静默变成「关闭」。 */
const BOOL_KEYS = new Set(['allow_registration', 'chandler_enabled']);

/**
 * 数值键边界：quota_per_unit 为 0 会让「额度 → 元」除零，pricing_markup 为 0
 * 会把整张价目表的零售价算成 0 元，同步间隔为负会让定时器立刻触发。
 */
const NUMBER_BOUNDS: Record<
  string,
  { min: number; max: number; integer: boolean }
> = {
  quota_per_unit: { min: 1, max: 1_000_000_000, integer: true },
  pricing_markup: { min: 0.01, max: 100, integer: false },
  new_user_quota: { min: 0, max: 1_000_000_000, integer: true },
  catalog_sync_interval_minutes: { min: 0, max: 1440, integer: true },
};

/** 密钥类配置：读取时掩码，提交掩码值或空值视为「不修改」。 */
const SECRET_KEYS = new Set(['aipdd_api_key']);

function isMaskedOrEmpty(value: string) {
  return !value.trim() || value.includes('**********');
}

function validate(key: string, raw: string): void {
  if (BOOL_KEYS.has(key) && raw !== 'true' && raw !== 'false') {
    throw new BusinessException(
      ErrorCode.VALIDATION_ERROR,
      `「${key}」只能保存 true 或 false`,
    );
  }
  const bounds = NUMBER_BOUNDS[key];
  if (!bounds) return;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new BusinessException(
      ErrorCode.VALIDATION_ERROR,
      `「${key}」必须是数字`,
    );
  }
  if (
    value < bounds.min ||
    value > bounds.max ||
    (bounds.integer && !Number.isInteger(value))
  ) {
    throw new BusinessException(
      ErrorCode.VALIDATION_ERROR,
      `「${key}」需在 ${bounds.min} ~ ${bounds.max} 之间${bounds.integer ? '且为整数' : ''}`,
    );
  }
}

@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('settings/public')
  async publicSettings() {
    return ok({
      allow_registration: await this.settings.getBool('allow_registration'),
      chandler_enabled: await this.settings.getBool('chandler_enabled'),
    });
  }

  /** 读取不按键拆分：全平台日志、支付管理等板块（平台管理员）要取换算参数展示金额。 */
  @Get('settings')
  async list(@Current() user: CurrentUser) {
    if (!user.isAdmin()) {
      throw new BusinessException(ErrorCode.ROLE_MISMATCH, '需要管理员权限');
    }
    const entries: Record<string, string> = {};
    for (const key of Object.keys(DEFAULTS)) {
      const value = await this.settings.get(key);
      entries[key] = SECRET_KEYS.has(key) && value ? maskKey(value) : value;
    }
    return ok(entries);
  }

  @Put('settings')
  async update(
    @Current() user: CurrentUser,
    @Body() body: Record<string, unknown>,
  ) {
    if (!user.isAdmin()) {
      throw new BusinessException(ErrorCode.ROLE_MISMATCH, '需要管理员权限');
    }
    const entries = Object.entries(body || {}).filter(([key]) =>
      EDITABLE.has(key),
    );
    // 先整体校验再逐条写：一条被拒时不能出现「半套配置已生效」。
    for (const [key, value] of entries) {
      if (!ADMIN_WRITABLE.has(key) && !user.isRoot()) {
        throw new BusinessException(
          ErrorCode.ROLE_MISMATCH,
          `「${key}」只有超级管理员可以修改`,
        );
      }
      if (SECRET_KEYS.has(key) && isMaskedOrEmpty(text(value))) continue;
      validate(key, text(value));
    }
    const updated: Record<string, string> = {};
    for (const [key, value] of entries) {
      const raw = text(value);
      if (SECRET_KEYS.has(key) && isMaskedOrEmpty(raw)) continue;
      await this.settings.set(key, raw);
      updated[key] = raw;
    }
    return ok(updated);
  }
}
