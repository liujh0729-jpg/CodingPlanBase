"use client";

import { App, Button, Input, Select, Table } from "antd";
import { useCallback, useEffect, useState } from "react";
import { PayModal, type PayOrder } from "@/app/_components/pay-modal";
import { tablePagination } from "@/app/admin/_components/common";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Panel } from "@/components/ui/panel";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/datetime";
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_VARIANT,
  PRODUCT_TYPE_LABEL,
  fenText,
  quotaText,
  type OrderRow,
} from "@/lib/gateway";
import { useSession } from "@/lib/session";

type OrdersRow = OrderRow & { tenantName?: string; tenantCode?: string };

type OrderPage = {
  list: OrdersRow[];
  total: number;
  page: number;
  pageSize: number;
};

const STATUS_OPTIONS = Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => ({
  value,
  label,
}));

const TYPE_OPTIONS = Object.entries(PRODUCT_TYPE_LABEL).map(([value, label]) => ({
  value,
  label,
}));

/**
 * 订购管理 · 订购记录：向平台购买软件的全部单据，一处实现两处入口。
 * 当前租户的管理员＝只读本租户的单据（归属租户由服务端从会话推出），续付自家待支付单；
 * 平台管理员 / 超管（role ≥ 10）＝同一份接口的平台视角：全平台单据 + 归属租户列。
 * 退款与跨租户核对仍只在平台侧「管理后台 → 订单管理」。
 */
export function ConsoleOrdersTab({
  showTenant = false,
  onSettled,
}: {
  showTenant?: boolean;
  onSettled: () => void;
}) {
  const { message } = App.useApp();
  const { refresh } = useSession();
  const [rows, setRows] = useState<OrderPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [productType, setProductType] = useState("");
  const [keyword, setKeyword] = useState("");
  const [paying, setPaying] = useState<PayOrder | null>(null);
  const [busyNo, setBusyNo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (status) query.set("status", status);
      if (productType) query.set("productType", productType);
      if (keyword.trim()) query.set("keyword", keyword.trim());
      const payload = await api<OrderPage>(`/pay/orders?${query.toString()}`);
      if (payload.code === 0 && payload.data) setRows(payload.data);
      else message.error(payload.message || "订购记录读取失败");
    } finally {
      setLoading(false);
    }
  }, [page, status, productType, keyword, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const settle = useCallback(async () => {
    await Promise.all([refresh(), load(), onSettled()]);
  }, [refresh, load, onSettled]);

  const reconcile = async (row: OrdersRow) => {
    setBusyNo(row.merchantOrderNo);
    try {
      const payload = await api<OrderRow & { reconcileNote?: string }>(
        `/pay/orders/${row.merchantOrderNo}?reconcile=1`,
      );
      if (payload.code !== 0 || !payload.data) {
        message.error(payload.message || "查单失败");
        return;
      }
      const next = payload.data.status;
      const settled = next === "PAID" || next === "FULFILLED";
      const note =
        payload.data.reconcileNote ||
        `订单状态：${ORDER_STATUS_LABEL[next] || next}`;
      const warn =
        note.includes("不可达") || note.includes("查单失败");
      message[warn ? "warning" : settled ? "success" : "info"](note);
      if (next === "PAID" || next === "FULFILLED") await settle();
      else await load();
    } finally {
      setBusyNo("");
    }
  };

  return (
    <>
      <Panel title="订购记录"
        titleBadge={
          <span className="text-12 muted">
            共 {(rows?.total ?? 0).toLocaleString("zh-CN")} 条 ·{" "}
            {showTenant
              ? "全平台租户的订购单据；退款在「管理后台 → 订单管理」"
              : "退款请联系平台管理员"}
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
            placeholder="按订单号 / 平台单号 / 商品名检索"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={() => {
              setPage(1);
              void load();
            }}
            style={{ maxWidth: 320 }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Select
              allowClear
              placeholder="全部状态"
              value={status || undefined}
              options={STATUS_OPTIONS}
              onChange={(value) => {
                setStatus(value || "");
                setPage(1);
              }}
              style={{ minWidth: 160 }}
            />
            <Select
              allowClear
              placeholder="全部类型"
              value={productType || undefined}
              options={TYPE_OPTIONS}
              onChange={(value) => {
                setProductType(value || "");
                setPage(1);
              }}
              style={{ minWidth: 160 }}
            />
          </div>
        </div>

        <div className="table-wrap">
          <Table<OrdersRow>
            rowKey="id"
            size="middle"
            loading={loading}
            dataSource={rows?.list ?? []}
            pagination={{
              ...tablePagination,
              current: page,
              pageSize: 20,
              total: rows?.total ?? 0,
              onChange: setPage,
            }}
            locale={{
              emptyText: (
                <EmptyState
                  icon="📄"
                  text={
                    showTenant
                      ? "还没有租户下过单"
                      : "还没有订购记录，可在「软件订购」下第一单"
                  }
                />
              ),
            }}
            columns={[
              {
                title: "下单时间",
                width: 170,
                render: (_, row) => (
                  <span className="text-12 muted">{fmtTime(row.createdAt)}</span>
                ),
              },
              {
                title: "订单号",
                width: 220,
                render: (_, row) => (
                  <div>
                    <div className="mono text-12">{row.merchantOrderNo}</div>
                    {row.platformOrderNo ? (
                      <div className="mono text-12 muted">{row.platformOrderNo}</div>
                    ) : null}
                  </div>
                ),
              },
              ...(showTenant
                ? [
                    {
                      title: "归属租户",
                      width: 170,
                      render: (_: unknown, row: OrdersRow) => (
                        <div>
                          <div className="text-12">
                            {row.tenantName || `租户 #${row.tenantId}`}
                          </div>
                          <div className="text-12 muted">
                            {row.tenantCode || "—"}
                          </div>
                        </div>
                      ),
                    },
                  ]
                : []),
              {
                title: "商品",
                width: 180,
                render: (_, row) => (
                  <div>
                    <div className="text-12">{row.productName || row.productId}</div>
                    <Badge
                      label={PRODUCT_TYPE_LABEL[row.productType] || row.productType}
                      variant="sky"
                    />
                  </div>
                ),
              },
              {
                title: "金额",
                width: 140,
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
                width: 130,
                render: (_, row) => (
                  <span className="mono text-12">
                    {row.quotaGranted ? quotaText(row.quotaGranted) : "—"}
                  </span>
                ),
              },
              {
                title: "服务期",
                width: 120,
                render: (_, row) => (
                  <span className="text-12">{row.serviceDays ? `${row.serviceDays} 天` : "—"}</span>
                ),
              },
              {
                title: "状态",
                width: 110,
                render: (_, row) => (
                  <Badge
                    label={ORDER_STATUS_LABEL[row.status] || row.status}
                    variant={ORDER_STATUS_VARIANT[row.status] || "gray"}
                  />
                ),
              },
              {
                title: "操作",
                width: 140,
                render: (_, row) =>
                  row.status === "PENDING" ? (
                    <Button
                      size="small"
                      type="primary"
                      onClick={() =>
                        setPaying({
                          merchantOrderNo: row.merchantOrderNo,
                          productName: row.productName || row.productId,
                          amountFen: row.amountFen,
                        })
                      }
                    >
                      继续支付
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      loading={busyNo === row.merchantOrderNo}
                      onClick={() => void reconcile(row)}
                    >
                      查询支付
                    </Button>
                  ),
              },
            ]}
          />
        </div>
      </Panel>

      <PayModal
        order={paying}
        onClose={() => setPaying(null)}
        onSettled={() => void settle()}
      />
    </>
  );
}
