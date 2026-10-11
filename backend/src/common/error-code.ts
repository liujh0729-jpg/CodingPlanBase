export const ErrorCode = {
  SUCCESS: { code: 0, message: 'ok', httpStatus: 200 },
  BAD_REQUEST: { code: 400, message: 'bad request', httpStatus: 400 },
  UNAUTHORIZED: { code: 401, message: 'unauthorized', httpStatus: 401 },
  FORBIDDEN: { code: 403, message: 'forbidden', httpStatus: 403 },
  NOT_FOUND: { code: 404, message: 'not found', httpStatus: 404 },
  CONFLICT: { code: 409, message: 'conflict', httpStatus: 409 },
  VALIDATION_ERROR: {
    code: 422,
    message: 'validation failed',
    httpStatus: 422,
  },
  QUOTA_EXCEEDED: {
    code: 429,
    message: 'quota exceeded',
    httpStatus: 429,
  },
  RATE_LIMITED: {
    code: 429,
    message: 'rate limited',
    httpStatus: 429,
  },
  INTERNAL_ERROR: {
    code: 500,
    message: 'internal server error',
    httpStatus: 500,
  },
  SERVICE_UNAVAILABLE: {
    code: 503,
    message: 'service unavailable',
    httpStatus: 503,
  },
  ROLE_MISMATCH: {
    code: 20002,
    message: 'role mismatch',
    httpStatus: 403,
  },
  ORDER_STATE: {
    code: 23001,
    message: 'invalid order state',
    httpStatus: 409,
  },
  NOT_IMPLEMENTED: {
    code: 501,
    message: 'not implemented',
    httpStatus: 501,
  },
} as const;

export type ErrorCodeName = keyof typeof ErrorCode;
export type ErrorCodeValue = (typeof ErrorCode)[ErrorCodeName];
