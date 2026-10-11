import { text } from './api';
import { BusinessException } from './business.exception';
import { ErrorCode } from './error-code';

/**
 * 路由参数与请求体里的记录 ID 统一走这里。
 * 直接 `Number(id)` 会让 `abc` / `undefined` 变成 NaN 传给 Prisma，
 * 结果是 HTTP 500 加一条堆栈日志；这里改判为 400，且不落到数据库。
 */
export function parseId(raw: unknown, label = '记录 ID'): number {
  const rawText = typeof raw === 'number' ? String(raw) : text(raw).trim();
  const value = Number(rawText);
  if (!rawText || !Number.isInteger(value) || value <= 0) {
    throw new BusinessException(ErrorCode.BAD_REQUEST, `${label}无效`);
  }
  return value;
}
