import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync } from 'node:fs';
import {
  envFileExists,
  envFilePath,
  hasEnvValue,
  readEnvValues,
  writeEnvKeys,
} from './env-store';

/**
 * 首次启动兜底：让 `git clone && pnpm dev`（以及生产直接 `node dist/main.js`）在不手搓
 * `.env` 的情况下也能起来，剩下的配置交给安装向导（`/install`）。`.env` 的位置与
 * ConfigModule 一致（相对进程 cwd），且不覆盖任何已有值。
 *
 * 1. 没有 `.env` 时按 `.env.example` 复制一份（示例文件不含任何密钥）；
 * 2. 把 `.env` 里进程环境还没有的键补进去——`node dist/main.js` 不会自动读 `.env`，
 *    不补的话 `main.ts` 的 JWT_SECRET 守卫会误判成未配置；
 * 3. `.env` 里没有 `JWT_SECRET` 时生成一枚强随机值写进去并注入当前进程；写不进去
 *    （目录只读等）就照旧拒绝启动，绝不允许用兜底默认密钥跑起来。
 */
export function bootstrapEnv(): void {
  if (!envFileExists() && existsSync(`${envFilePath()}.example`)) {
    copyFileSync(`${envFilePath()}.example`, envFilePath());
  }
  for (const [key, value] of Object.entries(readEnvValues())) {
    if (!String(process.env[key] || '').trim()) process.env[key] = value;
  }
  if (hasEnvValue('JWT_SECRET')) return;
  const secret = randomBytes(32).toString('hex');
  try {
    writeEnvKeys({ JWT_SECRET: secret });
  } catch {
    throw new Error(
      'JWT_SECRET 未配置，且无法写入 backend/.env——拒绝启动。请手工配置 JWT_SECRET',
    );
  }
  process.env.JWT_SECRET = secret;
}
