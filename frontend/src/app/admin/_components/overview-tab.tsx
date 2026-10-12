"use client";

import { Button, Table } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { cnyText, quotaText, type ChannelRow } from "@/lib/gateway";
import { useSession } from "@/lib/session";
import { fmtTime, loadApi, type LoadResult } from "./common";

type Stats = {
  days: number;
  requestCount: number;
  quota: number;
  cny: number;
  errorCount: number;
  userCount: number;
  byModel: { model: string; requests: number; quota: number }[];
};

type SetupStatus = {
  hasKey: boolean;
  modelCount: number;
  revision: string;
  syncedAt: string | null;
  sourceBaseUrl: string;
};

type PaySummary = {
  pendingCount: number;
  paidCount: number;
};

/** 总览：网关运行指标 + 待办事项（缺配置 / 被自动禁用的渠道 / 挂着未付的订单）。 */
export function OverviewTab() {
  const { isRoot } = useSession();
  const [stats, setStats] = useState<Stats | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  // null＝这个接口没取到（未知），空数组＝取到了但确实没有渠道，两者不能混成一个提示
  const [channels, setChannels] = useState<ChannelRow[] | null>(null);
  const [modelCount, setModelCount] = useState<number | null>(null);
  const [pay, setPay] = useState<PaySummary | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    // 分项取数：loadApi 不抛错，某一块失败只影响这一块，不会把整页钉在 loading 上
    const [statsRes, setupRes, channelsRes, modelsRes, payRes] = await Promise.all([
      loadApi<Stats>("/gateway/stats?days=7"),
      loadApi<SetupStatus>("/gateway/setup/status"),
      loadApi<ChannelRow[]>("/gateway/channels"),
      loadApi<{ models: unknown[] }>("/gateway/models"),
      loadApi<PaySummary>("/admin/pay/summary?days=30"),
    ]);
    if (statsRes.data) setStats(statsRes.data);
    if (setupRes.data) setSetup(setupRes.data);
    if (channelsRes.data) setChannels(channelsRes.data);
    if (modelsRes.data) setModelCount(modelsRes.data.models.length);
    if (payRes.data) setPay(payRes.data);
    const sources: [string, LoadResult<unknown>][] = [
      ["运行指标", statsRes],
      ["AIPDD 接入状态", setupRes],
      ["渠道", channelsRes],
      ["模型目录", modelsRes],
      ["收款概览", payRes],
    ];
    setFailed(sources.filter(([, result]) => !result.data).map(([name]) => name));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const channelList = channels ?? [];
  const banned = channelList.filter((row) => row.status === 3);
  const enabledChannels = channelList.filter((row) => row.status === 1);

  return (
    <>
      <StatGrid>
        <StatCard label={`近 ${stats?.days ?? 7} 天调用`} value={stats?.requestCount ?? "—"} />
        <StatCard
          label="消耗额度"
          value={stats ? quotaText(stats.quota) : "—"}
          hint={stats ? `≈ ${cnyText(stats.cny)}` : undefined}
        />
        <StatCard
          label="失败请求"
          value={stats?.errorCount ?? "—"}
          hint={
            stats?.errorCount ? (
              <Link href="/admin/logs">见「全平台日志」的调用失败</Link>
            ) : (
              "无失败"
            )
          }
        />
        <StatCard label="全平台账号" value={stats?.userCount ?? "—"} hint="平台直属账号 + 各租户 User" />
        <StatCard label="可路由模型" value={modelCount ?? "—"} hint="价目表条目" />
        <StatCard
          label="启用渠道"
          value={channels ? `${enabledChannels.length}/${channelList.length}` : "—"}
          hint={banned.length ? `含 ${banned.length} 个自动禁用` : "选路池健康"}
        />
      </StatGrid>

      <div style={{ marginTop: 16 }}>
        <Panel title="待办与提示">
          {failed.length ? (
            <Notice variant="warn">
              {`有 ${failed.length} 块数据没取到：${failed.join("、")}。各块分开取，其余指标照常显示。`}
              <Button size="small" style={{ marginLeft: 6 }} onClick={() => void load()}>
                重新加载
              </Button>
            </Notice>
          ) : null}
          {setup && !setup.hasKey ? (
            <Notice variant="warn">
              尚未配置上游 AIPDD API Key，模型目录为空。
              {isRoot ? (
                <Link href="/admin/settings" style={{ marginLeft: 6 }}>
                  前往「模型设置 → AIPDD 接入」
                </Link>
              ) : (
                <span style={{ marginLeft: 6 }}>
                  「模型设置」板块只开放给超级管理员，请联系超级管理员完成接入。
                </span>
              )}
            </Notice>
          ) : null}
          {setup?.hasKey && channels && !enabledChannels.length ? (
            <Notice variant="error">
              没有任何启用中的渠道，网关无法转发请求。
              <Link href="/admin/channels" style={{ marginLeft: 6 }}>
                前往「渠道管理」
              </Link>
            </Notice>
          ) : null}
          {banned.length ? (
            <Notice variant="warn">
              {`${banned.length} 个渠道因测试失败被自动禁用：${banned
                .map((row) => row.name)
                .join("、")}。排查后可在渠道管理手动启用。`}
              <Link href="/admin/channels" style={{ marginLeft: 6 }}>
                前往处理
              </Link>
            </Notice>
          ) : null}
          {pay?.pendingCount ? (
            <Notice variant="warn">
              {`${pay.pendingCount} 笔订单还在等支付结果：这类单子不会发放权益，需要核对是渠道未回调还是用户放弃了支付。`}
              <Link href="/admin/orders" style={{ marginLeft: 6 }}>
                前往「订单管理」
              </Link>
            </Notice>
          ) : null}
          {setup?.hasKey && channels && enabledChannels.length && !banned.length ? (
            <Notice variant="success">
              网关配置就绪：托管目录
              {setup.revision ? ` ${setup.revision}` : ""}，
              {modelCount ?? 0} 个模型可路由，{enabledChannels.length} 个渠道在选路池中。
            </Notice>
          ) : null}
        </Panel>
      </div>

      <div style={{ marginTop: 16 }}>
        <Panel
          title="模型消耗 Top 20"
          titleBadge={<span className="text-12 muted">按近 {stats?.days ?? 7} 天消耗额度排序</span>}
        >
          <div className="table-wrap">
            <Table<Stats["byModel"][number]>
              rowKey="model"
              size="middle"
              loading={loading}
              dataSource={stats?.byModel ?? []}
              pagination={false}
              locale={{ emptyText: <EmptyState icon="📈" text="暂无消耗数据" /> }}
              columns={[
                { title: "模型", render: (_, row) => row.model || "—" },
                { title: "调用次数", width: 130, render: (_, row) => row.requests },
                {
                  title: "消耗额度",
                  width: 160,
                  render: (_, row) => <span className="mono">{quotaText(row.quota)}</span>,
                },
              ]}
            />
          </div>
        </Panel>
      </div>

      {setup?.sourceBaseUrl ? (
        <div style={{ marginTop: 16 }}>
          <Panel title="目录同步" titleBadge={<Badge label="托管渠道" variant="blue" />}>
            <div className="text-12 muted">
              上游 <span className="mono">{setup.sourceBaseUrl}</span>
              {setup.syncedAt ? ` · 最近同步 ${fmtTime(setup.syncedAt)}` : " · 尚未同步"}
            </div>
          </Panel>
        </div>
      ) : null}
    </>
  );
}
