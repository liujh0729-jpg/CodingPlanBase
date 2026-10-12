"use client";

import { useParams } from "next/navigation";
import { EmptyState, PageHero, Panel } from "@/components/ui/panel";
import { ADMIN_SECTIONS, adminSectionAllowed } from "@/config/routes";
import { useSession } from "@/lib/session";
import { ChannelsTab } from "../_components/channels-tab";
import { LogsTab } from "../_components/logs-tab";
import { ModelsTab } from "../_components/models-tab";
import { OrdersTab } from "../_components/orders-tab";
import { OverviewTab } from "../_components/overview-tab";
import { PaymentsTab } from "../_components/payments-tab";
import { SettingsTab } from "../_components/settings-tab";
import { TenantsTab } from "../_components/tenants-tab";
import { TokensTab } from "../_components/tokens-tab";
import { UsersTab } from "../_components/users-tab";

/**
 * 平台管理后台板块页（`/admin/<板块>`）：板块由侧栏菜单切换，菜单/顶栏/hero 文案同源于
 * `ADMIN_SECTIONS`；总览的「去处理」按板块 key 跳转。
 */
export default function AdminSectionPage() {
  const params = useParams<{ section: string }>();
  const { loading, isAdmin, isRoot } = useSession();
  const section = String(params?.section || "");
  const meta = ADMIN_SECTIONS.find((item) => item.key === section);

  /**
   * 深链直达也要按身份收口：非管理员不渲染任何管理板块（接口另有 403，
   * 但界面本身就不该出现）。会话未就绪时先不出内容，避免闪现后替换。
   */
  if (loading) return <Panel title="管理后台">正在确认身份…</Panel>;
  if (!isAdmin) {
    return (
      <Panel title="无访问权限">
        <EmptyState icon="🔒" text="管理后台仅管理员可访问，请从工作台返回首页。" />
      </Panel>
    );
  }

  if (!meta) {
    return (
      <Panel title="板块不存在">
        <EmptyState
          icon="🧭"
          text={`管理后台没有「${section}」这个板块，请从左侧菜单进入。`}
        />
      </Panel>
    );
  }

  // 板块自身声明的角色门槛（模型设置＝超级管理员）：不满足就不渲染内容，侧栏也没有这项
  if (!adminSectionAllowed(meta, isRoot)) {
    return (
      <Panel title="无访问权限">
        <EmptyState
          icon="🔒"
          text={`「${meta.name}」只开放给超级管理员，平台管理员账号看不到也改不了这些参数。`}
        />
      </Panel>
    );
  }

  return (
    <>
      <PageHero title={meta.name} desc={meta.desc} />

      {section === "overview" ? <OverviewTab /> : null}
      {section === "tenants" ? <TenantsTab /> : null}
      {section === "users" ? <UsersTab /> : null}
      {section === "orders" ? <OrdersTab /> : null}
      {section === "payments" ? <PaymentsTab /> : null}
      {section === "channels" ? <ChannelsTab /> : null}
      {section === "tokens" ? <TokensTab /> : null}
      {section === "models" ? <ModelsTab /> : null}
      {section === "logs" ? <LogsTab /> : null}
      {section === "settings" ? <SettingsTab /> : null}
    </>
  );
}
