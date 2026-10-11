import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ensureFreshAccessToken,
  readAccessToken,
  readRefreshToken,
  setAuthCookies,
  tokenNeedsRefresh,
} from "@/lib/auth-session";

function loginRedirect(request: NextRequest, reason?: string) {
  const login = new URL("/login", request.nextUrl.origin);
  login.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  if (reason) login.searchParams.set("reason", reason);
  return NextResponse.redirect(login);
}

export async function proxy(request: NextRequest) {
  const hadSession = Boolean(readAccessToken(request) || readRefreshToken(request));
  const { accessToken, refreshed } = await ensureFreshAccessToken(request);
  if (accessToken && !tokenNeedsRefresh(accessToken)) {
    const response = NextResponse.next();
    if (refreshed) setAuthCookies(response, refreshed);
    return response;
  }
  // 有会话 Cookie 说明是「会话过期/续签失败」，回登录页时带上原因；
  // 从未登录过则直接进登录页。
  return loginRedirect(request, hadSession ? "expired" : undefined);
}

export const config = {
  // install 免登录：全新库还没有任何账号，登录页也进不去，向导是唯一入口
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.ico|icon.svg|login|install).*)"],
};
