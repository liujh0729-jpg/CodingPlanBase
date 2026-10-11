"use client";

import { App, Button, Input, Modal, Select, Space, Table } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { api, postJson } from "@/lib/api";
import { fmtTime } from "@/lib/datetime";
import {
  ENTITLEMENT_KIND_LABEL,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_VARIANT,
  PRODUCT_TYPE_LABEL,
  REFUND_STATUS_LABEL,
  ROLE_LABEL,
  fenText,
  quotaText,
  type AdminOrderRow,
  type OrderDetail,
  type RefundPreview,
  type TenantOption,
} from "@/lib/gateway";
import { tablePagination } from "./common";

type Page<T> = { list: T[]; total: number; page: number; pageSize: number };

const STATUS_OPTIONS = Object.entries(ORDER_STATUS_LABEL).map(
  ([value, label]) => ({ value, label }),
);

const TYPE_OPTIONS = Object.entries(PRODUCT_TYPE_LABEL).map(
  ([value, label]) => ({ value, label }),
);

/**
 * 订单管理（全平台）：租户向平台购买软件产品与服务的订单——订阅 / 功能买断 / 额度包。
 * 金额一律按人民币展示（订单以「分」存储）；退款额由后端按已服务天数试算，管理员可下调。
 */
export function OrdersTab() {
  const { message } = App.useApp();
  const [rows, setRows] = useState<AdminOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<string | undefined>();
  const [productType, setProductType] = useState<string | undefined>();
  const [tenantId, setTenantId] = useState<number | undefined>();
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [payEnabled, setPayEnabled] = useState(false);
  const [busyNo, setBusyNo] = useState("");
  const [detailFor, setDetailFor] = useState<AdminOrderRow | null>(null);
  const [refundFor, setRefundFor] = useState<AdminOrderRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (keyword.trim()) query.set("keyword", keyword.trim());
      if (status) query.set("status", status);
      if (productType) query.set("productType", productType);
      if (tenantId) query.set("tenantId", String(tenantId));
      const payload = await api<Page<AdminOrderRow>>(
        `/admin/orders?${query.toString()}`,
      );
      if (payload.code === 0 && payload.data) {
        setRows(payload.data.list ?? []);
        setTotal(payload.data.total ?? 0);
      } else {
        message.error(payload.message || "订单加载失败");
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, status, productType, tenantId, message]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api<TenantOption[]>("/admin/tenants/options").then((payload) => {
      if (payload.code === 0) setTenants(payload.data ?? []);
    });
    // 对账要打到支付平台：通道没开时这个动作没有意义，按钮也就不给看
    void api<{ enabled: boolean }>("/admin/pay/status").then((payload) => {
      if (payload.code === 0) setPayEnabled(Boolean(payload.data?.enabled));
    });
  }, []);

  const refundable = (row: AdminOrderRow) =>
    (row.status === "PAID" || row.status === "FULFILLED") &&
    row.amountFen - row.refundedFen > 0;

  /** 平台侧主动对账：webhook 可能延迟或丢失，待支付单以这一次查单的结论为准。 */
  const reconcile = async (row: AdminOrderRow) => {
    setBusyNo(row.merchantOrderNo);
    try {
      const payload = await api<
        AdminOrderRow & { reconcileNote?: string }
      >(
        `/admin/orders/${encodeURIComponent(row.merchantOrderNo)}?reconcile=1`,
      );
      if (payload.code !== 0 || !payload.data) {
        message.error(payload.message || "对账失败");
        return;
      }
      const next = payload.data.status;
      const settled = next === "PAID" || next === "FULFILLED";
      const note =
        payload.data.reconcileNote ||
        `订单状态：${ORDER_STATUS_LABEL[next] || next}`;
      const warn = note.includes("不可达") || note.includes("查单失败");
      message[warn ? "warning" : settled ? "success" : "info"](note);
      await load();
    } finally {
      setBusyNo("");
    }
  };

  return (
    <>
      <Notice variant="info">
        订单主体是租户：每一单都是某个租户（下单人为其租户管理员）向平台购买软件产品或服务。
        金额以人民币计（存储单位为分）。退款口径：订阅按已服务天数折算，
        功能买断与额度包需整单退款才回收权益；退款成功即回收该租户的权益与额度池。
      </Notice>

      <Panel
        title="全平台订单"
        titleBadge={
          <span className="text-12 muted">共 {total.toLocaleString("zh-CN")} 单</span>
        }
        extra={
          <Space size={8} wrap>
            <Input.Search
              allowClear
              placeholder="搜索单号 / 商品名 / 租户 / 下单人"
              style={{ width: 240 }}
              onSearch={(value) => {
                setPage(1);
                setKeyword(value);
              }}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              style={{ width: 180 }}
              placeholder="全部租户"
              value={tenantId}
              onChange={(value) => {
                setPage(1);
                setTenantId(value);
              }}
              options={tenants.map((item) => ({
                value: item.id,
                label: `${item.name}（${item.code}）`,
              }))}
            />
            <Select
              allowClear
              style={{ width: 130 }}
              placeholder="订单状态"
              value={status}
              onChange={(value) => {
                setPage(1);
                setStatus(value);
              }}
              options={STATUS_OPTIONS}
            />
            <Select
              allowClear
              style={{ width: 130 }}
              placeholder="商品类型"
              value={productType}
              onChange={(value) => {
                setPage(1);
                setProductType(value);
              }}
              options={TYPE_OPTIONS}
            />
            <Button onClick={() => void load()}>刷新</Button>
          </Space>
        }
      >
        <div className="table-wrap">
          <Table<AdminOrderRow>
            rowKey="id"
            size="middle"
            loading={loading}
            dataSource={rows}
            locale={{ emptyText: <EmptyState icon="🧾" text="没有匹配的订单" /> }}
            pagination={{
              ...tablePagination,
              current: page,
              pageSize,
              total,
              onChange: (nextPage, nextSize) => {
                setPage(nextPage);
                setPageSize(nextSize);
              },
            }}
            columns={[
              {
                title: "下单时间",
                width: 160,
                render: (_, row) => <span className="text-12">{fmtTime(row.createdAt)}</span>,
              },
              {
                title: "订单号",
                width: 230,
                render: (_, row) => (
                  <div>
                    <div className="mono text-12">{row.merchantOrderNo}</div>
                    <div className="text-12 muted mono">
                      {row.platformOrderNo || "平台单号未回填"}
                    </div>
                  </div>
                ),
              },
              {
                title: "归属租户",
                width: 170,
                render: (_, row) =>
                  row.tenantId ? (
                    <div>
                      <div className="text-12" style={{ fontWeight: 600 }}>
                        {row.tenantName || `租户 #${row.tenantId}`}
                      </div>
                      <div className="text-12 muted mono">{row.tenantCode || ""}</div>
                    </div>
                  ) : (
                    <span className="text-12 muted">平台直属账号</span>
                  ),
              },
              {
                title: "下单人",
                width: 160,
                render: (_, row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {row.userDisplayName || row.username || `#${row.userId}`}
                    </div>
                    <div className="text-12 muted mono">{row.username}</div>
                  </div>
                ),
              },
              {
                title: "商品",
                width: 190,
                render: (_, row) => (
                  <div>
                    <div className="text-12">{row.productName || row.productId || "—"}</div>
                    <div className="text-12 muted">
                      {PRODUCT_TYPE_LABEL[row.productType] || row.productType}
                      {row.serviceDays ? ` · ${row.serviceDays} 天` : ""}
                    </div>
                  </div>
                ),
              },
              {
                title: "金额",
                width: 120,
                render: (_, row) => (
                  <div>
                    <span className="mono text-12">{fenText(row.amountFen)}</span>
                    {row.refundedFen ? (
                      <div className="text-12 muted">已退 {fenText(row.refundedFen)}</div>
                    ) : null}
                  </div>
                ),
              },
              {
                title: "发放额度",
                width: 120,
                render: (_, row) => (
                  <span className="text-12">
                    {row.quotaGranted ? quotaText(row.quotaGranted) : "—"}
                  </span>
                ),
              },
              {
                title: "状态",
                width: 100,
                render: (_, row) => (
                  <Badge
                    label={ORDER_STATUS_LABEL[row.status] || row.status}
                    variant={ORDER_STATUS_VARIANT[row.status] || "gray"}
                  />
                ),
              },
              {
                title: "操作",
                width: 210,
                render: (_, row) => (
                  <Space size={6}>
                    <Button size="small" onClick={() => setDetailFor(row)}>
                      详情
                    </Button>
                    {payEnabled && row.status === "PENDING" ? (
                      <Button
                        size="small"
                        loading={busyNo === row.merchantOrderNo}
                        onClick={() => void reconcile(row)}
                      >
                        对账
                      </Button>
                    ) : null}
                    <Button
                      size="small"
                      danger
                      disabled={!refundable(row)}
                      onClick={() => setRefundFor(row)}
                    >
                      退款
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <DetailModal
        orderNo={detailFor?.merchantOrderNo ?? null}
        payEnabled={payEnabled}
        onClose={() => setDetailFor(null)}
        onChanged={() => void load()}
      />
      <RefundModal
        orderNo={refundFor?.merchantOrderNo ?? null}
        onClose={() => setRefundFor(null)}
        onDone={() => {
          setRefundFor(null);
          void load();
        }}
      />
    </>
  );
}

/** 订单详情：本体 + 退款记录 + 已授予权益 + 买家 + 平台留档报文（默认折叠）。 */
function DetailModal({
  orderNo,
  payEnabled,
  onClose,
  onChanged,
}: {
  orderNo: string | null;
  payEnabled: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { message } = App.useApp();
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const fetchDetail = useCallback(
    (reconcile: boolean) => {
      if (!orderNo) return Promise.resolve();
      setLoading(true);
      return api<OrderDetail>(
        `/admin/orders/${encodeURIComponent(orderNo)}${reconcile ? "?reconcile=1" : ""}`,
      )
        .then((payload) => {
          if (payload.code === 0 && payload.data) setDetail(payload.data);
          else message.error(payload.message || "订单详情读取失败");
        })
        .finally(() => setLoading(false));
    },
    [orderNo, message],
  );

  useEffect(() => {
    if (!orderNo) return;
    setShowRaw(false);
    setDetail(null);
    void fetchDetail(false);
  }, [orderNo, fetchDetail]);

  const reconcileNote = detail?.reconcileNote || "";

  return (
    <Modal
      title={`订单详情 · ${orderNo ?? ""}`}
      open={Boolean(orderNo)}
      onCancel={onClose}
      footer={
        <Space>
          {payEnabled && detail?.status === "PENDING" ? (
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                await fetchDetail(true);
                setBusy(false);
                onChanged();
              }}
            >
              向支付平台核对
            </Button>
          ) : null}
          <Button
            onClick={() => {
              onChanged();
              onClose();
            }}
          >
            关闭
          </Button>
        </Space>
      }
      width={760}
      destroyOnHidden
    >
      {loading || !detail ? (
        <Notice variant="info">正在读取订单…</Notice>
      ) : (
        <div className="text-12" style={{ display: "grid", gap: 10 }}>
          {reconcileNote ? (
            <Notice variant={/不可达|查单失败/.test(reconcileNote) ? "warn" : "info"}>
              对账结论：{reconcileNote}
            </Notice>
          ) : null}
          <div className="form-2col">
            <Field text={`#${detail.id}`} label="订单 ID" />
            <Field
              text={ORDER_STATUS_LABEL[detail.status] || detail.status}
              label="状态"
            />
            <Field text={detail.merchantOrderNo} label="本站单号" mono />
            <Field text={detail.platformOrderNo || "—"} label="平台单号" mono />
            <Field
              text={
                detail.tenantId
                  ? `${detail.tenantName || `租户 #${detail.tenantId}`}（${detail.tenantCode || "—"}）`
                  : "平台直属账号（历史订单）"
              }
              label="归属租户"
            />
            <Field
              text={`${detail.userDisplayName || detail.buyer?.username || ""}（${detail.buyer?.username ?? ""} · ${ROLE_LABEL[detail.buyer?.role ?? 0] ?? "—"}）`}
              label="下单人"
            />
            <Field
              text={`${detail.productName || detail.productId}（${detail.productId}） · ${PRODUCT_TYPE_LABEL[detail.productType] || detail.productType}`}
              label="商品"
            />
            <Field text={fenText(detail.amountFen)} label="订单金额" />
            <Field text={fenText(detail.remainingFen)} label="可退余额" />
            <Field text={fenText(detail.refundedFen)} label="已退金额" />
            <Field
              text={detail.quotaGranted ? quotaText(detail.quotaGranted) : "—"}
              label="发放额度"
            />
            <Field
              text={detail.serviceDays ? `${detail.serviceDays} 天` : "长期"}
              label="服务期"
            />
            <Field text={detail.tradeType || "—"} label="支付方式" />
            <Field text={fmtTime(detail.createdAt)} label="下单时间" />
            <Field
              text={detail.paidAt ? fmtTime(new Date(detail.paidAt * 1000).toISOString()) : "未支付"}
              label="支付时间"
            />
          </div>

          <div>
            <div className="muted" style={{ marginBottom: 4 }}>
              已授予权益
            </div>
            {detail.entitlement ? (
              <span>
                {detail.entitlement.name || detail.entitlement.productId} ·{" "}
                <span className="mono text-12 muted">{detail.entitlement.productId}</span> ·{" "}
                {ENTITLEMENT_KIND_LABEL[detail.entitlement.kind] || detail.entitlement.kind} ·{" "}
                {detail.entitlement.enabled ? "生效中" : "已回收"} ·{" "}
                {detail.entitlement.expiresAt
                  ? `到期 ${fmtTime(new Date(detail.entitlement.expiresAt * 1000).toISOString())}`
                  : "长期有效"}
              </span>
            ) : (
              <span className="muted">无（额度包到账进该租户的额度池，不产生权益）</span>
            )}
          </div>

          <div>
            <div className="muted" style={{ marginBottom: 4 }}>
              退款记录
            </div>
            {detail.refunds.length ? (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={detail.refunds}
                columns={[
                  {
                    title: "时间",
                    width: 160,
                    render: (_, row) => fmtTime(row.createdAt),
                  },
                  {
                    title: "退款单号",
                    render: (_, row) => <span className="mono">{row.merchantRefundNo}</span>,
                  },
                  {
                    title: "金额",
                    width: 110,
                    render: (_, row) => fenText(row.amountFen),
                  },
                  {
                    title: "状态",
                    width: 110,
                    render: (_, row) => (
                      <Badge
                        label={REFUND_STATUS_LABEL[row.status] || row.status}
                        variant={row.status === "SUCCEEDED" ? "green" : row.status === "FAILED" ? "red" : "orange"}
                      />
                    ),
                  },
                  { title: "原因", width: 160, render: (_, row) => row.reason || "—" },
                ]}
              />
            ) : (
              <span className="muted">无退款</span>
            )}
          </div>

          <div>
            <div
              className="muted"
              style={{
                marginBottom: 4,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              平台留档报文
              <Button size="small" onClick={() => setShowRaw((value) => !value)}>
                {showRaw ? "收起" : "展开"}
              </Button>
              {!showRaw ? (
                <span className="text-12">
                  下单时支付平台的原始返回（凭据字段已掩码），只在排查支付异常时看。
                </span>
              ) : null}
            </div>
            {showRaw ? (
              <pre
                className="mono"
                style={{
                  margin: 0,
                  maxHeight: 260,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {JSON.stringify(detail.raw ?? {}, null, 2).slice(0, 4000)}
              </pre>
            ) : null}
          </div>
        </div>
      )}
    </Modal>
  );
}

/** 退款：先取后端试算（订阅按已服务天数折算），管理员可下调金额，提交即执行。 */
function RefundModal({
  orderNo,
  onClose,
  onDone,
}: {
  orderNo: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [preview, setPreview] = useState<RefundPreview | null>(null);
  const [amountFen, setAmountFen] = useState(0);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!orderNo) return;
    let alive = true;
    setPreview(null);
    setReason("");
    void api<RefundPreview>(
      `/admin/orders/${encodeURIComponent(orderNo)}/refund-preview`,
    ).then((payload) => {
      if (!alive) return;
      if (payload.code === 0 && payload.data) {
        setPreview(payload.data);
        setAmountFen(payload.data.suggestedRefundFen);
      } else {
        message.error(payload.message || "退款试算失败");
      }
    });
    return () => {
      alive = false;
    };
  }, [orderNo, message]);

  const submit = async () => {
    if (!orderNo) return;
    if (!Number.isInteger(amountFen) || amountFen <= 0) {
      message.warning("退款金额必须为正整数（分）");
      return;
    }
    setSubmitting(true);
    try {
      const payload = await postJson(
        `/admin/orders/${encodeURIComponent(orderNo)}/refund`,
        { amountFen, reason: reason.trim() },
      );
      if (payload.code !== 0) {
        message.error(payload.message);
        return;
      }
      message.success("退款已提交，权益与额度按口径回收");
      onDone();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={`订单退款 · ${orderNo ?? ""}`}
      open={Boolean(orderNo)}
      onCancel={onClose}
      onOk={() => void submit()}
      okText="确认退款"
      cancelText="取消"
      okButtonProps={{ danger: true, loading: submitting, disabled: !preview }}
      destroyOnHidden
    >
      {!preview ? (
        <Notice variant="info">正在试算可退金额…</Notice>
      ) : (
        <div className="text-12" style={{ display: "grid", gap: 8 }}>
          <Notice variant="warn">{preview.note}</Notice>
          <div className="form-2col">
            <Field text={fenText(preview.amountFen)} label="订单金额" />
            <Field text={fenText(preview.remainingFen)} label="可退余额" />
            <Field text={fenText(preview.refundedFen)} label="已退金额" />
            <Field
              text={
                preview.daysTotal
                  ? `已服务 ${preview.servedDays} / ${preview.daysTotal} 天`
                  : "不适用"
              }
              label="服务期折算"
            />
          </div>
          <div>
            <div className="muted" style={{ marginBottom: 4 }}>
              退款金额（分）· 建议 {preview.suggestedRefundFen} 分 ={" "}
              {fenText(preview.suggestedRefundFen)}
            </div>
            <Input
              type="number"
              min={1}
              max={preview.remainingFen}
              value={amountFen}
              onChange={(event) => setAmountFen(Math.trunc(Number(event.target.value || 0)))}
            />
            <div className="muted" style={{ marginTop: 4 }}>
              即 {fenText(amountFen)}；不得超过可退余额
            </div>
          </div>
          <div>
            <div className="muted" style={{ marginBottom: 4 }}>
              退款原因
            </div>
            <Input.TextArea
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="例如：客户取消订阅 / 重复下单"
            />
          </div>
        </div>
      )}
    </Modal>
  );
}

function Field({
  label,
  text,
  mono,
}: {
  label: string;
  text: string;
  mono?: boolean;
}) {
  return (
    <div>
      <span className="muted">{label}：</span>
      <span className={mono ? "mono" : undefined}>{text}</span>
    </div>
  );
}
