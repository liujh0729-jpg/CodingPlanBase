"use client";

import { App, Button, Input, Modal, Select, Table } from "antd";
import { useCallback, useEffect, useState } from "react";
import { tablePagination } from "@/app/admin/_components/common";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/datetime";
import {
  LOG_TYPE_LABEL,
  LOG_TYPE_VARIANT,
  cnyText,
  quotaText,
  quotaToCny,
  type ConsoleLogRow,
} from "@/lib/gateway";
import { useQuotaPerUnit } from "@/lib/quota";

type LogPage = {
  list: ConsoleLogRow[];
  total: number;
  page: number;
  pageSize: number;
  quota: number;
};

/** 类型筛选只放租户看得懂、也确实在自己账上的四类；裸枚举不在界面上出现。 */
const TYPE_OPTIONS = [
  { value: "2", label: LOG_TYPE_LABEL[2] },
  { value: "5", label: LOG_TYPE_LABEL[5] },
  { value: "1", label: LOG_TYPE_LABEL[1] },
  { value: "3", label: LOG_TYPE_LABEL[3] },
];

/**
 * 本租户管理 · 模型使用记录：本租户全部 User（含租户管理员自己）的调用与额度流水。
 * 归属租户由会话推出，跨租户的记录一条也查不到；渠道归属与批发价 / 毛利在接口层就被剥掉，
 * 上游是平台侧的事，租户只看自己用了多少、花了多少。
 */
export function ConsoleLogsTab() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<LogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [type, setType] = useState("");
  const perUnit = useQuotaPerUnit();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (keyword.trim()) query.set("keyword", keyword.trim());
      if (type) query.set("type", type);
      const payload = await api<LogPage>(`/console/logs?${query.toString()}`);
      if (payload.code === 0 && payload.data) setRows(payload.data);
      else message.error(payload.message || "使用记录读取失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, type, message]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <Notice variant="info">
        记录口径：调用消耗按 token 计费折算成额度（额度 ÷ 换算参数＝元），失败记录不计费；
        某个 User 的余量与划拨流水在「用户管理」里看。
      </Notice>

      <Panel
        title="模型使用记录"
        titleBadge={
          <span className="text-12 muted">
            共 {(rows?.total ?? 0).toLocaleString("zh-CN")} 条 · 合计消耗{" "}
            {quotaText(rows?.quota ?? 0)} quota
            {perUnit > 0 ? (
              <>（≈ {cnyText(quotaToCny(rows?.quota ?? 0, perUnit))}）</>
            ) : null}
          </span>
        }
        extra={
          <Button size="small" onClick={() => void load()}>
            刷新
          </Button>
        }
      >
        <div className="form-2col" style={{ marginBottom: 12 }}>
          <Input.Search
            allowClear
            placeholder="按模型 / 令牌 / 用户名检索"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={() => setPage(1)}
            style={{ maxWidth: 320 }}
          />
          <Select
            allowClear
            placeholder="全部类型"
            value={type || undefined}
            options={TYPE_OPTIONS}
            onChange={(value) => {
              setType(value || "");
              setPage(1);
            }}
            style={{ minWidth: 160 }}
          />
        </div>

        <div className="table-wrap">
          <Table<ConsoleLogRow>
            rowKey="id"
            size="middle"
            loading={loading}
            dataSource={rows?.list ?? []}
            pagination={{
              ...tablePagination,
              current: page,
              pageSize,
              total: rows?.total ?? 0,
              showSizeChanger: true,
              pageSizeOptions: [20, 50, 100],
              showTotal: (count) => `共 ${count.toLocaleString("zh-CN")} 条`,
              onChange: (nextPage, nextSize) => {
                setPage(nextPage);
                setPageSize(nextSize);
              },
            }}
            locale={{ emptyText: <EmptyState icon="📊" text="本租户还没有调用记录" /> }}
            columns={[
              {
                title: "时间",
                width: 160,
                render: (_, row) => (
                  <span className="text-12">{fmtTime(row.createdAt)}</span>
                ),
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
                title: "使用方",
                width: 150,
                render: (_, row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {row.username || `#${row.userId}`}
                    </div>
                    <div className="text-12 muted">{row.group || "—"}</div>
                  </div>
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
                width: 150,
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
                width: 110,
                render: (_, row) => (
                  <span className="text-12">
                    {row.useTime}ms{row.isStream ? " · 流式" : ""}
                  </span>
                ),
              },
              {
                title: "操作",
                width: 80,
                render: (_, row) => <RowNote row={row} />,
              },
            ]}
          />
        </div>
      </Panel>
    </>
  );
}

/**
 * 详情弹窗只讲租户能自己核对的四件事：说明、请求号、来源 IP、分组。
 * 不与平台侧「全平台日志」共用一个组件：那边的渠道快照与计费倍率（含批发价、毛利）不给租户看。
 */
function RowNote({ row }: { row: ConsoleLogRow }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="small" onClick={() => setOpen(true)}>
        详情
      </Button>
      {open ? (
        <Modal
          title={`使用记录 · #${row.id}`}
          open={open}
          onCancel={() => setOpen(false)}
          footer={null}
          width={520}
        >
          <div className="text-12" style={{ display: "grid", gap: 6 }}>
            <div>
              <span className="muted">说明：</span>
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
              <span className="muted">分组：</span>
              {row.group || "—"}
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
