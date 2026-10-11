import { NextRequest, NextResponse } from "next/server";
import { createApiEnvelope, isApiSuccessCode, type ApiResponse } from "@/lib/api-envelope";
import { setAuthCookies, type SessionTokens } from "@/lib/auth-session";
import { backendUrl } from "@/lib/config";

type RegisterBody = {
  username?: string;
  password?: string;
  displayName?: string;
  /** 注册即定租户：create＝自建（自己为该租户管理员），join＝按编码加入。 */
  tenantMode?: string;
  tenantName?: string;
  tenantCode?: string;
};

/**
 * 自助注册：成功后直接签发会话（与后端 `/auth/register` 一致），失败原因原样回传。
 * 带 tenantMode 时一步把租户定下来；没带就落在「还没有租户」的会话上，
 * 由顶栏的创建/加入租户引导接着走。
 */
export async function POST(request: NextRequest) {
  let body: RegisterBody;
  try {
    body = (await request.json()) as RegisterBody;
  } catch {
    return NextResponse.json(createApiEnvelope(400, "请求格式不正确", null), {
      status: 400,
    });
  }
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (!username || !password) {
    return NextResponse.json(
      createApiEnvelope(400, "请输入用户名与密码", null),
      { status: 400 },
    );
  }
  const tenantMode = String(body.tenantMode || "");
  const tenantName = String(body.tenantName || "").trim().slice(0, 60);
  const tenantCode = String(body.tenantCode || "").trim().slice(0, 32);
  if (tenantMode === "create" && !tenantName) {
    return NextResponse.json(createApiEnvelope(400, "请输入租户名称", null), {
      status: 400,
    });
  }
  if (tenantMode === "join" && !tenantCode) {
    return NextResponse.json(createApiEnvelope(400, "请输入租户编码", null), {
      status: 400,
    });
  }

  let payload: ApiResponse<SessionTokens> | null = null;
  let unreachable = false;
  try {
    const upstream = await fetch(`${backendUrl}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        displayName: String(body.displayName || "").trim(),
        ...(tenantMode === "create" || tenantMode === "join"
          ? {
              tenantMode,
              ...(tenantMode === "create"
                ? { tenantName, ...(tenantCode ? { tenantCode } : {}) }
                : { tenantCode }),
            }
          : {}),
      }),
      cache: "no-store",
    });
    payload = (await upstream.json().catch(() => null)) as ApiResponse<SessionTokens> | null;
  } catch {
    unreachable = true;
  }

  const tokens = payload?.data;
  if (unreachable || !payload || !isApiSuccessCode(payload.code) || !tokens?.accessToken) {
    return NextResponse.json(
      createApiEnvelope(
        unreachable || !payload ? 502 : payload.code,
        unreachable || !payload
          ? "后端服务不可用，请稍后再试"
          : payload.message || "注册失败",
        null,
      ),
      { status: unreachable || !payload ? 502 : 400 },
    );
  }

  const response = NextResponse.json(createApiEnvelope(0, "注册成功", null));
  setAuthCookies(response, tokens);
  return response;
}
