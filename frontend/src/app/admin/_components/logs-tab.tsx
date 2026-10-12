"use client";

import {
  App,
  Button,
  Modal,
  Select,
  Space,
  Table,
  Input,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  ColumnSwitch,
  EmptyState,
  Notice,
  Panel,
} from "@/components/ui/panel";
import { api } from "@/lib/api";
import {
  LOG_TYPE_LABEL,
  LOG_TYPE_VARIANT,
  TXN_TYPE_LABEL,
  cnyText,
  quotaText,
  quotaToCny,
  type LogRow,
  type QuotaTxnRow,
  type TenantOption,
} from "@/lib/gateway";
import { fmtTime } from "@/lib/datetime";
import { useQuotaPerUnit } from "@/lib/quota";
import { loadApi, tablePagination } from "./common";

type Page<T> = {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
  /** 当页筛选条件下的合计：调用日志看消耗额度，额度流水看净变动。 */
  quota?: number;
  delta?: number;
};

type UserOption = { id: number; username: string; displayName: string };

type TxnRow = QuotaTxnRow & {
  username: string;
  tenantName: string;
  operatorName: string;
};

/** 日志类型：全平台视图里平台会写的都列出来，界面不出现裸枚举。 */
const LOG_TYPE_OPTIONS = [1, 2, 3, 4, 5, 6].map((value) => ({
  value,
  label: LOG_TYPE_LABEL[value],
}));

const TXN_TYPE_OPTIONS = Object.entries(TXN_TYPE_LABEL).map(([value, label]) => ({
  value,
  label,
}));

/** 「最近 N 天」代替日期区间：前端没有日期库，天数换算成时间戳是全站口径。 */
const DAYS_OPTIONS = [
  { value: 1, label: "最近 1 天" },
  { value: 7, label: "最近 7 天" },
  { value: 30, label: "最近 30 天" },
  { value: 90, label: "最近 90 天" },
];

/**
 * 全平台日志（管理员全量视图）：调用日志与额度流水是同一件事的两面——
 * 调用日志记「这次调用花了多少、走的哪个渠道」，额度流水记「谁的额度被谁动了多少」。
 * 渠道 / 令牌被删后日志仍保留当时的归属快照，因此这里的记录可审计、可追溯。
 */
export function LogsTab() {
  const [view, setView] = useState("logs");
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [channels, setChannels] = useState<{ id: number; name: string }[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const perUnit = useQuotaPerUnit();

  // 筛选项一次取全：租户 / 渠道 / 模型都是管理侧的完整清单，不存在分页截断
  useEffect(() => {
    void api<TenantOption[]>("/admin/tenants/options").then((payload) => {
      if (payload.code === 0) setTenants(payload.data ?? []);
    });
    void api<{ id: number; name: string }[]>("/gateway/channels").then(
      (payload) => {
        if (payload.code === 0) setChannels(payload.data ?? []);
      },
    );
    void api<{ models: { modelName: string }[] }>("/gateway/models").then(
      (payload) => {
        if (payload.code === 0) {
          setModels(
            Array.from(
              new Set((payload.data?.models ?? []).map((row) => row.modelName)),
            ).sort(),
          );
        }
      },
    );
  }, []);

  const tenantOptions = [
    { value: "none", label: "无租户（平台直属账号）" },
    ...tenants.map((item) => ({ value: String(item.id), label: item.name })),
  ];

  return (
    <>
      <Notice variant="info">
        日志类型：调用消耗 / 调用失败 / 充值 / 管理调整 / 退款。失败记录不计费，
        content 保留上游返回的错误摘要便于排障。额度流水记的是成员身份上的额度变动
        （平台或租户给某人划拨、回收、充值到账），与这里的调用消耗分列两头账。
      </Notice>

      <Panel
        title="全平台日志"
        titleBadge={
          <span className="text-12 muted">
            {view === "logs" ? "按调用与归属核对" : "按额度变动核对"}
          </span>
        }
      >
        <ColumnSwitch
          value={view}
          onChange={setView}
          options={[
            { value: "logs", label: "调用日志" },
            { value: "txns", label: "额度流水" },
          ]}
        />
        {view === "logs" ? (
          <LogList
            perUnit={perUnit}
            tenantOptions={tenantOptions}
            channels={channels}
            models={models}
          />
        ) : (
          <TxnList tenantOptions={tenantOptions} perUnit={perUnit} />
        )}
      </Panel>
    </>
  );
}

/** 调用日志：平台全量视图，可按账号 / 租户 / 类型 / 模型 / 渠道 / 时间筛。 */
function LogList({
  perUnit,
  tenantOptions,
  channels,
  models,
}: {
  perUnit: number;
  tenantOptions: { value: string; label: string }[];
  channels: { id: number; name: string }[];
  models: string[];
}) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [quotaSum, setQuotaSum] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<number | undefined>();
  const [tenantId, setTenantId] = useState<string | undefined>();
  const [type, setType] = useState<number | undefined>();
  const [modelName, setModelName] = useState<string | undefined>();
  const [channelId, setChannelId] = useState<string | undefined>();
  const [days, setDays] = useState<number | undefined>();
  const [keyword, setKeyword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        all: "1",
      });
      if (userId) query.set("userId", String(userId));
      if (tenantId) query.set("tenantId", tenantId);
      if (type) query.set("type", String(type));
      if (modelName) query.set("modelName", modelName);
      if (channelId) query.set("channelId", channelId);
      if (days) query.set("days", String(days));
      if (keyword.trim()) query.set("keyword", keyword.trim());
      const payload = await api<Page<LogRow>>(`/gateway/logs?${query.toString()}`);
      if (payload.code === 0 && payload.data) {
        setRows(payload.data.list ?? []);
        setTotal(payload.data.total ?? 0);
        setQuotaSum(payload.data.quota ?? 0);
      } else {
        message.error(payload.message || "日志加载失败");
      }
    } finally {
      setLoading(false);
    }
  }, [
    message,
    page,
    pageSize,
    userId,
    tenantId,
    type,
    modelName,
    channelId,
    days,
    keyword,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  // 任一筛选变化都回到第一页，否则停在上次的页码上会看到空表
  const reset = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <>
      <Space wrap size={8} style={{ marginBottom: 12 }}>
        <UserSearchSelect
          value={userId}
          onChange={(value) => reset(() => setUserId(value))}
        />
        <Select
          allowClear
          placeholder="全部租户"
          style={{ width: 200 }}
          value={tenantId}
          options={tenantOptions}
          onChange={(value) => reset(() => setTenantId(value))}
        />
        <Select
          allowClear
          placeholder="全部类型"
          style={{ width: 140 }}
          value={type}
          options={LOG_TYPE_OPTIONS}
          onChange={(value) => reset(() => setType(value))}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="全部模型"
          style={{ width: 200 }}
          value={modelName}
          options={models.map((name) => ({ value: name, label: name }))}
          onChange={(value) => reset(() => setModelName(value))}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="全部渠道"
          style={{ width: 200 }}
          value={channelId}
          options={channels.map((item) => ({
            value: String(item.id),
            label: `${item.name}（#${item.id}）`,
          }))}
          onChange={(value) => reset(() => setChannelId(value))}
        />
        <Select
          allowClear
          placeholder="全部时间"
          style={{ width: 140 }}
          value={days}
          options={DAYS_OPTIONS}
          onChange={(value) => reset(() => setDays(value))}
        />
        <Input.Search
          allowClear
          placeholder="按模型 / 令牌 / 用户名检索"
          style={{ width: 240 }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onSearch={() => setPage(1)}
          enterButton
        />
        <Button onClick={() => void load()}>刷新</Button>
      </Space>

      <div className="table-wrap">
        <Table<LogRow>
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={rows}
          pagination={{
            ...tablePagination,
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
          locale={{ emptyText: <EmptyState icon="📊" text="没有符合条件的调用记录" /> }}
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
      <div className="text-12 muted" style={{ marginTop: 10 }}>
        当前筛选条件下合计消耗 {quotaText(quotaSum)} quota
        {perUnit > 0 ? <>（≈ {cnyText(quotaToCny(quotaSum, perUnit))}）</> : null}。
      </div>
    </>
  );
}

/** 额度流水台账：全平台每一笔成员额度变动，带用户、租户与操作人。 */
function TxnList({
  tenantOptions,
  perUnit,
}: {
  tenantOptions: { value: string; label: string }[];
  perUnit: number;
}) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<TxnRow[]>([]);
  const [total, setTotal] = useState(0);
  const [deltaSum, setDeltaSum] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<number | undefined>();
  const [tenantId, setTenantId] = useState<string | undefined>();
  const [type, setType] = useState<string | undefined>();
  const [days, setDays] = useState<number | undefined>();
  const [keyword, setKeyword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        all: "1",
      });
      if (userId) query.set("userId", String(userId));
      if (tenantId) query.set("tenantId", tenantId);
      if (type) query.set("type", type);
      if (days) query.set("days", String(days));
      if (keyword.trim()) query.set("keyword", keyword.trim());
      const payload = await api<Page<TxnRow>>(
        `/gateway/wallet/txns?${query.toString()}`,
      );
      if (payload.code === 0 && payload.data) {
        setRows(payload.data.list ?? []);
        setTotal(payload.data.total ?? 0);
        setDeltaSum(payload.data.delta ?? 0);
      } else {
        message.error(payload.message || "额度流水加载失败");
      }
    } finally {
      setLoading(false);
    }
  }, [message, page, pageSize, userId, tenantId, type, days, keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  const reset = (apply: () => void) => {
    apply();
    setPage(1);
  };

  return (
    <>
      <Space wrap size={8} style={{ marginBottom: 12 }}>
        <UserSearchSelect
          value={userId}
          onChange={(value) => reset(() => setUserId(value))}
        />
        <Select
          allowClear
          placeholder="全部归属"
          style={{ width: 200 }}
          value={tenantId}
          options={tenantOptions}
          onChange={(value) => reset(() => setTenantId(value))}
        />
        <Select
          allowClear
          placeholder="全部类型"
          style={{ width: 160 }}
          value={type}
          options={TXN_TYPE_OPTIONS}
          onChange={(value) => reset(() => setType(value))}
        />
        <Select
          allowClear
          placeholder="全部时间"
          style={{ width: 140 }}
          value={days}
          options={DAYS_OPTIONS}
          onChange={(value) => reset(() => setDays(value))}
        />
        <Input.Search
          allowClear
          placeholder="按用户名 / 备注检索"
          style={{ width: 240 }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onSearch={() => setPage(1)}
          enterButton
        />
        <Button onClick={() => void load()}>刷新</Button>
      </Space>

      <div className="table-wrap">
        <Table<TxnRow>
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={rows}
          pagination={{
            ...tablePagination,
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
          locale={{ emptyText: <EmptyState icon="🧾" text="没有符合条件的额度流水" /> }}
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
              width: 120,
              render: (_, row) => (
                <Badge label={TXN_TYPE_LABEL[row.type] || row.type} variant="blue" />
              ),
            },
            {
              title: "用户",
              width: 150,
              render: (_, row) => (
                <div>
                  <div style={{ fontWeight: 600 }}>{row.username || `#${row.userId}`}</div>
                  <div className="text-12 muted">#{row.userId}</div>
                </div>
              ),
            },
            {
              title: "记账租户",
              width: 150,
              render: (_, row) =>
                row.tenantId ? (
                  <span className="text-12">{row.tenantName || `租户 #${row.tenantId}`}</span>
                ) : (
                  <span className="text-12 muted">无租户</span>
                ),
            },
            {
              title: "变动",
              width: 150,
              render: (_, row) => (
                <div>
                  <span
                    className="mono text-12"
                    style={{
                      color: row.delta >= 0 ? "var(--success)" : "var(--danger)",
                    }}
                  >
                    {row.delta >= 0 ? "+" : ""}
                    {quotaText(row.delta)}
                  </span>
                  {perUnit > 0 ? (
                    <div className="text-12 muted">
                      ≈ {cnyText(quotaToCny(Math.abs(row.delta), perUnit))}
                    </div>
                  ) : null}
                </div>
              ),
            },
            {
              title: "变动后可用",
              width: 140,
              render: (_, row) => (
                <span className="mono text-12">{quotaText(row.quotaAfter)}</span>
              ),
            },
            {
              title: "操作人",
              width: 140,
              render: (_, row) => (
                <span className="text-12">
                  {row.operatorId ? row.operatorName || `#${row.operatorId}` : "系统"}
                </span>
              ),
            },
            {
              title: "备注",
              render: (_, row) => <span className="text-12">{row.note || "—"}</span>,
            },
          ]}
        />
      </div>
      <div className="text-12 muted" style={{ marginTop: 10 }}>
        当前筛选条件下净变动 {quotaText(deltaSum)} quota
        {perUnit > 0 ? <>（≈ {cnyText(quotaToCny(Math.abs(deltaSum), perUnit))}）</> : null}；
        净变动为正说明这段时间发出去的额度多于回收的。
      </div>
    </>
  );
}

/**
 * 账号筛选走服务端检索：下拉只装当次检索命中的前 30 个账号，
 * 不再一次性拉 200 条（全站账号多于 200 时旧写法会把筛不出的账号静默截断）。
 */
function UserSearchSelect({
  value,
  onChange,
}: {
  value?: number;
  onChange: (value?: number) => void;
}) {
  const [options, setOptions] = useState<UserOption[]>([]);
  const [fetching, setFetching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const search = useCallback((keyword: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setFetching(true);
      try {
        const query = new URLSearchParams({ page: "1", pageSize: "30" });
        if (keyword.trim()) query.set("keyword", keyword.trim());
        const result = await loadApi<{ list: UserOption[] }>(
          `/users?${query.toString()}`,
        );
        setOptions(result.data?.list ?? []);
      } finally {
        setFetching(false);
      }
    }, 250);
  }, []);

  useEffect(() => {
    search("");
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [search]);

  return (
    <Select
      allowClear
      showSearch
      style={{ width: 240 }}
      placeholder="按用户名检索账号"
      filterOption={false}
      loading={fetching}
      value={value}
      onSearch={search}
      onChange={(next) => onChange(next)}
      notFoundContent={fetching ? "检索中…" : "没有匹配的账号"}
      options={options.map((item) => ({
        value: item.id,
        label: `${item.displayName || item.username}（#${item.id}）`,
      }))}
    />
  );
}

/** `other` 里的计费快照键：界面按中文标签逐项列出，不甩原始 JSON。 */
const OTHER_LABEL: Record<string, string> = {
  retail_cny: "零售折算",
  wholesale_cny: "上游批发价",
  profit_cny: "毛利",
  quota_per_unit: "换算参数（1 元对应额度）",
};

function otherEntries(other: string): { label: string; value: string }[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(other || "{}") as Record<string, unknown>;
  } catch {
    return [];
  }
  return Object.entries(parsed).map(([key, value]) => {
    const label = OTHER_LABEL[key] ?? key;
    const amount = cnyText(Number(value));
    const isCny = key.endsWith("_cny") && amount !== "";
    return {
      label,
      value: isCny
        ? amount
        : typeof value === "number"
          ? value.toLocaleString("zh-CN")
          : String(value ?? "—"),
    };
  });
}

/** 详情弹窗：请求链路（IP / 请求号）与计费快照（零售价、上游批发价、毛利）。 */
function RowDetail({ row }: { row: LogRow }) {
  const [open, setOpen] = useState(false);
  const entries = otherEntries(row.other);
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
            {entries.length ? (
              <div>
                <div className="muted" style={{ marginBottom: 4 }}>
                  计费快照（批发价与毛利属平台侧，不下沉到租户视图）：
                </div>
                <div style={{ display: "grid", gap: 4, paddingLeft: 12 }}>
                  {entries.map((item) => (
                    <div key={item.label}>
                      <span className="muted">{item.label}：</span>
                      <span className="mono">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <span className="muted">计费快照：</span>
                这一笔不计费
              </div>
            )}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
