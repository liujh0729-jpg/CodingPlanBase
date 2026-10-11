import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ok } from './common/api';
import { PrismaService } from './prisma/prisma.service';

const HEALTH_CHECK_TIMEOUT_MS = 2_000;

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  health() {
    return ok({ status: 'up', service: 'codingplan-base' });
  }

  @Get('health/version')
  version() {
    return ok({
      service: 'codingplan-base',
      commit: process.env.APP_RELEASE_COMMIT || 'unknown',
    });
  }

  @Get('health/ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    const database = await dependencyStatus(() =>
      this.prisma.$queryRawUnsafe('SELECT 1'),
    );
    const ready = database === 'up';
    if (!ready) response.status(503);
    return ok({
      status: ready ? 'ready' : 'not_ready',
      checks: { database },
    });
  }
}

async function dependencyStatus(
  probe: () => Promise<unknown>,
): Promise<'up' | 'down' | 'timeout'> {
  const timeout = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), HEALTH_CHECK_TIMEOUT_MS),
  );
  try {
    const winner = await Promise.race([
      probe().then(() => 'up' as const),
      timeout,
    ]);
    return winner;
  } catch {
    return 'down';
  }
}
