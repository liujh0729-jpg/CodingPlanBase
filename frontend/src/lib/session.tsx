"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, isAuthFreePath } from "./api";
import type { ApiResponse } from "./api-envelope";
import type { TenantBrief } from "./gateway";

export const ROLE_USER = 1;
export const ROLE_ADMIN = 10;
export const ROLE_ROOT = 100;
/** 租户内权限（不是全局身份）：同一个人在 A 租户可以是管理员，在 B 租户只是成员。 */
export const MEMBER_ROLE_USER = 1;
export const MEMBER_ROLE_ADMIN = 5;

/**
 * 与后端 `/auth/me` 的会话视图同源：全局身份 + 当前租户里的成员身份 +
 * 我所属的全部租户。额度 / 用量都是「当前租户给我的那一份」。
 */
export type BaseMe = {
  id: number;
  username: string;
  displayName: string;
  role: number;
  status: number;
  email: string;
  userGroup: string;
  affCode: string;
  chandlerLinked: boolean;
  lastLoginAt: number;
  createdAt: string;
  /** 当前租户（记账上下文）；null = 还没加入任何租户，要先创建或加入。 */
  tenantId: number | null;
  tenantName: string;
  tenantCode: string;
  tenantStatus: number;
  memberRole: number;
  quota: number;
  usedQuota: number;
  requestCount: number;
  tenantCount: number;
  tenants: TenantBrief[];
};

type SessionValue = {
  me: BaseMe | null;
  loading: boolean;
  /** 平台管理员（role ≥ 10）：可见平台管理后台。 */
  isAdmin: boolean;
  /** 超级管理员（role ≥ 100）：可处置超管账号与角色阶梯顶端。 */
  isRoot: boolean;
  /** 当前租户的管理员：管理菜单只对「这个租户里的他」开放，切租户后就换一个身份。 */
  isTenantAdmin: boolean;
  /** 已加入至少一个租户：没有租户时额度、令牌、用量都还没有记账处。 */
  hasTenant: boolean;
  /** 前台「设置 → 订购管理」可见：租户管理员对自家租户下单，平台管理员 / 超管看全平台单据。 */
  canOrder: boolean;
  refresh: () => Promise<void>;
  logout: () => void;
  /** 切租户：BFF 重写会话 Cookie 后刷新，页面读到的额度 / 令牌 / 日志就是目标租户那一份。 */
  switchTenant: (tenantId: number) => Promise<ApiResponse<null>>;
  createTenant: (name: string, code?: string) => Promise<ApiResponse<null>>;
  joinTenant: (code: string) => Promise<ApiResponse<null>>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<BaseMe | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const payload = await api<BaseMe>("/auth/me");
    if (payload.code === 401) {
      setMe(null);
      setLoading(false);
      // 免登录页（登录页 / 安装向导）上的 401 就是「未登录」，不再跳转（避免重定向成环）
      if (isAuthFreePath()) return;
      const login = new URL("/login", window.location.origin);
      const next = `${window.location.pathname}${window.location.search}`;
      login.searchParams.set("next", next);
      window.location.href = login.toString();
      return;
    }
    setMe(payload.code === 0 ? payload.data : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** 退出登录：Cookie 为 httpOnly，必须由服务端下发过期 Cookie 才能真正清除。 */
  const logout = useCallback(() => {
    window.location.href = "/api/auth/logout?next=/login";
  }, []);

  /**
   * 身份类操作都换发令牌（当前租户写在令牌里），而 Cookie 只能由服务端写：
   * 走 BFF 成功后重取 `/auth/me`，整站立刻按新租户取数。
   */
  const tenantAction = useCallback(
    async (
      action: "switch" | "create" | "join",
      body: Record<string, unknown>,
    ): Promise<ApiResponse<null>> => {
      const response = await fetch(`/api/auth/tenants/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | ApiResponse<null>
        | null;
      if (payload?.code === 0) {
        await refresh();
        return payload;
      }
      return (
        payload ?? {
          code: 502,
          message: "后端服务不可用，请稍后再试",
          data: null,
        }
      );
    },
    [refresh],
  );

  const switchTenant = useCallback(
    (tenantId: number) => tenantAction("switch", { tenantId }),
    [tenantAction],
  );
  const createTenant = useCallback(
    (name: string, code?: string) => tenantAction("create", { name, code }),
    [tenantAction],
  );
  const joinTenant = useCallback(
    (code: string) => tenantAction("join", { code }),
    [tenantAction],
  );

  const value = useMemo(
    () => ({
      me,
      loading,
      isAdmin: (me?.role ?? 0) >= ROLE_ADMIN,
      isRoot: (me?.role ?? 0) >= ROLE_ROOT,
      isTenantAdmin: me?.tenantId != null && me?.memberRole === MEMBER_ROLE_ADMIN,
      hasTenant: (me?.tenantCount ?? 0) > 0,
      canOrder:
        (me?.role ?? 0) >= ROLE_ADMIN ||
        (me?.tenantId != null && me?.memberRole === MEMBER_ROLE_ADMIN),
      refresh,
      logout,
      switchTenant,
      createTenant,
      joinTenant,
    }),
    [me, loading, refresh, logout, switchTenant, createTenant, joinTenant],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return value;
}
