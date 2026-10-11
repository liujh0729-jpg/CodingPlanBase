import { NextRequest, NextResponse } from "next/server";
import { createApiEnvelope, type ApiResponse } from "@/lib/api-envelope";
import {
  ensureFreshAccessToken,
  setAuthCookies,
  type SessionTokens,
} from "@/lib/auth-session";
import { backendUrl, siteUrl } from "@/lib/config";

type CallbackResult = SessionTokens & { linked?: boolean };

/**
 * Chandler.work 联合登录 / 绑定回调：平台带 code 跳回这里，BFF 代调后端
 * `/auth/chandler/callback` 换成本地会话或把平台身份绑到当前账号。
 * redirectUri 必须与授权时完全一致，因此固定由本站域名拼出，不接受外部传入。
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") || "";
  if (!code) {
    return NextResponse.json(createApiEnvelope(400, "缺少授权码", null), { status: 400 });
  }
  const redirectUri = `${siteUrl}/api/auth/chandler/callback`;
  // 已登录时带上本系统令牌：走「绑定到当前账号」，否则按联合登录签发影子账户会话
  const { accessToken } = await ensureFreshAccessToken(request);

  let payload: ApiResponse<CallbackResult> | null = null;
  try {
    const upstream = await fetch(`${backendUrl}/auth/chandler/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirectUri, accessToken: accessToken || "" }),
      cache: "no-store",
    });
    payload = (await upstream.json().catch(() => null)) as ApiResponse<CallbackResult> | null;
  } catch {
    payload = null;
  }

  const data = payload?.data;
  const back = new URL("/account", siteUrl);
  if (payload?.code === 0 && data) {
    const response = NextResponse.redirect(back);
    // 绑定当前账号时不换会话；联合登录新账户才下发 Cookie
    if (!data.linked && data.accessToken) setAuthCookies(response, data);
    back.searchParams.set("chandler", "linked");
    return response;
  }

  back.searchParams.set("chandler", "failed");
  back.searchParams.set(
    "reason",
    encodeURIComponent((payload?.message || "后端服务不可用").slice(0, 80)),
  );
  return NextResponse.redirect(back);
}
