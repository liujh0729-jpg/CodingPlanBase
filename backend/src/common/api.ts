export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
}

export interface PageResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function pageParam(
  page?: number | string,
  pageSize?: number | string,
  fallback = 10,
) {
  const pageNo = Number(page || 1);
  const size = Number(pageSize ?? fallback);
  const normalizedPageNo =
    Number.isFinite(pageNo) && pageNo > 0 ? Math.floor(pageNo) : 1;
  const normalizedPageSize =
    Number.isFinite(size) && size > 0
      ? Math.min(Math.floor(size), 200)
      : fallback;
  return {
    page: normalizedPageNo,
    pageSize: normalizedPageSize,
    offset: (normalizedPageNo - 1) * normalizedPageSize,
  };
}

export function pageOf<T>(
  list: T[],
  total: number,
  page: number,
  pageSize: number,
): PageResponse<T> {
  return { list, total, page, pageSize };
}

export function ok<T>(data: T | null = null, message = 'ok'): ApiResponse<T> {
  return { code: 0, message, data };
}

/**
 * 未知值 → 文本列。请求体 / 上游报文的值是 `unknown`，直接 `String(...)` 会把对象
 * 变成 `[object Object]` 当成有效内容写库、给界面、发上游；这里对象一律取 fallback。
 * 标量数组按逗号拼接（与历史 `String(['a','b'])` = `'a,b'` 保持一致，不丢数据）。
 */
export function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => text(item))
      .filter((item) => item !== '')
      .join(',');
  }
  return fallback;
}
