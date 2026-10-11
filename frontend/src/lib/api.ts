import { createApiEnvelope, isApiSuccessCode, type ApiResponse } from "./api-envelope";

/**
 * 路径段里出现 undefined / null / NaN ＝ 调用方把空 id 拼进了 URL（实测后端拿它查库直接 500）。
 * 这种请求不可能成功，就地拦下并给出可读错误，别让脏 id 出网。
 */
const INVALID_PATH_SEGMENTS = new Set(["undefined", "null", "NaN"]);

/** 免登录页面：在这里 401 只代表「还没登录」，不能再触发跳转，否则自我重定向成环。 */
const AUTH_FREE_PATHS = ["/login", "/install"];

export function isAuthFreePath(): boolean {
  if (typeof window === "undefined") return true;
  const path = window.location.pathname;
  return AUTH_FREE_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function invalidPath(path: string) {
  const [pathname] = path.split("?");
  const bad = pathname.split("/").find((segment) => INVALID_PATH_SEGMENTS.has(segment));
  return bad ? `${path}（路径段 ${bad}）` : "";
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResponse<T>> {
  const invalid = invalidPath(path);
  if (invalid) {
    return createApiEnvelope(400, `请求地址缺少单据号：${invalid}`, null) as ApiResponse<T>;
  }
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`/api/backend${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  try {
    const payload = (await response.json()) as ApiResponse<T>;
    if (payload.code === 401 && typeof window !== "undefined") {
      // 登录页与安装向导本身会带出 401（未登录是正常状态），不能再跳
      if (!isAuthFreePath()) {
        const next = `${window.location.pathname}${window.location.search}`;
        const login = new URL("/login", window.location.origin);
        login.searchParams.set("next", next);
        window.location.href = login.toString();
      }
    }
    return payload;
  } catch {
    return createApiEnvelope(
      response.status,
      "invalid response",
      null,
    ) as ApiResponse<T>;
  }
}

export async function apiData<T>(path: string, init?: RequestInit): Promise<T> {
  const payload = await api<T>(path, init);
  if (!isApiSuccessCode(payload.code) || payload.data == null) {
    throw new Error(payload.message || "request failed");
  }
  return payload.data;
}

export function postJson<T = unknown>(path: string, body: unknown): Promise<ApiResponse<T>> {
  return api<T>(path, { method: "POST", body: JSON.stringify(body) });
}

/**
 * 取数失败一律回退（避免无权限 / 接口缺口打断整页渲染）。
 * 各业务模块的 common.ts 统一再导出本函数，不再各自实现。
 */
export async function safeData<T>(path: string, fallback: T): Promise<T> {
  try {
    return await apiData<T>(path);
  } catch {
    return fallback;
  }
}
