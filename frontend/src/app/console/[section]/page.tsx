"use client";

import { useParams } from "next/navigation";
import { EmptyState, PageHero, Panel } from "@/components/ui/panel";
import { CONSOLE_SECTIONS } from "@/config/routes";
import { quotaText } from "@/lib/gateway";
import { useSession, MEMBER_ROLE_ADMIN } from "@/lib/session";
import { ConsoleLogsTab } from "../_components/console-logs-tab";
import { ConsoleUsersTab } from "../_components/console-users-tab";
import { useConsoleOverview } from "../_components/use-console-overview";

/**
 * 管理菜单板块页（`/console/<板块>`）：与平台侧 `/admin/<板块>` 同构——板块由侧栏菜单切换，
 * 菜单与 hero 文案同源于 `CONSOLE_SECTIONS`。租户管理员是权限更高的 User，
 * 前台菜单照旧，这里是租户这一层的管理菜单。
 */
export default function ConsoleSectionPage() {
  const params = useParams<{ section: string }>();
  const { me, loading, isTenantAdmin, isAdmin } = useSession();
  const section = String(params?.section || "");
  const meta = CONSOLE_SECTIONS.find((item) => item.key === section);
  const { overview, reload } = useConsoleOverview(isTenantAdmin, me?.tenantId ?? null);

  // 深链直达也要按身份收口：非本租户管理员不渲染任何板块（接口另有 20002，界面本来就不该出现）
  if (loading) return <Panel title="管理菜单">正在确认身份…</Panel>;
  if (!isTenantAdmin) {
    // 租户内权限是「这个人在这家租户里」的角色：在别的租户当管理员，切过去才算
    const adminElsewhere = (me?.tenants ?? []).some(
      (item) => item.memberRole === MEMBER_ROLE_ADMIN && item.id !== me?.tenantId,
    );
    return (
      <Panel title="无访问权限">
        <EmptyState
          icon="🔒"
          text={
            isAdmin
              ? "管理菜单只给租户管理员使用；平台侧请从顶栏「管理后台」进入。"
              : adminElsewhere
                ? "你在当前租户只是成员。顶栏切到你当管理员的那个租户，管理菜单就在那边。"
                : "管理菜单仅该租户的管理员可访问，普通用户请在「工作台 / 用量与额度」查看自己的额度。"
          }
        />
      </Panel>
    );
  }

  if (!meta) {
    return (
      <Panel title="板块不存在">
        <EmptyState
          icon="🧭"
          text={`管理菜单没有「${section}」这个板块，请从左侧菜单进入。`}
        />
      </Panel>
    );
  }

  return (
    <>
      <PageHero
        title={meta.name}
        desc={
          overview
            ? `${overview.name}（编码 ${overview.code}）· 额度池余量 ${quotaText(
                overview.quotaPool,
              )} quota · ${overview.memberCount} 个用户（其中 ${overview.adminCount} 个管理员）。${meta.desc}`
            : meta.desc
        }
      />

      <div style={{ marginTop: 16 }}>
        {section === "users" ? (
          <ConsoleUsersTab overview={overview} onChanged={() => void reload()} />
        ) : null}
        {section === "logs" ? <ConsoleLogsTab /> : null}
      </div>
    </>
  );
}
