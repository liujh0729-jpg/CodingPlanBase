import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 安装向导对 `backend/.env` 的读写（该文件被 Git 忽略，是本机配置）。
 * 只保留原文件的注释与顺序：已存在的键就地改写，新键追加在末尾。
 * 任何键值都不写日志、不回显界面。
 */
const ENV_FILE = path.resolve(process.cwd(), '.env');

export function envFilePath(): string {
  return ENV_FILE;
}

export function envFileExists(): boolean {
  return existsSync(ENV_FILE);
}

/** 读出一个键当前是否已在 .env 里配置了非空值（不返回值本身）。 */
export function hasEnvValue(key: string): boolean {
  return Boolean(readEnvMap()[key]);
}

/**
 * 取出某个键的明文值，仅供服务端内部使用（拼连接串、判断运行时与 `.env` 是否一致）。
 * 任何接口响应、日志与异常信息都不许带出它的返回值。
 */
export function readEnvValue(key: string): string {
  return readEnvMap()[key] || '';
}

/** 整个 `.env` 的键值表；首启动时用来补齐进程环境里还没有的键（不覆盖已有值）。 */
export function readEnvValues(): Record<string, string> {
  return readEnvMap();
}

function readEnvMap(): Record<string, string> {
  const map: Record<string, string> = {};
  if (!envFileExists()) return map;
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  }
  return map;
}

function quote(value: string): string {
  // 连接串里出现空格 / # / ; 时不加引号会被 dotenv 截断
  return /["'\s#;]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

/** 写入（或追加）若干键；返回被改动的键名，不回传值。 */
export function writeEnvKeys(updates: Record<string, string>): string[] {
  const applied: string[] = [];
  const lines = envFileExists()
    ? readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)
    : [];
  const pending = new Map(Object.entries(updates));

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!pending.has(key)) continue;
    lines[index] = `${key}=${quote(pending.get(key) as string)}`;
    pending.delete(key);
    applied.push(key);
  }

  if (pending.size) {
    if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('');
    lines.push('# 由安装向导写入');
    for (const [key, value] of pending) {
      lines.push(`${key}=${quote(value)}`);
      applied.push(key);
    }
  }

  writeFileSync(ENV_FILE, `${lines.join('\n')}\n`, 'utf8');
  return applied;
}
