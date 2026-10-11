import { Body, Controller, Get, Post } from '@nestjs/common';
import { ok, text } from '../common/api';
import { InstallService } from './install.service';

/**
 * 安装向导接口（`/install/*`）。全部免登录，但 `InstallService.assertNotInstalled()`
 * 保证只要超级管理员存在就一律 403——安装完成的系统不再暴露这些写入口。
 */
@Controller('install')
export class InstallController {
  constructor(private readonly install: InstallService) {}

  @Get('status')
  async status() {
    return ok(await this.install.status());
  }

  @Post('database')
  async database(
    @Body()
    body: {
      dialect?: string;
      sqlitePath?: string;
      host?: string;
      port?: string | number;
      username?: string;
      password?: string;
      database?: string;
      schema?: string;
    },
  ) {
    return ok(
      await this.install.saveDatabase({
        dialect: text(body?.dialect),
        sqlitePath: text(body?.sqlitePath),
        host: text(body?.host),
        port: body?.port,
        username: text(body?.username),
        password: text(body?.password),
        database: text(body?.database),
        schema: text(body?.schema),
      }),
    );
  }

  @Post('secret')
  async secret() {
    return ok(await this.install.ensureJwtSecret());
  }

  @Post('schema')
  async schema() {
    return ok(await this.install.applySchema());
  }

  @Post('admin')
  async admin(
    @Body()
    body: { username?: string; password?: string; displayName?: string },
  ) {
    return ok(
      await this.install.finalize({
        username: text(body?.username),
        password: text(body?.password),
        displayName: text(body?.displayName),
      }),
    );
  }
}
