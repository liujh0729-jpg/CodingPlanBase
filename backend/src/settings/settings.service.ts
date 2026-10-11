import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 与前端展示无关的纯后端换算常量，允许管理员在设置里覆盖。 */
export const DEFAULTS: Record<string, string> = {
  allow_registration: 'true',
  new_user_quota: '0',
  quota_per_unit: '500000', // 1 元 = 500000 额度（网关计费的换算基数）
  pricing_markup: '1.10', // 目录同步零售定价倍率：批发价 ×1.10
  catalog_sync_interval_minutes: '5',
  chandler_enabled: 'false',
  chandler_base_url: 'https://app.chandler.work',
  aipdd_base_url: 'https://api.aipdd.work',
  aipdd_api_key: '',
  chandler_products: '[]',
};

@Injectable()
export class SettingsService {
  private cache: Map<string, string> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async load(): Promise<Map<string, string>> {
    if (!this.cache) {
      const rows = await this.prisma.setting.findMany();
      this.cache = new Map(rows.map((row) => [row.key, row.value]));
    }
    return this.cache;
  }

  async get(key: string): Promise<string> {
    const map = await this.load();
    const value = map.get(key);
    if (value !== undefined && value !== '') return value;
    if (key === 'aipdd_base_url' && process.env.AIPDD_BASE_URL) {
      return process.env.AIPDD_BASE_URL;
    }
    return DEFAULTS[key] ?? '';
  }

  async getNumber(key: string): Promise<number> {
    return Number(await this.get(key)) || Number(DEFAULTS[key]) || 0;
  }

  async getBool(key: string): Promise<boolean> {
    return (await this.get(key)) === 'true';
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    this.cache?.set(key, value);
  }

  invalidate() {
    this.cache = null;
  }
}
