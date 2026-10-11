import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from './current-user';

export const Current = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CurrentUser => {
    const request = context.switchToHttp().getRequest<{ user?: CurrentUser }>();
    if (!request.user) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED);
    }
    return request.user;
  },
);
