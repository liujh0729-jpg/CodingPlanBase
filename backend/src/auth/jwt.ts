import * as jwt from 'jsonwebtoken';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';

export interface TokenPayload {
  uid: number;
  username: string;
  role: number;
  /** 当前租户；0 = 无租户（平台侧会话）。切租户要重新签发令牌，不能只改前端状态。 */
  tenantId: number;
  type: 'access' | 'refresh';
}

function secret(): string {
  const value = String(process.env.JWT_SECRET || '').trim();
  if (!value) {
    throw new BusinessException(
      ErrorCode.UNAUTHORIZED,
      '服务端未配置 JWT_SECRET，拒绝验签',
    );
  }
  return value;
}

function issuer(): string {
  return String(process.env.JWT_ISSUER || 'codingplan-base').trim();
}

export function signAccessToken(payload: Omit<TokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, secret(), {
    algorithm: 'HS256',
    issuer: issuer(),
    expiresIn: (process.env.JWT_EXPIRES_IN ||
      '24h') as jwt.SignOptions['expiresIn'],
  });
}

export function signRefreshToken(payload: Omit<TokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'refresh' }, secret(), {
    algorithm: 'HS256',
    issuer: issuer(),
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ||
      '30d') as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(
  token: string,
  type: 'access' | 'refresh',
): TokenPayload {
  try {
    const payload = jwt.verify(token, secret(), {
      algorithms: ['HS256'],
      issuer: issuer(),
      clockTolerance: 10,
    }) as jwt.JwtPayload;
    if (payload.type !== type || typeof payload.uid !== 'number') {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, 'invalid token');
    }
    return {
      uid: payload.uid,
      username: String(payload.username || ''),
      role: Number(payload.role || 0),
      tenantId: Number(payload.tenantId || 0),
      type,
    };
  } catch (error) {
    if (error instanceof BusinessException) throw error;
    if (error instanceof Error && error.name === 'TokenExpiredError') {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '登录已过期');
    }
    throw new BusinessException(ErrorCode.UNAUTHORIZED, 'invalid token');
  }
}
