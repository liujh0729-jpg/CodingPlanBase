import { NextRequest, NextResponse } from "next/server";
import { createApiEnvelope } from "@/lib/api-envelope";
import { ensureFreshAccessToken, setAuthCookies } from "@/lib/auth-session";
import { backendUrl } from "@/lib/config";

async function proxy(request: NextRequest, path: string[]) {
  const target = `${backendUrl}/${path.join("/")}${request.nextUrl.search}`;
  try {
    const { accessToken, refreshed } = await ensureFreshAccessToken(request);
    const headers = new Headers();
    const accept = request.headers.get("accept");
    const contentType = request.headers.get("content-type");
    if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
    if (accept) headers.set("accept", accept);
    if (contentType) headers.set("content-type", contentType);

    const init: RequestInit = {
      method: request.method,
      headers,
      cache: "no-store",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = await request.text();
    }

    const upstream = await fetch(target, init);
    const body = await upstream.text();
    const response = new NextResponse(body, {
      status: upstream.status,
      headers: {
        "content-type":
          upstream.headers.get("content-type") || "application/json",
      },
    });
    if (refreshed) setAuthCookies(response, refreshed);
    return response;
  } catch (error) {
    return NextResponse.json(
      createApiEnvelope(
        503,
        error instanceof Error ? error.message : "backend unreachable",
        null,
      ),
      { status: 503 },
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  return proxy(request, path);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  return proxy(request, path);
}
