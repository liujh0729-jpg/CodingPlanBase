import { randomBytes } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma';
import { ROLE_ROOT } from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  envFileExists,
  envFilePath,
  hasEnvValue,
  readEnvValue,
  writeEnvKeys,
} from './env-store';

type Dialect = 'sqlite' | 'mysql' | 'postgresql';

/** db_unreachable：连不上库；schema_missing：连上了但没有表；admin_missing：有表没超管；ready：已安装 */
type Stage = 'db_unreachable' | 'schema_missing' | 'admin_missing' | 'ready';

const DIALECTS: Dialect[] = ['sqlite', 'mysql', 'postgresql'];
const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const DDL_FILES: Record<Dialect, string> = {
  sqlite: path.join('prisma', 'sql', 'sqlite', 'schema.sql'),
  mysql: path.join('prisma', 'sql', 'mysql', 'schema.sql'),
  postgresql: path.join('prisma', 'sql', 'postgresql', 'schema.sql'),
};

/**
 * 安装向导：把「配数据库 → 建表 → 建超级管理员」这条首次部署链路做成可视步骤。
 *
 * 安全边界（三条，缺一不可）：
 * 1. 一旦存在超级管理员（`stage === 'ready'`），所有写接口一律拒绝——向导只对未安装的系统开放；
 * 2. 连接串、口令只写进被 Git 忽略的 `backend/.env`，接口只回键名与布尔量，绝不回显值；
 * 3. 改了 `.env` 就必须重启后端才会生效，所以建超管前强制校验运行时与 `.env` 一致，
 *    否则会出现「往旧库建号、新库仍然空」的假成功。
 */
@Injectable()
export class InstallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  async status() {
    const envUrl = readEnvValue('DATABASE_URL');
    const runtimeUrl = String(process.env.DATABASE_URL || '');
    const stage = await this.probeStage();
    return {
      installed: stage === 'ready',
      stage,
      checks: {
        envFile: envFileExists(),
        envPath: envFilePath(),
        envWritable: isWritable(envFilePath()),
        databaseUrlInEnv: hasEnvValue('DATABASE_URL'),
        jwtSecretInEnv: hasEnvValue('JWT_SECRET'),
        jwtSecretInRuntime: Boolean(String(process.env.JWT_SECRET || '').trim()),
        runtimeDialect: dialectOf(runtimeUrl),
        envDialect: envUrl ? dialectOf(envUrl) : '',
        // SQLite 的库文件路径回给向导做预填：沿用原路径就不必重启，改路径才要重启。
        // 装好之后向导已关闭，没必要再对外暴露库文件位置。
        sqlitePath:
          envUrl.startsWith('file:') && stage !== 'ready'
            ? resolvedSqliteFile(envUrl)
            : '',
        // .env 已改写但进程还连着旧库：建表会打到新库、建号会打到旧库，必须先重启
        envMatchesRuntime: sameDatabase(envUrl, runtimeUrl),
      },
      ddlFiles: {
        sqlite: DDL_FILES.sqlite,
        mysql: DDL_FILES.mysql,
        postgresql: DDL_FILES.postgresql,
      },
    };
  }

  /** 第一步：把目标库连接配置写进 `.env`。只回键名，不回连接串。 */
  async saveDatabase(input: {
    dialect?: string;
    sqlitePath?: string;
    host?: string;
    port?: string | number;
    username?: string;
    password?: string;
    database?: string;
    schema?: string;
  }) {
    await this.assertNotInstalled();
    const dialect = String(input?.dialect || '') as Dialect;
    if (!DIALECTS.includes(dialect)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '数据库类型只支持 sqlite / mysql / postgresql',
      );
    }
    const url =
      dialect === 'sqlite'
        ? buildSqliteUrl(input.sqlitePath)
        : buildServerUrl(dialect, input);
    // SQLite 当场连一次：写坏连接串会让后端重启即崩（PrismaService 连不上就拒绝启动），
    // 那时连 `/install` 都打不开，只能手工改 `.env`。非 SQLite 的方言客户端没编译，交给 CLI。
    if (dialect === 'sqlite') {
      try {
        ensureSqliteDir(url);
      } catch {
        throw new BusinessException(
          ErrorCode.VALIDATION_ERROR,
          '这个库文件路径不可用：所在目录不存在且无法创建，请换一个可写的位置',
        );
      }
      await this.assertConnectable(url);
    }
    const appliedKeys = writeEnvKeys({ DATABASE_URL: url });
    return {
      dialect,
      appliedKeys,
      restartRequired: !sameDatabase(
        url,
        String(process.env.DATABASE_URL || ''),
      ),
      // 方言客户端只为一种 provider 编译：非 SQLite 换库后要重新 generate 才能连上
      regenerateClient: dialect !== 'sqlite',
    };
  }

  /** JWT_SECRET 缺失时生成一枚强随机值；已有则原样保留，不覆盖、不回显。 */
  async ensureJwtSecret() {
    await this.assertNotInstalled();
    if (hasEnvValue('JWT_SECRET')) {
      return {
        generated: false,
        restartRequired: !String(process.env.JWT_SECRET || '').trim(),
      };
    }
    const appliedKeys = writeEnvKeys({
      JWT_SECRET: randomBytes(32).toString('hex'),
    });
    return {
      generated: true,
      appliedKeys,
      restartRequired: !String(process.env.JWT_SECRET || '').trim(),
    };
  }

  /**
   * 第二步：建表。SQLite 直接执行随仓的 DDL；MySQL / PostgreSQL 交给 CLI
   * （`prisma db execute` 不依赖运行时客户端的方言，而本进程的 PrismaClient 只为一种 provider 编译）。
   */
  async applySchema() {
    await this.assertNotInstalled();
    const envUrl = readEnvValue('DATABASE_URL');
    const runtimeUrl = String(process.env.DATABASE_URL || '');
    const target = envUrl || runtimeUrl;
    const dialect = dialectOf(target);
    if (dialect !== 'sqlite') {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        dialect === 'unknown'
          ? '还没有配置数据库连接串，请先完成第一步'
          : 'MySQL / PostgreSQL 请在 backend/ 下用 CLI 建表，再回到向导第 3 步',
        {
          commands:
            dialect === 'unknown'
              ? []
              : [
                  `pnpm db:apply:${dialect === 'mysql' ? 'mysql' : 'postgres'}`,
                  `pnpm prisma:generate:${dialect === 'mysql' ? 'mysql' : 'postgres'}`,
                  '重启后端服务',
                ],
          ddlFile: DDL_FILES[dialect === 'unknown' ? 'sqlite' : dialect],
        },
      );
    }
    const ddlPath = path.resolve(BACKEND_ROOT, DDL_FILES.sqlite);
    if (!existsSync(ddlPath)) {
      throw new BusinessException(
        ErrorCode.INTERNAL_ERROR,
        `找不到建表脚本 ${DDL_FILES.sqlite}，请确认仓库完整`,
      );
    }
    const statements = splitSqlStatements(readFileSync(ddlPath, 'utf8'));
    // 库可能被移走 / 目录被删：先探一次，给出 503 而不是裸抛 500
    await this.assertConnectable(target);
    const client = new PrismaClient({
      datasources: { db: { url: target } },
    });
    let applied = 0;
    try {
      await client.$connect();
      const existing = (await client.$queryRawUnsafe(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )) as { name: string }[];
      if (existing.some((row) => row.name === 'users')) {
        throw new BusinessException(
          ErrorCode.CONFLICT,
          '目标库里已经有表结构：要么已经建过，要么选错了库文件。请换一个空库',
        );
      }
      for (const statement of statements) {
        await client.$executeRawUnsafe(statement);
        applied += 1;
      }
    } finally {
      await client.$disconnect().catch(() => undefined);
    }
    return {
      dialect: 'sqlite',
      appliedStatements: applied,
      restartRequired: !sameDatabase(target, runtimeUrl),
    };
  }

  /** 第三步：建第一个超级管理员。运行时必须已连着 `.env` 里那个库，否则会把号建到旧库里。 */
  async finalize(input: {
    username?: string;
    password?: string;
    displayName?: string;
  }) {
    await this.assertNotInstalled();
    if (
      !sameDatabase(
        readEnvValue('DATABASE_URL'),
        String(process.env.DATABASE_URL || ''),
      )
    ) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '数据库配置已变更但服务还在连旧库：请先重启后端服务，再回来建超级管理员',
      );
    }
    const stage = await this.probeStage();
    if (stage === 'db_unreachable') {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '数据库连不上：请检查第一步填的连接配置，改完后重启后端再回来',
      );
    }
    if (stage === 'schema_missing') {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '库里还没有表结构，请先执行第 2 步建表',
      );
    }
    const user = await this.users.createRootAccount({
      username: String(input?.username || ''),
      password: String(input?.password || ''),
      displayName: String(input?.displayName || ''),
    });
    return { user };
  }

  /** 用一次性客户端探一次目标库；失败信息只带引擎首行，不带连接串。 */
  private async assertConnectable(url: string): Promise<void> {
    const client = new PrismaClient({ datasources: { db: { url } } });
    try {
      await client.$connect();
      await client.$queryRawUnsafe('SELECT 1');
    } catch (error) {
      const reason = String(
        (error as { message?: string })?.message || error,
      )
        .split('\n')
        .map((line) => line.trim())
        .find((line) => /Unable to open|does not exist|no such|permission|ERROR/i.test(line))
        ?.slice(0, 160);
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        `连不上这个数据库${reason ? `：${reason}` : ''}。请检查路径或权限后重试`,
      );
    } finally {
      await client.$disconnect().catch(() => undefined);
    }
  }

  private async probeStage(): Promise<Stage> {    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
    } catch {
      return 'db_unreachable';
    }
    try {
      await this.prisma.$queryRawUnsafe('SELECT COUNT(*) AS n FROM users');
    } catch {
      return 'schema_missing';
    }
    const roots = await this.prisma.user.count({ where: { role: ROLE_ROOT } });
    return roots > 0 ? 'ready' : 'admin_missing';
  }

  private async assertNotInstalled() {
    if ((await this.probeStage()) === 'ready') {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '系统已安装（超级管理员已存在），安装向导已关闭',
      );
    }
  }
}

function dialectOf(url: string): Dialect | 'unknown' {
  if (url.startsWith('file:')) return 'sqlite';
  if (url.startsWith('mysql:')) return 'mysql';
  if (url.startsWith('postgresql:') || url.startsWith('postgres:'))
    return 'postgresql';
  return 'unknown';
}

/** SQLite 用绝对路径，避免「相对 schema 目录还是相对 cwd」这类歧义。 */
function buildSqliteUrl(rawPath?: string): string {
  const value = String(rawPath || '').trim();
  if (!value) {
    throw new BusinessException(
      ErrorCode.VALIDATION_ERROR,
      '请填写 SQLite 库文件路径',
    );
  }
  const absolute = path.isAbsolute(value)
    ? value
    : path.resolve(BACKEND_ROOT, value);
  // Prisma 的 SQLite 只认 `file:<盘符>/...`；`file:/C:/...` 会当成相对路径打不开
  return `file:${absolute.replace(/\\/g, '/')}`;
}

/** 库文件的父目录不存在时 SQLite 只会报「打不开」，这里先建好目录。 */
function ensureSqliteDir(url: string): void {
  mkdirSync(path.dirname(resolvedSqliteFile(url)), { recursive: true });
}

/**
 * SQLite 的相对路径由 Prisma 按 schema 目录（`backend/prisma`）解析，不是按 cwd。
 * 归一化成绝对路径后才能判断「是不是同一个库」。
 */
function resolvedSqliteFile(url: string): string {
  const bare = String(url || '')
    .slice('file:'.length)
    .split('?')[0]
    .replace(/\\/g, '/');
  const absolute = path.isAbsolute(bare)
    ? bare
    : path.join(BACKEND_ROOT, 'prisma', bare);
  const normalized = path.normalize(absolute).replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** 比较两个连接串是否指向同一个库；SQLite 按归一化后的文件路径比。 */
function sameDatabase(a: string, b: string): boolean {
  const trimA = String(a || '').trim();
  const trimB = String(b || '').trim();
  if (trimA.startsWith('file:') && trimB.startsWith('file:')) {
    return resolvedSqliteFile(trimA) === resolvedSqliteFile(trimB);
  }
  return trimA === trimB;
}

function buildServerUrl(
  dialect: Dialect,
  input: {
    host?: string;
    port?: string | number;
    username?: string;
    password?: string;
    database?: string;
    schema?: string;
  },
): string {
  const host = String(input.host || '').trim();
  const database = String(input.database || '').trim();
  const username = String(input.username || '').trim();
  if (!host || !database || !username) {
    throw new BusinessException(
      ErrorCode.VALIDATION_ERROR,
      '主机、数据库名与账号都不能为空',
    );
  }
  const port = Number(input.port || (dialect === 'mysql' ? 3306 : 5432));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new BusinessException(ErrorCode.VALIDATION_ERROR, '端口不合法');
  }
  const password = String(input.password || '');
  const search = new URLSearchParams();
  if (dialect === 'postgresql' && String(input.schema || '').trim()) {
    search.set('schema', String(input.schema).trim());
  }
  const query = search.toString();
  return [
    `${dialect}://`,
    `${encodeURIComponent(username)}:${encodeURIComponent(password)}`,
    `@${host}:${port}/${encodeURIComponent(database)}`,
    query ? `?${query}` : '',
  ].join('');
}

/** 去掉 `--` 注释行后按分号切句；DDL 里没有嵌分号的字符串，够用且不引入 SQL 解析器。 */
function splitSqlStatements(sql: string): string[] {
  return sql
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function isWritable(file: string): boolean {
  try {
    accessSync(path.dirname(file), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
