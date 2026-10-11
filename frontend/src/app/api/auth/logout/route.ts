import { NextRequest, NextResponse } from "next/server";
import { clearAuthCookies } from "@/lib/auth-session";
import { safeNextPath } from "@/lib/safe-next";

/**
 * 退出登录：鉴权 Cookie 是 httpOnly，前端 JS 删不掉，必须由服务端下发
 * 过期 Cookie 才能真正清除。清完回到本系统登录页。
 */
export async function GET(request: NextRequest) {
  const target = safeNextPath(request.nextUrl.searchParams.get("next"), "/login");
  const response = NextResponse.redirect(new URL(target, request.nextUrl.origin));
  clearAuthCookies(response);
  return response;
}
