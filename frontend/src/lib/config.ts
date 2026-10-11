export const backendUrl =
  process.env.BACKEND_URL || "http://127.0.0.1:1690";
export const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:15889";

export const ACCESS_TOKEN_COOKIE = "codingplan_token";
export const REFRESH_TOKEN_COOKIE = "codingplan_refresh";
export const AUTH_COOKIE_SECURE = process.env.AUTH_COOKIE_SECURE === "true";
/** 与后端 refresh 令牌寿命（30d）对齐。 */
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
