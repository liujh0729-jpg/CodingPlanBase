export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T | null;
}

export function createApiEnvelope<T>(
  code: number,
  message: string,
  data: T | null,
): ApiResponse<T> {
  return { code, message, data };
}

export function isApiSuccessCode(code: number) {
  return code === 0;
}
