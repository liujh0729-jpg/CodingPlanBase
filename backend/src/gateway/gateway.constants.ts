// 渠道供应商类型：编号沿用 new-api 的 `constant/channel.go`，
// 这样同一份渠道配置在两系统之间可以直接对照迁移。
// 转发协议只有两种（OpenAI 兼容 / Anthropic 兼容），其余差异收在 `api_prefix`。
import { randomBytes } from 'node:crypto';

/** new-api 的 1 = OpenAI，也是本系统「OpenAI 兼容」渠道的默认类型。 */
export const CHANNEL_TYPE_OPENAI = 1;
/** new-api 的 8 = Custom：第三方中转 / 自建网关，只要兼容 OpenAI 报文就能接。 */
export const CHANNEL_TYPE_CUSTOM = 8;
export const CHANNEL_TYPE_ANTHROPIC = 14;
export const CHANNEL_TYPE_AIPDD = 58;

/** 路径前缀默认值：OpenAI 报文口径 `{base}/v1/chat/completions`。 */
export const DEFAULT_API_PREFIX = '/v1';

/**
 * 规整上游前缀：补前导 `/`、去尾部 `/`，空值回落到 `/v1`。
 * 入库和选路都用它，否则 `https://x/api/v3` 与 `https://x//api/v3/` 会拼出双斜杠。
 */
export function normalizeApiPrefix(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw === '/') return DEFAULT_API_PREFIX;
  const withLead = raw.startsWith('/') ? raw : `/${raw}`;
  return withLead.replace(/\/+$/, '');
}

/** 上游报文协议：只有这两种是本系统真正转发得动的。 */
export type ChannelProtocol = 'openai' | 'anthropic';

/**
 * 类型 → 转发协议。Anthropic 系（14）走 `/v1/messages` 并带 `anthropic-version` 头，
 * 其余都按 OpenAI 兼容报文发出，路径差异由 `channel.apiPrefix` 消化。
 */
export function channelProtocol(type: number): ChannelProtocol {
  return type === CHANNEL_TYPE_ANTHROPIC ? 'anthropic' : 'openai';
}

/**
 * 上游鉴权头。Anthropic 报文认 `x-api-key`，而只做转发的网关常按 OpenAI 口径读
 * `Authorization: Bearer`，所以两种都带；`anthropic-version` 是 Messages API 必填项。
 */
export function upstreamAuthHeaders(
  protocol: ChannelProtocol,
  key: string,
): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (protocol === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  }
  return headers;
}

export const CHANNEL_STATUS = {
  UNKNOWN: 0,
  ENABLED: 1,
  MANUALLY_DISABLED: 2,
  AUTO_DISABLED: 3,
} as const;

export const AIPDD_CATALOG_PATH = '/v1/new-api/catalog';

/**
 * 把客户端路径换成该渠道的上游路径：客户端一律用 `/v1/...`，
 * 上游前缀不同的源（智谱 `/api/paas/v4`、火山方舟 `/api/v3`、阿里 `/compatible-mode/v1`）
 * 只改这一段，报文仍是 OpenAI 兼容。
 */
export function upstreamPath(apiPrefix: string, path: string): string {
  if (!path.startsWith('/v1')) return path;
  return `${normalizeApiPrefix(apiPrefix)}${path.slice(3)}`;
}

/**
 * 拼上游 URL。管理员常把 Base URL 直接写成带前缀的形式（`https://api.openai.com/v1`），
 * 此时上游路径已含在 baseUrl 里，再原样拼一次就变成 `/v1/v1/...`：
 * 只有「baseUrl 正好以该渠道前缀结尾」才去掉路径里的前缀段，其余一律直接拼。
 */
export function joinBaseUrl(
  base: string,
  apiPrefix: string,
  path: string,
): string {
  const trimmed = base.replace(/\/+$/, '');
  if (!trimmed) return path;
  const prefix = normalizeApiPrefix(apiPrefix);
  if (path.startsWith(prefix) && trimmed.toLowerCase().endsWith(prefix)) {
    return trimmed + path.slice(prefix.length);
  }
  return trimmed + path;
}

export const LOG_TYPE = {
  UNKNOWN: 0,
  TOPUP: 1,
  CONSUME: 2,
  MANAGE: 3,
  SYSTEM: 4,
  ERROR: 5,
  REFUND: 6,
} as const;

export function maskKey(key: string): string {
  if (key.length <= 8) return `${key.slice(0, 2)}****`;
  return `${key.slice(0, 4)}**********${key.slice(-4)}`;
}

/**
 * 上游错误报文常把本次使用的密钥原样回显（「invalid api key sk-xxx」），而这些报文会进
 * 渠道备注与用量日志并在管理界面展示：按该渠道已知密钥精确替换成掩码，并压平空白。
 */
export function redactKeys(raw: string, keys: string[]): string {
  let out = raw.replace(/\s+/g, ' ');
  for (const key of keys) {
    const item = key.trim();
    if (item.length >= 8) out = out.split(item).join(maskKey(item));
  }
  return out.trim();
}

/** 密钥级失败：上游判定这个 key 无效——换 key、换渠道的判据，也是自动禁用的唯一触发。 */
export function isKeyRejection(status: number, body: string): boolean {
  return status === 401 || status === 403 || /invalid.*api.*key/i.test(body);
}

/** 渠道侧暂时性故障（超时/限流/上游服务异常）：值得换下一个渠道；其余 4xx 是请求本身的问题。 */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export function generateTokenKey(): string {
  const alphabet =
    '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = randomBytes(48);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

/** 令牌 IP 白名单：逗号或换行分隔，空条目忽略。 */
export function parseIpRules(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 点分十进制 IPv4 → 无符号 32 位整数；不是合法 IPv4 返回 null。 */
function ipv4ToLong(value: string): number | null {
  const parts = value.trim().split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    out = out * 256 + octet;
  }
  return out >>> 0;
}

function isIpv4(value: string): boolean {
  return ipv4ToLong(value) !== null;
}

/** IPv6 只参与精确匹配（本底座不做 v6 段运算），按字符集宽松判定。 */
function isIpv6(value: string): boolean {
  return value.includes(':') && /^[0-9a-fA-F:]+$/.test(value);
}

function isIpRule(rule: string): boolean {
  if (rule === '*') return true;
  if (rule.includes('/')) {
    const [network, prefixText] = rule.split('/');
    if (!isIpv4(network) || !/^\d{1,2}$/.test(prefixText)) return false;
    return Number(prefixText) <= 32;
  }
  if (rule.endsWith('*')) {
    // 前缀通配（10.0.*）：去掉 * 之后得是 IP 的前导片段，只剩一个 * 等同于全放行
    const prefix = rule.slice(0, -1);
    return prefix === '' || /^[\d.]+$/.test(prefix);
  }
  return isIpv4(rule) || isIpv6(rule);
}

/** 返回第一条无法匹配的写法，全合法则返回 null——写错的规则等于把自己锁在门外，必须入库前指出。 */
export function findInvalidIpRule(rules: string[]): string | null {
  return rules.find((rule) => !isIpRule(rule)) ?? null;
}

/** 白名单匹配：`*` 全放行、精确地址、IPv4 CIDR 网段、尾 `*` 前缀通配。 */
export function ipMatches(ip: string, allowed: string[]): boolean {
  return allowed.some((rule) => {
    if (rule === '*' || rule === ip) return true;
    if (rule.includes('/')) return cidrMatches(ip, rule);
    if (rule.endsWith('*') && ip.startsWith(rule.slice(0, -1))) return true;
    return false;
  });
}

function cidrMatches(ip: string, rule: string): boolean {
  const [network, prefixText] = rule.split('/');
  const target = ipv4ToLong(ip);
  const base = ipv4ToLong(network);
  const prefix = Number(prefixText);
  if (target === null || base === null) return false;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (target & mask) >>> 0 === (base & mask) >>> 0;
}
