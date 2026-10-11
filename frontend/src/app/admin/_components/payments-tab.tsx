"use client";

import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { api } from "@/lib/api";
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_VARIANT,
  PRODUCT_TYPE_LABEL,
  fenText,
  quotaText,
  type PayProduct,
  type PayStatus,
  type PaySummary,
} from "@/lib/gateway";
import { FieldLabel, loadApi } from "./common";

type SettingsMap = Record<string, string>;

const PRODUCT_TYPES = Object.entries(PRODUCT_TYPE_LABEL).map(([value, label]) => ({
  value,
  label,
}));

const DAY_OPTIONS = [
  { value: 7, label: "近 7 天" },
  { value: 30, label: "近 30 天" },
  { value: 90, label: "近 90 天" },
  { value: 365, label: "近一年" },
];

/** 目录行 = 后端归一后的原始商品 + 界面判定（能不能下单、删除时用的历史单据数）。 */
type ProductRow = PayProduct & { blocked: string; rowKey: string; index: number };

/**
 * 支付管理：在线支付（B 端订阅 / 功能买断 / 额度包）的开通开关、商品配置与收款概览。
 * 金额口径统一为人民币：订单以「分」存储，界面按元展示；支付凭据只读环境变量，界面仅报「有无」。
 */
export function PaymentsTab() {
  const { message, modal } = App.useApp();
  const [summary, setSummary] = useState<PaySummary | null>(null);
  const [status, setStatus] = useState<PayStatus | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [channelForm, setChannelForm] = useState<SettingsMap>({});
  const [editing, setEditing] = useState<{ row: PayProduct; index: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<PayProduct>();

  /*
   * 商品目录只有一份判定：后端 products() 决定谁能下单（orderableIds），
   * 界面按同一批原始行展示，并给被挡住的行补一句原因，避免「表里有、前台买不到」。
   */
  const rawProducts = status?.products ?? [];
  const orderable = new Set(status?.orderableIds ?? []);
  const catalog: ProductRow[] = [];
  const kept = new Set<string>();
  rawProducts.forEach((row, index) => {
    let blocked = "";
    if (!row.id) blocked = "缺商品 ID";
    else if (kept.has(row.id)) blocked = "商品 ID 重复";
    else if (!orderable.has(row.id))
      blocked = row.amountFen > 0 ? "商品 ID 重复" : "价格必须大于 0 才能下单";
    else kept.add(row.id);
    catalog.push({ ...row, blocked, index, rowKey: `${row.id || "无 ID"}#${index}` });
  });
  const usage = new Map((summary?.productUsage ?? []).map((item) => [item.productId, item]));
  const blockedCount = catalog.filter((row) => row.blocked).length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryResult, statusResult, settingsResult] = await Promise.all([
        loadApi<PaySummary>(`/admin/pay/summary?days=${days}`),
        loadApi<PayStatus>("/admin/pay/status"),
        loadApi<SettingsMap>("/settings"),
      ]);
      if (summaryResult.data) setSummary(summaryResult.data);
      if (statusResult.data) setStatus(statusResult.data);
      if (settingsResult.data) {
        setChannelForm(pick(settingsResult.data, ["chandler_enabled", "chandler_base_url"]));
      }
      if (summaryResult.forbidden || statusResult.forbidden) {
        message.warning("需要管理员权限才能查看支付数据");
      } else if (!summaryResult.data && summaryResult.message) {
        message.error(summaryResult.message);
      }
    } finally {
      setLoading(false);
    }
  }, [days, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveChannel = async () => {
    setSaving("channel");
    try {
      const payload = await api<SettingsMap>("/settings", {
        method: "PUT",
        body: JSON.stringify(channelForm),
      });
      if (payload.code !== 0) {
        message.error(payload.message);
        return;
      }
      message.success("已保存");
      await load();
    } finally {
      setSaving("");
    }
  };

  const saveProducts = async (next: PayProduct[]) => {
    setSaving("products");
    try {
      const payload = await api<SettingsMap>("/settings", {
        method: "PUT",
        body: JSON.stringify({ chandler_products: JSON.stringify(next) }),
      });
      if (payload.code !== 0) {
        message.error(payload.message);
        return;
      }
      message.success("商品已保存");
      setCreating(false);
      setEditing(null);
      await load();
    } finally {
      setSaving("");
    }
  };

  const submitProduct = async () => {
    const values = await form.validateFields();
    const id = String(values.id).trim();
    const dupIndex = rawProducts.findIndex((item) => item.id === id);
    if (dupIndex >= 0 && dupIndex !== editing?.index) {
      message.error(`商品 ID「${id}」已存在，同一 ID 只有第一条能下单`);
      return;
    }
    const next = editing
      ? rawProducts.map((item, index) => (index === editing.index ? { ...values, id } : item))
      : [...rawProducts, { ...values, id }];
    await saveProducts(next);
  };

  const openForm = (row?: ProductRow) => {
    form.resetFields();
    if (row) {
      form.setFieldsValue(row);
      setEditing({ row, index: row.index });
      return;
    }
    form.setFieldsValue({ type: "quota", amountFen: 100, quota: 0, serviceDays: 0 });
    setCreating(true);
  };

  /** 删除是「下架」级别的破坏动作：先把这个商品的历史单据说清楚，再让管理员确认。 */
  const removeProduct = (row: ProductRow) => {
    const stat = usage.get(row.id);
    modal.confirm({
      title: `删除商品「${row.name || row.id || "未命名"}」`,
      content: stat?.orderCount
        ? `该商品共有 ${stat.orderCount} 张订单（成交 ${stat.paidCount} 张 · 待支付 ${stat.pendingCount} 张）。删除后前台无法再下新单；已有订单仍按单号留档、待支付单可以继续付款，但订单里的商品名会退回显示商品编码。`
        : "该商品还没有任何订单。删除后前台无法再下这一单的新购。",
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        await saveProducts(rawProducts.filter((item, index) => index !== row.index));
      },
    });
  };

  const missingCredentials = status
    ? [
        status.hasClientId ? "" : "CHANDLER_CLIENT_ID",
        status.hasClientSecret ? "" : "CHANDLER_CLIENT_SECRET",
        status.hasApiKey ? "" : "CHANDLER_API_KEY",
      ].filter(Boolean)
    : [];

  return (
    <>
      <Notice variant="info">
        在线支付用于 B 端场景：订阅软件、买断功能、购买额度包。收款与退款金额均以人民币计，
        订单以「分」存储；支付凭据由服务端环境变量提供，界面不回显明文。
      </Notice>

      <Panel
        title="收款概览"
        titleBadge={
          <Select
            size="small"
            style={{ width: 110 }}
            value={days}
            onChange={setDays}
            options={DAY_OPTIONS}
          />
        }
        extra={<Button onClick={() => void load()}>刷新</Button>}
      >
        <StatGrid>
          <StatCard
            label={`${days} 天收款`}
            value={summary ? fenText(summary.recentPaidFen) : "—"}
            hint={summary ? `${summary.recentPaidCount} 单` : undefined}
          />
          <StatCard
            label="累计收款"
            value={summary ? fenText(summary.paidFen) : "—"}
            hint={summary ? `${summary.paidCount} 单已支付` : undefined}
          />
          <StatCard
            label="累计退款"
            value={summary ? fenText(summary.refundedFen) : "—"}
            hint={
              summary ? `净收款 ${fenText(summary.paidFen - summary.refundedFen)}` : undefined
            }
          />
          <StatCard
            label="待支付订单"
            value={summary?.pendingCount ?? "—"}
            hint={summary ? `订单总数 ${summary.orderCount}` : undefined}
          />
          <StatCard
            label="生效权益"
            value={summary?.activeEntitlements ?? "—"}
            hint="订阅与功能买断"
          />
          <StatCard
            label="累计发放额度"
            value={summary ? quotaText(summary.grantedQuota) : "—"}
            hint="额度包与订单赠送"
          />
        </StatGrid>

        <div className="form-2col" style={{ marginTop: 20 }}>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              按订单状态
            </div>
            <Table<PaySummary["byStatus"][number]>
              rowKey="status"
              size="small"
              loading={loading}
              pagination={false}
              dataSource={summary?.byStatus ?? []}
              locale={{ emptyText: <EmptyState icon="🧾" text="还没有订单" /> }}
              columns={[
                {
                  title: "状态",
                  render: (_, row) => (
                    <Badge
                      label={ORDER_STATUS_LABEL[row.status] || row.status}
                      variant={ORDER_STATUS_VARIANT[row.status] || "gray"}
                    />
                  ),
                },
                { title: "单数", width: 90, render: (_, row) => row.count },
                {
                  title: "金额",
                  width: 120,
                  render: (_, row) => <span className="mono">{fenText(row.amountFen)}</span>,
                },
              ]}
            />
          </div>
          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              按商品类型（仅已支付）
            </div>
            <Table<PaySummary["byProductType"][number]>
              rowKey="productType"
              size="small"
              loading={loading}
              pagination={false}
              dataSource={summary?.byProductType ?? []}
              locale={{ emptyText: <EmptyState icon="🧾" text="还没有成交" /> }}
              columns={[
                {
                  title: "类型",
                  render: (_, row) => (
                    <Badge
                      label={PRODUCT_TYPE_LABEL[row.productType] || row.productType}
                      variant={typeVariant(row.productType)}
                    />
                  ),
                },
                { title: "单数", width: 90, render: (_, row) => row.count },
                {
                  title: "收款 / 退款",
                  width: 170,
                  render: (_, row) => (
                    <span className="mono text-12">
                      {fenText(row.amountFen)} / {fenText(row.refundedFen)}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="支付渠道"
        titleBadge={
          <Badge
            label={status?.enabled ? "已开通" : "未开通"}
            variant={status?.enabled ? "green" : "gray"}
          />
        }
      >
        {status?.enabled && missingCredentials.length ? (
          <Notice variant="warn">
            支付已开通，但服务端环境变量缺少 {missingCredentials.join(" / ")}
            ：未配置时下单、退款与联合登录会被拒绝。凭据只从环境变量读取，界面不保存也不回显。
          </Notice>
        ) : null}
        <div className="form-2col">
          <FieldLabel label="开通支付能力" hint="关闭时下单 / 回调 / 权益接口一律拒绝">
            <Switch
              checked={channelForm.chandler_enabled === "true"}
              onChange={(checked) =>
                setChannelForm({ ...channelForm, chandler_enabled: checked ? "true" : "false" })
              }
            />
          </FieldLabel>
          <FieldLabel label="平台地址" hint={`当前生效 ${status?.baseUrl || "默认"}`}>
            <Input
              value={channelForm.chandler_base_url || ""}
              onChange={(event) =>
                setChannelForm({ ...channelForm, chandler_base_url: event.target.value })
              }
              placeholder="https://app.chandler.work"
            />
          </FieldLabel>
        </div>
        <Space wrap>
          <Button type="primary" loading={saving === "channel"} onClick={() => void saveChannel()}>
            保存渠道配置
          </Button>
          <span className="text-12 muted">
            回调地址：<span className="mono">{status?.webhookPath || "/pay/webhook"}</span>
            （在支付平台侧填本站域名 + 该路径）
          </span>
        </Space>
        <div className="text-12 muted" style={{ marginTop: 8 }}>
          凭据自检：CLIENT_ID {status?.hasClientId ? "已配置" : "未配置"} · CLIENT_SECRET{" "}
          {status?.hasClientSecret ? "已配置" : "未配置"} · API_KEY{" "}
          {status?.hasApiKey ? "已配置" : "未配置"} · 可下单商品 {status?.productCount ?? 0} 个
          {status?.enabled ? "" : "（渠道未开通，下单入口一律关闭）"}
        </div>
      </Panel>

      <Panel
        title="商品与套餐"
        titleBadge={
          <span className="text-12 muted">
            共 {catalog.length} 个商品 · 可下单 {status?.productCount ?? 0} 个
          </span>
        }
        extra={
          <Button type="primary" onClick={() => openForm()}>
            新增商品
          </Button>
        }
      >
        {blockedCount ? (
          <Notice variant="warn">
            有 {blockedCount} 个商品当前下不了单，租户侧「软件订购」不会展示它们：价格必须大于 0
            分，商品 ID 不能留空也不能重复。改好保存即可恢复。
          </Notice>
        ) : null}
        <div className="table-wrap">
          <Table<ProductRow>
            rowKey="rowKey"
            size="small"
            loading={loading}
            dataSource={catalog}
            pagination={false}
            locale={{ emptyText: <EmptyState icon="🧾" text="还没有商品，先添加可购买项" /> }}
            columns={[
              {
                title: "商品 ID",
                width: 180,
                render: (_, row) =>
                  row.id ? (
                    <span className="mono text-12">{row.id}</span>
                  ) : (
                    <span className="text-12 muted">（未填）</span>
                  ),
              },
              {
                title: "名称",
                width: 220,
                render: (_, row) => {
                  const stat = usage.get(row.id);
                  return (
                    <div>
                      <div>{row.name || <span className="muted">（未命名）</span>}</div>
                      <div className="text-12 muted">
                        {stat?.orderCount
                          ? `成交 ${stat.paidCount} 单 · 待支付 ${stat.pendingCount} 单`
                          : "暂无订单"}
                      </div>
                    </div>
                  );
                },
              },
              {
                title: "类型",
                width: 110,
                render: (_, row) => (
                  <Badge
                    label={PRODUCT_TYPE_LABEL[row.type] || row.type}
                    variant={typeVariant(row.type)}
                  />
                ),
              },
              {
                title: "状态",
                width: 150,
                render: (_, row) =>
                  row.blocked ? (
                    <Badge label={row.blocked} variant="orange" />
                  ) : (
                    <Badge label="可下单" variant="green" />
                  ),
              },
              {
                title: "价格",
                width: 110,
                render: (_, row) => <span className="mono">{fenText(row.amountFen)}</span>,
              },
              {
                title: "发放额度",
                width: 130,
                render: (_, row) =>
                  row.quota ? quotaText(row.quota) : <span className="muted">—</span>,
              },
              {
                title: "服务天数",
                width: 110,
                render: (_, row) =>
                  row.serviceDays ? (
                    `${row.serviceDays} 天`
                  ) : (
                    <span className="muted">长期</span>
                  ),
              },
              {
                title: "操作",
                width: 160,
                render: (_, row) => (
                  <Space size={6}>
                    <Button size="small" onClick={() => openForm(row)}>
                      编辑
                    </Button>
                    <Button size="small" danger onClick={() => removeProduct(row)}>
                      删除
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <Modal
        title={editing ? `编辑商品 · ${editing.row.id}` : "新增商品"}
        open={creating || Boolean(editing)}
        onCancel={() => {
          setCreating(false);
          setEditing(null);
        }}
        onOk={() => void submitProduct()}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving === "products"}
        width={560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <div className="form-2col">
            <Form.Item
              name="id"
              label="商品 ID"
              extra="与支付平台侧的商品标识对应，保存后请勿变更（订单按此 ID 履约）"
              rules={[
                { required: true, whitespace: true, message: "请输入商品 ID" },
                {
                  pattern: /^[A-Za-z0-9_.-]+$/,
                  message: "商品 ID 只能用字母、数字、下划线、点或短横线",
                },
              ]}
            >
              <Input placeholder="pro_monthly" disabled={Boolean(editing)} />
            </Form.Item>
            <Form.Item
              name="name"
              label="商品名称"
              extra="订单列表、收银台与权益名都用它展示"
              rules={[{ required: true, whitespace: true, message: "请输入名称" }]}
            >
              <Input placeholder="专业版 · 月付" />
            </Form.Item>
            <Form.Item name="type" label="类型" rules={[{ required: true }]}>
              <Select options={PRODUCT_TYPES} />
            </Form.Item>
            <Form.Item
              name="amountFen"
              label="价格（分）"
              extra="人民币，1 元 = 100 分；价格为 0 的商品无法下单"
              rules={[
                { required: true, message: "请输入价格" },
                { type: "number", min: 1, message: "价格至少 1 分" },
              ]}
            >
              <InputNumber min={1} step={100} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="quota" label="发放额度" extra="额度包类商品填写；0 表示不发放">
              <InputNumber min={0} step={10000} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="serviceDays" label="服务天数" extra="订阅类商品填写；0 表示长期有效">
              <InputNumber min={0} step={30} style={{ width: "100%" }} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </>
  );
}

function typeVariant(type: string) {
  return type === "subscription" ? "sky" : type === "feature" ? "violet" : "blue";
}

function pick(source: SettingsMap, keys: string[]): SettingsMap {
  const out: SettingsMap = {};
  for (const key of keys) out[key] = source[key] ?? "";
  return out;
}
