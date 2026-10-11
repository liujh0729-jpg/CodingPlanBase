import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      datasources: {
        db: { url: process.env.DATABASE_URL },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
    // PRAGMA 带赋值会返回结果行，SQLite 下 $executeRaw 拒绝有返回的语句，只能用 queryRaw
    if ((process.env.DATABASE_URL || '').startsWith('file:')) {
      await this.$queryRawUnsafe('PRAGMA journal_mode=WAL;');
      await this.$queryRawUnsafe('PRAGMA busy_timeout=5000;');
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
