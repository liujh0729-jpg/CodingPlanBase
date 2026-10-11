import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { BusinessException } from './business.exception';
import { ErrorCode } from './error-code';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // 网关转发已把上游报文（或 SSE 流）写出去了：此时再写响应只会抛 ERR_HTTP_HEADERS_SENT
    if (response.headersSent) {
      this.log.error(
        `${request.method} ${request.url}（响应已发出，仅记录不重发）`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      return;
    }

    if (exception instanceof BusinessException) {
      response.status(exception.errorCode.httpStatus).json({
        code: exception.errorCode.code,
        message: exception.message,
        data: exception.data,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code =
        status === 401
          ? ErrorCode.UNAUTHORIZED
          : status === 403
            ? ErrorCode.FORBIDDEN
            : status === 404
              ? ErrorCode.NOT_FOUND
              : status === 409
                ? ErrorCode.CONFLICT
                : status >= 500
                  ? ErrorCode.INTERNAL_ERROR
                  : ErrorCode.BAD_REQUEST;
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : payload && typeof payload === 'object' && 'message' in payload
            ? String(
                Array.isArray(payload.message)
                  ? payload.message[0]
                  : payload.message,
              )
            : code.message;
      response.status(status).json({
        code: code.code,
        message,
        data: null,
      });
      return;
    }

    this.log.error(
      `${request.method} ${request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(500).json({
      code: ErrorCode.INTERNAL_ERROR.code,
      message: ErrorCode.INTERNAL_ERROR.message,
      data: null,
    });
  }
}
