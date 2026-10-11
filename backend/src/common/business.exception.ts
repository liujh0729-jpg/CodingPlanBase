import { HttpException } from '@nestjs/common';
import type { ErrorCodeValue } from './error-code';

export class BusinessException extends HttpException {
  readonly errorCode: ErrorCodeValue;
  readonly data: unknown;

  constructor(
    errorCode: ErrorCodeValue,
    message?: string,
    data: unknown = null,
  ) {
    super(message || errorCode.message, errorCode.httpStatus);
    this.errorCode = errorCode;
    this.data = data;
  }
}
