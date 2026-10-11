import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from './current-user';
import { loadMemberships, pickActiveMembership } from './identity';
import { verifyToken } from './jwt';

// 健康检查、本地登录注册、chandler 联合登录/回调、支付回调（平台侧调用，无本系统令牌）
// 前端未登录就要读的：公开配置、商品列表、模型价目表
const PUBLIC_PATHS = [
  /^\/health(?:\/(?:ready|version))?$/,
  /^\/auth\/(login|register|refresh)$/,
  /^\/auth\/chandler(\/(authorize-url|callback|status))?$/,
  /^\/pay\/webhook$/,
  /^\/pay\/products$/,
  /^\/settings\/public$/,
  /^\/gateway\/models$/,
  // 安装向导必须免登录（安装时还没有任何账号）；写接口在服务端按「已有超管即 403」收口
  /^\/install(\/(status|database|secret|schema|admin))?$/,
];

// 网关转发端点自行做 sk- 令牌鉴权（见 RelayController），全局守卫放行
const RELAY_PATHS = [/^\/v1(\/|$)/];

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: CurrentUser }>();
    const path = request.path;
    if (PUBLIC_PATHS.some((pattern) => pattern.test(path))) return true;
    if (RELAY_PATHS.some((pattern) => pattern.test(path))) return true;
    const token = bearer(request);
    if (!token) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, 'missing token');
    }
    const payload = verifyToken(normalizeToken(token), 'access');
    // 当前租户每次请求都重新解析：成员关系被停用/移除后，旧令牌里的租户线索立刻失效，
    // 不需要等令牌过期，也不需要前端配合做什么。
    const memberships = await loadMemberships(this.prisma, payload.uid);
    const active = pickActiveMembership(memberships, payload.tenantId || null);
    request.user = new CurrentUser(
      payload.uid,
      payload.username,
      payload.role,
      active?.tenantId ?? null,
      active?.role ?? 0,
    );
    return true;
  }
}

function bearer(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return undefined;
  }
  return header.slice(7).trim();
}

function normalizeToken(token: string) {
  let value = token.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  try {
    value = decodeURIComponent(value);
  } catch {
    // keep the raw bearer token when it is not URI-encoded
  }
  return value;
}
