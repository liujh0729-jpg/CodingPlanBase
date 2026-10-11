import { NextRequest, NextResponse } from "next/server";
import {
  createApiEnvelope,
  isApiSuccessCode,
  type ApiResponse,
} from "@/lib/api-envelope";
import {
  ACCESS_TOKEN_COOKIE,
  AUTH_COOKIE_MAX_AGE,
  AUTH_COOKIE_SECURE,
  REFRESH_TOKEN_COOKIE,
  backendUrl,
} from "@/lib/config";

/** 后端 `/auth/login|register|refresh` 返回的会话令牌。 */
export type SessionTokens = {
  accessToken: string;
  refreshToken?: string;
};

/**
 * 提前 5 分钟续签：把续签放在用户还在浏览的时候，而不是等令牌刚好失效那一刻
 * （那时失败就直接掉登录）。
 */
const TOKEN_REFRESH_SKEW_SECONDS = 5 * 60;

const authCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: AUTH_COOKIE_SECURE,
  path: "/",
  maxAge: AUTH_COOKIE_MAX_AGE,
};

type TokenClaims = {
  exp?: unknown;
  type?: unknown;
  uid?: unknown;
  username?: unknown;
  role?: unknown;
};

export function normalizeToken(raw?: string) {
  if (!raw) return undefined;
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  if (value.toLowerCase().startsWith("bearer ")) {
    value = value.slice(7).trim();
  }
  try {
    value = decodeURIComponent(value);
  } catch {
    // 非 URI 编码的 Cookie 原样使用
  }
  return value || undefined;
}

export function readAccessToken(request: NextRequest) {
  return (
    normalizeToken(request.cookies.get(ACCESS_TOKEN_COOKIE)?.value) ||
    normalizeToken(request.headers.get("authorization") || undefined)
  );
}

export function readRefreshToken(request: NextRequest) {
  return normalizeToken(request.cookies.get(REFRESH_TOKEN_COOKIE)?.value);
}

export function peekTokenClaims(token?: string): TokenClaims | null {
  if (!token) return null;
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")),
    ) as TokenClaims;
  } catch {
    return null;
  }
}

export function tokenNeedsRefresh(token?: string) {
  if (!token) return true;
  const claims = peekTokenClaims(token);
  if (!claims) return true;
  if (claims.type === "refresh") return true;
  if (typeof claims.exp !== "number") return false;
  return claims.exp <= Math.floor(Date.now() / 1000) + TOKEN_REFRESH_SKEW_SECONDS;
}

export function resolveAuthTokens(request: NextRequest) {
  let accessToken = readAccessToken(request);
  let refreshToken = readRefreshToken(request);
  const accessClaims = peekTokenClaims(accessToken);
  if (accessClaims?.type === "refresh" && !refreshToken) {
    refreshToken = accessToken;
    accessToken = undefined;
  }
  return { accessToken, refreshToken };
}

export function setAuthCookies(response: NextResponse, tokens: SessionTokens) {
  response.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, authCookieOptions);
  if (tokens.refreshToken) {
    response.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, authCookieOptions);
  }
}

export function clearAuthCookies(response: NextResponse) {
  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE]) {
    response.cookies.set(name, "", { path: "/", maxAge: 0 });
  }
}

export async function refreshAuthToken(
  refreshToken: string | undefined,
): Promise<SessionTokens | null> {
  if (!refreshToken) return null;
  const claims = peekTokenClaims(refreshToken);
  if (!claims) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp <= now) return null;
  try {
    const response = await fetch(`${backendUrl}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | ApiResponse<SessionTokens>
      | null;
    if (response.ok && payload && isApiSuccessCode(payload.code) && payload.data?.accessToken) {
      return {
        accessToken: payload.data.accessToken,
        refreshToken: payload.data.refreshToken,
      };
    }
  } catch {
    // 后端不可达：按续签失败处理（中间件会带 reason=expired 回登录页）
  }
  return null;
}

export async function ensureFreshAccessToken(request: NextRequest) {
  const { accessToken, refreshToken } = resolveAuthTokens(request);
  if (!refreshToken || !tokenNeedsRefresh(accessToken)) {
    return { accessToken, refreshed: null as SessionTokens | null };
  }
  const refreshed = await refreshAuthToken(refreshToken);
  return {
    accessToken: refreshed?.accessToken || accessToken,
    refreshed,
  };
}

/**
 * 会话类接口（登录 / 注册 / 切租户 / 创建·加入租户）都会换发令牌，而当前租户就写在
 * 令牌里：这里代调后端并把新令牌写回 httpOnly Cookie，失败原因原样回传，
 * 浏览器脚本拿不到令牌，也就改不了自己的记账上下文。
 */
export async function callSessionEndpoint(
  request: NextRequest,
  path: string,
  body: Record<string, unknown>,
  okMessage: string,
): Promise<NextResponse> {
  const { accessToken } = await ensureFreshAccessToken(request);
  let payload: ApiResponse<SessionTokens> | null = null;
  let unreachable = false;
  try {
    const upstream = await fetch(`${backendUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    payload = (await upstream.json().catch(() => null)) as
      | ApiResponse<SessionTokens>
      | null;
  } catch {
    unreachable = true;
  }
  const tokens = payload?.data;
  if (unreachable || !payload || !isApiSuccessCode(payload.code) || !tokens?.accessToken) {
    const serviceUnavailable = unreachable || !payload;
    return NextResponse.json(
      createApiEnvelope(
        serviceUnavailable ? 502 : payload?.code ?? -1,
        serviceUnavailable
          ? "后端服务不可用，请确认后端已启动"
          : payload?.message || "操作失败",
        null,
      ),
      { status: serviceUnavailable ? 502 : 400 },
    );
  }
  const response = NextResponse.json(createApiEnvelope(0, okMessage, null));
  setAuthCookies(response, tokens);
  return response;
}

