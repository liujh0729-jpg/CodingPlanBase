"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const EnterpriseProLayout = dynamic(
  () =>
    import("./pro/pro-layout").then((module) => module.EnterpriseProLayout),
  {
    ssr: false,
    loading: () => (
      <div style={{ minHeight: "100vh", background: "#f5f5f5" }} />
    ),
  },
);

/** 登录页与安装向导独立于工作台外壳渲染（不显示侧栏与顶栏）。 */
const SHELL_FREE_PATHS = ["/login", "/install"];

/** 移动端 H5 版面（微信服务号菜单入口）：整屏一列，不套桌面侧栏与顶栏。 */
const SHELL_FREE_PREFIXES = ["/m/"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (
    SHELL_FREE_PATHS.includes(pathname) ||
    SHELL_FREE_PREFIXES.some((prefix) => pathname?.startsWith(prefix))
  ) {
    return <>{children}</>;
  }
  return <EnterpriseProLayout>{children}</EnterpriseProLayout>;
}