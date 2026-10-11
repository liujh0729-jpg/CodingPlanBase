import { NextRequest, NextResponse } from "next/server";
import { createApiEnvelope, isApiSuccessCode, type ApiResponse } from "@/lib/api-envelope";
import { setAuthCookies, type SessionTokens } from "@/lib/auth-session";
import { backendUrl } from "@/lib/config";

/**
 * 本项目内登录：BFF 代调后端 `/auth/login` 并把令牌写入 httpOnly Cookie，
 * 浏览器脚本拿不到令牌，登录后回到 ?next=。
 */
export async function POST(request: NextRequest) {
  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as { username?: string; password?: string };
  } catch {
    return NextResponse.json(createApiEnvelope(400, "请求格式不正确", null), {
      status: 400,
    });
  }
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) {
    return NextResponse.json(
      createApiEnvelope(400, "请输入账号与密码", null),
      { status: 400 },
    );
  }

  let payload: ApiResponse<SessionTokens> | null = null;
  let unreachable = false;
  try {
    const upstream = await fetch(`${backendUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });
    payload = (await upstream.json().catch(() => null)) as ApiResponse<SessionTokens> | null;
  } catch {
    unreachable = true;
  }

  const tokens = payload?.data;
  const okCode = Boolean(
    !unreachable && isApiSuccessCode(payload?.code ?? -1) && tokens?.accessToken,
  );

  if (!okCode) {
    const serviceUnavailable = unreachable || !payload;
    return NextResponse.json(
      createApiEnvelope(
        serviceUnavailable ? 502 : payload?.code || 401,
        serviceUnavailable
          ? "后端服务不可用，请确认后端已启动"
          : payload?.message || "登录失败",
        null,
      ),
      { status: serviceUnavailable ? 502 : 401 },
    );
  }

  const response = NextResponse.json(createApiEnvelope(0, "登录成功", null));
  setAuthCookies(response, tokens!);
  return response;
}
