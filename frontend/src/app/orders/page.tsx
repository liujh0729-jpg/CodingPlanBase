"use client";

import { useState } from "react";
import { EmptyState, PageHero, Panel } from "@/components/ui/panel";
import { quotaText } from "@/lib/gateway";
import { useSession } from "@/lib/session";
import { ConsoleOrdersTab } from "../console/_components/console-orders-tab";
import { ConsoleStoreTab } from "../console/_components/console-store-tab";
import { useConsoleOverview } from "../console/_components/use-console-overview";

/**
 * 订购管理（前台「设置」下）：订购的主体是租户，能看到什么由两条身份轴决定——
 * 当前租户的管理员＝本租户向平台订购（软件订购 + 自家单据）；
 * 平台管理员 / 超管＝同一份单据的平台视角（全平台订购记录）。
 * 两条轴互不排斥：同一个账号既可以是平台管理员、又是某租户的管理员，
 * 那他就同时看到「为自家租户下单」与「全平台记录」。
 * 租户下的普通用户没有这两条轴，菜单里本来就不出现这一项。
 */
export default function OrdersPage() {
  const { me, loading, canOrder, isTenantAdmin, isAdmin } = useSession();
  const [tab, setTab] = useState("store");
  // 概览是租户自己的账（额度池 / 权益）：没有当前租户时不取这个接口
  const { overview, overviewError, reload } = useConsoleOverview(
    isTenantAdmin,
    me?.tenantId ?? null,
  );
  // 平台视角的订购记录是全平台单据；租户管理员的「自家单据」走 /console/orders
  const platformView = isAdmin;

  if (loading) return <Panel title="订购管理">正在确认身份…</Panel>;
  if (!canOrder) {
    return (
      <Panel title="无访问权限">
        <EmptyState
          icon="🔒"
          text="订购管理是租户对平台的交易，普通用户不参与；你的额度由本租户管理员在「本租户管理 → 用户管理」划拨。"
        />
      </Panel>
    );
  }

  const tabs = [
    ...(isTenantAdmin ? [{ key: "store", label: "软件订购" }] : []),
    { key: "orders", label: platformView ? "订购记录（全平台）" : "订购记录" },
  ];
  const activeTab = tabs.some((item) => item.key === tab) ? tab : tabs[0].key;

  return (
    <>
      <PageHero
        title="订购管理"
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setTab}
        desc={
          activeTab === "orders" && platformView
            ? "订购的主体是租户：每一单都是某个租户（下单人为其租户管理员）向平台购买软件能力。这里核对全平台的租户订购记录；商品目录、开关与退款在「管理后台 → 支付管理 / 订单管理」。"
            : overview
              ? `${overview.name}（编码 ${overview.code}）· 额度池余量 ${quotaText(
                  overview.quotaPool,
                )} quota · ${overview.entitlements.length} 项已生效权益。订购以你自己的平台身份发起，到账额度进本租户额度池。`
              : "向平台订购软件能力与额度包：选购下单、发起支付，并查看本租户的全部订购单据。"
        }
      />

      <div style={{ marginTop: 16 }}>
        {activeTab === "store" ? (
          <ConsoleStoreTab
            overview={overview}
            overviewError={overviewError}
            onSettled={() => void reload()}
          />
        ) : null}
        {activeTab === "orders" ? (
          <ConsoleOrdersTab
            showTenant={platformView}
            onSettled={() => void reload()}
          />
        ) : null}
      </div>
    </>
  );
}
