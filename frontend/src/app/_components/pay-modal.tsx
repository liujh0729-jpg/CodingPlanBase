"use client";

import { CopyOutlined } from "@ant-design/icons";
import { App, Button, Input, Modal } from "antd";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/panel";
import { api, postJson } from "@/lib/api";
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_VARIANT,
  fenText,
  type OrderRow,
} from "@/lib/gateway";

/** 收银台要受理的订单最小集合：下单成功与「继续支付」都能提供这三项。 */
export type PayOrder = {
  merchantOrderNo: string;
  productName: string;
  amountFen: number;
};

type PrepayInfo = Record<string, unknown>;

/** 从平台预支付返回里挑出可展示的支付入口（不同 trade_type 字段名不同）。 */
export function pickPayTarget(info: PrepayInfo | null): string {
  if (!info) return "";
  for (const key of [
    "code_url",
    "codeUrl",
    "pay_url",
    "payUrl",
    "h5_url",
    "h5Url",
    "mweb_url",
  ]) {
    const value = info[key];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

/**
 * 收银台：打开即向平台取预支付入口，付款后由「查询支付结果」主动对账并触发履约。
 * 订购管理的「软件订购」与「订购记录」共用这一个入口，避免两处各写一套支付逻辑。
 */
export function PayModal({
  order,
  onClose,
  onSettled,
}: {
  order: PayOrder | null;
  onClose: () => void;
  /** 支付确认到账后回调（刷新额度、权益与订单列表）。 */
  onSettled?: () => void;
}) {
  const { message } = App.useApp();
  const [info, setInfo] = useState<PrepayInfo | null>(null);
  const [status, setStatus] = useState("PENDING");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!order) {
      setInfo(null);
      setStatus("PENDING");
      setBusy("");
      return;
    }
    let alive = true;
    setBusy("prepay");
    void (async () => {
      const prepay = await postJson<PrepayInfo>(
        `/pay/orders/${order.merchantOrderNo}/prepay`,
        { tradeType: "native" },
      );
      const current = await api<OrderRow>(`/pay/orders/${order.merchantOrderNo}`);
      if (!alive) return;
      if (prepay.code === 0 && prepay.data) setInfo(prepay.data);
      else message.warning(`未取得支付入口：${prepay.message}`);
      if (current.code === 0 && current.data) setStatus(current.data.status);
      setBusy("");
    })();
    return () => {
      alive = false;
    };
  }, [order, message]);

  const settled = status === "PAID" || status === "FULFILLED";

  const recheck = async () => {
    if (!order) return;
    setBusy("recheck");
    try {
      const payload = await api<OrderRow>(
        `/pay/orders/${order.merchantOrderNo}?reconcile=1`,
      );
      if (payload.code !== 0 || !payload.data) {
        message.error(payload.message || "查询失败");
        return;
      }
      setStatus(payload.data.status);
      if (payload.data.status === "PAID" || payload.data.status === "FULFILLED") {
        message.success("支付已确认，额度与权益正在入账");
        onSettled?.();
      } else {
        message.info(
          `当前订单状态：${ORDER_STATUS_LABEL[payload.data.status] || payload.data.status}`,
        );
      }
    } finally {
      setBusy("");
    }
  };

  const copyTarget = async () => {
    const target = pickPayTarget(info);
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target);
      message.success("支付链接已复制");
    } catch {
      message.warning("浏览器拒绝了剪贴板访问，请手动复制");
    }
  };

  return (
    <Modal
      title={order ? `支付 · ${order.productName}` : "支付"}
      open={Boolean(order)}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          {settled ? "关闭并查看" : "关闭窗口"}
        </Button>,
        <Button
          key="check"
          type="primary"
          loading={busy === "recheck"}
          disabled={busy === "prepay"}
          onClick={() => void recheck()}
        >
          我已完成支付，查询结果
        </Button>,
      ]}
      width={560}
      destroyOnHidden
    >
      {order ? (
        <div style={{ display: "grid", gap: 10 }}>
          <div className="text-12">
            <span className="muted">订单号：</span>
            <span className="mono">{order.merchantOrderNo}</span>
          </div>
          <div className="text-12">
            <span className="muted">金额：</span>
            {fenText(order.amountFen)}
            <span className="muted"> · 状态：</span>
            <Badge
              label={ORDER_STATUS_LABEL[status] || status}
              variant={ORDER_STATUS_VARIANT[status] || "gray"}
            />
          </div>
          {settled ? (
            <Notice variant="success">
              支付已确认，额度与权益已入账，可在「订购记录」里核对。
            </Notice>
          ) : busy === "prepay" ? (
            <div className="text-12 muted">正在向平台取得支付入口…</div>
          ) : pickPayTarget(info) ? (
            <div>
              <div className="text-12 muted" style={{ marginBottom: 4 }}>
                支付入口（扫码 / 打开链接完成付款）：
              </div>
              <Input.TextArea
                readOnly
                autoSize={{ minRows: 2, maxRows: 4 }}
                value={pickPayTarget(info)}
                className="mono"
              />
              <Button
                size="small"
                icon={<CopyOutlined />}
                style={{ marginTop: 8 }}
                onClick={() => void copyTarget()}
              >
                复制支付链接
              </Button>
            </div>
          ) : (
            <Notice variant="warn">
              平台未返回可展示的支付入口，可稍后在「订购记录」里继续查询状态。
            </Notice>
          )}
          <div className="text-12 muted">
            支付由 Chandler.work 受理，本站只记录订单并在回调 / 查单后发放额度与权益。
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
