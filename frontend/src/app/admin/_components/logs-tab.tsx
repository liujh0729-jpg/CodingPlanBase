"use client";

import { App, Button, Modal, Select, Space, Table } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { api } from "@/lib/api";
import {
  LOG_TYPE_LABEL,
  LOG_TYPE_VARIANT,
  cnyText,
  quotaText,
  quotaToCny,
  type LogRow,
} from "@/lib/gateway";
import { fmtTime } from "@/lib/datetime";
import { useQuotaPerUnit } from "@/lib/quota";
import { loadApi } from "./common";

type Page<T> = { list: T[]; total: number; page: number; pageSize: number };
type UserOption = { id: number; username: string; displayName: string };

/**
 * 全平台日志（管理员全量视图）：渠道 / 令牌被删后仍保留当时的归属快照，
 * 因此这里的记录可审计、可追溯，不随主数据变化。
 */
export function LogsTab() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<number | undefined>();
  const [users, setUsers] = useState<UserOption[]>([]);
  const perUnit = useQuotaPerUnit();

  useEffect(() => {
    void loadApi<{ list: UserOption[] }>("/users?page=1&pageSize=200").then((result) => {
      setUsers(result.data?.list ?? []);
    });
  }, []);

  const load = useCallback(
    async (nextPage = page, nextSize = pageSize, nextUser = userId) => {
      setLoading(true);
      try {
        const query = new URLSearchParams({
          page: String(nextPage),
          pageSize: String(nextSize),
          all: "1",
        });
        if (nextUser) query.set("userId", String(nextUser));
        const payload = await api<Page<LogRow>>(`/gateway/logs?${query.toString()}`);
        if (payload.code === 0 && payload.data) {
          setRows(payload.data.list ?? []);
          setTotal(payload.data.total ?? 0);
        } else {
          message.error(payload.message || "日志加载失败");
        }
      } finally {
        setLoading(false);
      }
    },
    [message, page, pageSize, userId],
  );

  useEffect(() => {
    void load();
    // 仅在首次与筛选/分页变化时取数，load 自身不进依赖（否则每次渲染都会重取）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, userId]);

  return (
    <>
      <Notice variant="info">
        日志类型：调用消耗 / 调用失败 / 充值 / 管理调整 / 退款。失败记录不计费，
        content 保留上游返回的错误摘要便于排障。
      </Notice>

      <Panel
        title="全平台用量日志"
        titleBadge={<span className="text-12 muted">共 {total.toLocaleString("zh-CN")} 条</span>}
        extra={
          <Space size={8}>
            <Select
              allowClear
              showSearch
              style={{ width: 240 }}
              placeholder="按用户筛选"
              optionFilterProp="label"
              value={userId}
              onChange={(value) => {
                setUserId(value);
                setPage(1);
              }}
              options={users.map((item) => ({
                value: item.id,
                label: `${item.displayName || item.username}（#${item.id}）`,
              }))}
            />
            <Button onClick={() => void load()}>刷新</Button>
          </Space>
        }
      >
        <div className="table-wrap">
          <Table<LogRow>
            rowKey="id"
            size="middle"
            loading={loading}
            dataSource={rows}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100],
              showTotal: (count) => `共 ${count.toLocaleString("zh-CN")} 条`,
              onChange: (nextPage, nextSize) => {
                setPage(nextPage);
                setPageSize(nextSize);
              },
            }}
            locale={{ emptyText: <EmptyState icon="📊" text="还没有调用记录" /> }}
            columns={[
              {
                title: "时间",
                width: 160,
                render: (_, row) => <span className="text-12">{fmtTime(row.createdAt)}</span>,
              },
              {
                title: "类型",
                width: 100,
                render: (_, row) => (
                  <Badge
                    label={LOG_TYPE_LABEL[row.type] ?? "其他"}
                    variant={LOG_TYPE_VARIANT[row.type] ?? "gray"}
                  />
                ),
              },
              {
                title: "用户",
                width: 140,
                render: (_, row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.username || `#${row.userId}`}</div>
                    <div className="text-12 muted">{row.group || "—"}</div>
                  </div>
                ),
              },
              {
                title: "租户",
                width: 140,
                render: (_, row) =>
                  row.tenantId ? (
                    <span className="text-12">
                      {row.tenantName || `租户 #${row.tenantId}`}
                    </span>
                  ) : (
                    <span className="text-12 muted">无租户</span>
                  ),
              },
              {
                title: "模型 / 令牌",
                width: 200,
                render: (_, row) => (
                  <div>
                    <div className="mono text-12">{row.modelName || "—"}</div>
                    <div className="text-12 muted">{row.tokenName || "—"}</div>
                  </div>
                ),
              },
              {
                title: "渠道",
                width: 150,
                render: (_, row) => (
                  <div>
                    <span className="text-12">{row.channelName || "—"}</span>
                    {row.channelId ? (
                      <div className="text-12 muted">#{row.channelId}</div>
                    ) : null}
                  </div>
                ),
              },
              {
                title: "tokens 入/出",
                width: 130,
                render: (_, row) => (
                  <span className="mono text-12">
                    {row.promptTokens} / {row.completionTokens}
                  </span>
                ),
              },
              {
                title: "消耗额度",
                width: 160,
                render: (_, row) => (
                  <div>
                    <span className="mono text-12">{quotaText(row.quota)}</span>
                    {perUnit > 0 ? (
                      <div className="text-12 muted">
                        ≈ {cnyText(quotaToCny(row.quota, perUnit))}
                      </div>
                    ) : null}
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
              {
                title: "操作",
                width: 90,
                render: (_, row) => <RowDetail row={row} />,
              },
            ]}
          />
        </div>
      </Panel>
    </>
  );
}

/** 详情弹窗：请求链路（IP / 请求号）与计费快照（倍率、上游成本）。 */
function RowDetail({ row }: { row: LogRow }) {
  const [open, setOpen] = useState(false);
  let other: Record<string, unknown> = {};
  try {
    other = JSON.parse(row.other || "{}") as Record<string, unknown>;
  } catch {
    other = {};
  }
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        详情
      </Button>
      {open ? (
        <Modal
          title={`日志详情 · #${row.id}`}
          open={open}
          onCancel={() => setOpen(false)}
          footer={null}
          width={560}
        >
          <div className="text-12" style={{ display: "grid", gap: 6 }}>
            <div>
              <span className="muted">内容：</span>
              {row.content || "—"}
            </div>
            <div>
              <span className="muted">请求号：</span>
              <span className="mono">{row.requestId || "—"}</span>
            </div>
            <div>
              <span className="muted">来源 IP：</span>
              <span className="mono">{row.ip || "—"}</span>
            </div>
            <div>
              <span className="muted">令牌 / 渠道快照：</span>
              <span className="mono">
                {row.tokenId ? `token#${row.tokenId}` : "—"} /
                {row.channelId ? `channel#${row.channelId}` : "—"}
              </span>
            </div>
            <div>
              <span className="muted">计费快照：</span>
              <span className="mono">{JSON.stringify(other)}</span>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
