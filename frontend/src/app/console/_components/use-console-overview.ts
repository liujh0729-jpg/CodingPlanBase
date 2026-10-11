"use client";

import { useCallback, useEffect, useState } from "react";
import { loadApi } from "@/app/admin/_components/common";
import type { ConsoleOverview } from "@/lib/gateway";

/**
 * 租户侧各板块（管理菜单 / 订购管理）共用的租户概览（租户名 / 编码 / 额度池余量 / 成员数）：
 * hero 文案要讲清「正在管哪个租户」，订购板块还要按租户启停状态决定是否可下单。
 * tenantId 进依赖：从一个租户切到另一个租户时 enabled 可能一直是 true，
 * 不带租户就只能看到上一个租户的余量。
 */
export function useConsoleOverview(
  enabled: boolean,
  tenantId: number | null,
) {
  const [overview, setOverview] = useState<ConsoleOverview | null>(null);
  const [overviewError, setOverviewError] = useState("");

  const reload = useCallback(async () => {
    const result = await loadApi<ConsoleOverview>("/console/overview");
    if (result.forbidden || result.message) {
      setOverviewError(result.message || "没有访问权限");
      return;
    }
    setOverview(result.data);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setOverview(null);
      return;
    }
    void reload();
  }, [enabled, tenantId, reload]);

  return { overview, overviewError, reload };
}
