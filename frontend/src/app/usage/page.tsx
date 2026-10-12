"use client";

import { Button, Table } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  EmptyState,
  Notice,
  PageHero,
  Panel,
  StatCard,
  StatGrid,
} from "@/components/ui/panel";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/datetime";
import {
  LOG_TYPE_LABEL,
  LOG_TYPE_VARIANT,
  TXN_TYPE_LABEL,
  quotaText,
  quotaToCny,
  cnyText,
  type LogRow,
  type QuotaTxnRow,
} from "@/lib/gateway";
import { useSession } from "@/lib/session";

type Wallet = {
  /** 记账上下文：额度余量、消耗与流水都是「当前租户给我的那一份」。 */
  tenantId: number | null;
  tenantName: string;
  quota: number;
  usedQuota: number;
  requestCount: number;
  quotaPerUnit: number;
  usedCny: number;
};

type Page<T> = { list: T[]; total: number; page: number; pageSize: number };

/**
 * 用量与额度：当前租户给这个账号的额度余量、调用日志与额度流水。
 * 切到别的租户，这里的数字与日志都换成那个租户的（顶栏切换租户后本页会重取）。
 * 令牌额度与账号额度分列展示，避免用户误判「为什么这次没扣令牌」。
 */
export default function UsagePage() {
  const [tab, setTab] = useState("logs");
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [logs, setLogs] = useState<Page<LogRow> | null>(null);
  const [txns, setTxns] = useState<Page<QuotaTxnRow> | null>(null);
  const [logPage, setLogPage] = useState(1);
  const [txnPage, setTxnPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [walletPayload, logPayload, txnPayload] = await Promise.all([
        api<Wallet>("/gateway/wallet"),
        api<Page<LogRow>>(`/gateway/logs?page=${logPage}&pageSize=20`),
        api<Page<QuotaTxnRow>>(`/gateway/wallet/txns?page=${txnPage}&pageSize=20`),
      ]);
      if (walletPayload.code === 0 && walletPayload.data) setWallet(walletPayload.data);
      if (logPayload.code === 0 && logPayload.data) setLogs(logPayload.data);
      if (txnPayload.code === 0 && txnPayload.data) setTxns(txnPayload.data);
    } finally {
      setLoading(false);
    }
  }, [logPage, txnPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const perUnit = wallet?.quotaPerUnit || 500000;

  return (
    <>
      <PageHero
        title="用量与额度"
        desc={
          wallet?.tenantId
            ? `记账租户：${wallet.tenantName}。额度按调用实时扣减，可用额度是这个租户划给你的份额；切到别的租户，额度与日志都换成那个租户的。`
            : "额度按调用实时扣减：这个账号还没有归属租户，先创建或加入租户才会有额度与记账处。"
        }
        tabs={[
          { key: "logs", label: "调用日志", count: logs?.total },
          { key: "txns", label: "额度流水", count: txns?.total },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />

      {!wallet || wallet.tenantId ? null : (
        <Notice variant="warn">
          <span style={{ marginTop: 0, display: "block" }}>
            当前没有记账租户：额度、令牌与调用日志都记在「账号在某个租户里」这份身份上，
            请用页面右上角的「创建或加入租户」先落到一个租户里。
          </span>
        </Notice>
      )}

      <StatGrid>
        <StatCard
          label="可用额度"
          value={wallet ? quotaText(wallet.quota) : "—"}
          hint={
            wallet?.tenantId
              ? `${wallet.tenantName}给的份额 · ≈ ${cnyText(quotaToCny(wallet.quota, perUnit))}`
              : "还没有租户给你额度"
          }
        />
        <StatCard
          label="累计消耗"
          value={wallet ? quotaText(wallet.usedQuota) : "—"}
          hint={wallet ? `在本租户内 · ≈ ${cnyText(wallet.usedCny)}` : undefined}
        />
        <StatCard label="累计调用次数" value={wallet ? wallet.requestCount : "—"} hint="在本租户内" />
        <StatCard
          label="额度换算"
          value={`1 元 = ${perUnit.toLocaleString("zh-CN")}`}
          hint="额度由所在租户从额度池划拨，租户余量不足时由租户管理员向平台订购"
        />
      </StatGrid>

      {tab === "logs" ? (
        <div style={{ marginTop: 16 }}>
          <Panel
            title="调用日志"
            titleBadge={<span className="text-12 muted">共 {(logs?.total ?? 0).toLocaleString("zh-CN")} 条</span>}
            extra={
              <Button size="small" onClick={() => void load()}>
                刷新
              </Button>
            }
          >
            <div className="table-wrap">
              <Table<LogRow>
                rowKey="id"
                size="middle"
                loading={loading}
                dataSource={logs?.list ?? []}
                pagination={{
                  current: logPage,
                  pageSize: 20,
                  total: logs?.total ?? 0,
                  showTotal: (count) => `共 ${count.toLocaleString("zh-CN")} 条`,
                  onChange: setLogPage,
                }}
                locale={{ emptyText: <EmptyState icon="📊" text="还没有调用记录" /> }}
                columns={[
                  {
                    title: "时间",
                    width: 170,
                    render: (_, row) => <span className="text-12 muted">{fmtTime(row.createdAt)}</span>,
                  },
                  {
                    title: "类型",
                    width: 110,
                    render: (_, row) => (
                      <Badge
                        label={LOG_TYPE_LABEL[row.type] ?? "其他"}
                        variant={LOG_TYPE_VARIANT[row.type] ?? "gray"}
                      />
                    ),
                  },
                  {
                    title: "模型 / 令牌",
                    render: (_, row) => (
                      <div>
                        <div className="mono text-12">{row.modelName || row.content || "—"}</div>
                        <div className="text-12 muted">{row.tokenName || "—"}</div>
                      </div>
                    ),
                  },
                  {
                    title: "tokens 入/出",
                    width: 140,
                    render: (_, row) => (
                      <span className="mono text-12">
                        {row.promptTokens}/{row.completionTokens}
                      </span>
                    ),
                  },
                  {
                    title: "消耗额度",
                    width: 180,
                    render: (_, row) => (
                      <div>
                        <span className="mono text-12">{quotaText(row.quota)}</span>
                        <div className="text-12 muted">
                          ≈ {cnyText(quotaToCny(row.quota, perUnit))}
                        </div>
                      </div>
                    ),
                  },
                  {
                    title: "耗时",
                    width: 120,
                    render: (_, row) => (
                      <span className="text-12">
                        {row.useTime}ms{row.isStream ? " · 流式" : ""}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
            <div className="text-12 muted" style={{ marginTop: 10 }}>
              调用失败不计费；若上游返回错误，日志里的 content 会保留错误摘要便于排查。
            </div>
          </Panel>
        </div>
      ) : (
        <div style={{ marginTop: 16 }}>
          <Panel
            title="额度流水"
            titleBadge={<span className="text-12 muted">共 {(txns?.total ?? 0).toLocaleString("zh-CN")} 条</span>}
          >
            <div className="table-wrap">
              <Table<QuotaTxnRow>
                rowKey="id"
                size="middle"
                loading={loading}
                dataSource={txns?.list ?? []}
                pagination={{
                  current: txnPage,
                  pageSize: 20,
                  total: txns?.total ?? 0,
                  showTotal: (count) => `共 ${count.toLocaleString("zh-CN")} 条`,
                  onChange: setTxnPage,
                }}
                locale={{ emptyText: <EmptyState icon="💰" text="还没有额度变动记录" /> }}
                columns={[
                  {
                    title: "时间",
                    width: 170,
                    render: (_, row) => <span className="text-12 muted">{fmtTime(row.createdAt)}</span>,
                  },
                  {
                    title: "类型",
                    width: 120,
                    render: (_, row) => <Badge label={TXN_TYPE_LABEL[row.type] || row.type} variant="blue" />,
                  },
                  {
                    title: "变动",
                    width: 160,
                    render: (_, row) => (
                      <span className="mono text-12" style={{ color: row.delta >= 0 ? "var(--success)" : "var(--danger)" }}>
                        {row.delta >= 0 ? "+" : ""}
                        {quotaText(row.delta)}
                      </span>
                    ),
                  },
                  {
                    title: "变动后可用",
                    width: 160,
                    render: (_, row) => <span className="mono text-12">{quotaText(row.quotaAfter)}</span>,
                  },
                  { title: "备注", render: (_, row) => <span className="text-12">{row.note || "—"}</span> },
                ]}
              />
            </div>
            <Notice variant="info">
              <span style={{ marginTop: 0, display: "block" }}>
                额度不足时：请联系本租户管理员在「本租户管理 → 用户管理 → 划拨额度」补充
                （池内不足则由租户管理员在「设置 → 订购管理」向平台订购额度包）；
                不属于任何租户的平台账号，由平台管理员在「账号管理 → 分配额度」补充。
              </span>
            </Notice>
          </Panel>
        </div>
      )}
    </>
  );
}
