import { NextRequest, NextResponse } from "next/server";
import { createApiEnvelope } from "@/lib/api-envelope";
import { callSessionEndpoint } from "@/lib/auth-session";

/**
 * 租户身份动作的 BFF：切租户 / 创建租户 / 按编码加入租户都会换发会话令牌
 * （当前租户写在令牌里，之后扣的是哪个租户的额度由它决定），
 * 所以必须走这里把新令牌写进 httpOnly Cookie，不能让浏览器直连 Nest。
 * action 是白名单，不能把路径参数原样拼进上游地址。
 */
const ACTIONS = {
  switch: { path: "/auth/tenants/switch", message: "已切换租户", parse: parseSwitch },
  create: { path: "/auth/tenants/create", message: "租户已创建", parse: parseCreate },
  join: { path: "/auth/tenants/join", message: "已加入租户", parse: parseJoin },
} as const;

type Action = keyof typeof ACTIONS;

function bad(message: string) {
  return NextResponse.json(createApiEnvelope(400, message, null), { status: 400 });
}

function parseSwitch(body: Record<string, unknown>) {
  const tenantId = Number(body.tenantId);
  return Number.isInteger(tenantId) && tenantId > 0
    ? { ok: true as const, payload: { tenantId } }
    : { ok: false as const };
}

function parseCreate(body: Record<string, unknown>) {
  const name = String(body.name ?? "").trim().slice(0, 60);
  const code = String(body.code ?? "").trim().slice(0, 40);
  return name
    ? { ok: true as const, payload: { name, ...(code ? { code } : {}) } }
    : { ok: false as const };
}

function parseJoin(body: Record<string, unknown>) {
  const code = String(body.code ?? "").trim().slice(0, 40);
  return code ? { ok: true as const, payload: { code } } : { ok: false as const };
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ action: string }> },
) {
  const { action } = await context.params;
  const handler = ACTIONS[action as Action];
  if (!handler) return bad("不支持的操作");
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("请求格式不正确");
  }
  const parsed = handler.parse(body);
  if (!parsed.ok) return bad("请填写完整信息");
  return callSessionEndpoint(request, handler.path, parsed.payload, handler.message);
}
