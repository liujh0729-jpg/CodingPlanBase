"use client";

import { App, Button, Form, Input, InputNumber, Modal, Select, Switch, Table } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { api } from "@/lib/api";
import {
  epochText,
  ipRulesRule,
  quotaText,
  type TokenRow,
} from "@/lib/gateway";
import { quotaUnitHint, useQuotaPerUnit } from "@/lib/quota";
import { useSession } from "@/lib/session";
import { tablePagination } from "./common";

type AdminTokenRow = TokenRow & {
  userName?: string;
  tenantId?: number;
  tenantName?: string;
};

type TokenValues = {
  name: string;
  group: string;
  status: number;
  unlimitedQuota: boolean;
  remainQuota: number;
  validDays?: number;
  modelLimitsOn: boolean;
  modelLimits: string;
  allowIps: string;
};

const TOKEN_STATUS_VARIANT: Record<number, string> = { 1: "green", 2: "orange", 3: "red" };
const TOKEN_STATUS_LABEL: Record<number, string> = { 1: "启用", 2: "禁用", 3: "过期" };

/**
 * 全部令牌（管理员全量视图）：看的是「谁的令牌、还剩多少、限了哪些模型/IP」。
 * 完整 sk- 密钥只在创建那一刻返回一次，因此本页只展示掩码，签发在「API 令牌」页面完成。
 */
export function TokensTab() {
  const { message, modal } = App.useApp();
  const { me } = useSession();
  const perUnit = useQuotaPerUnit();
  const [rows, setRows] = useState<AdminTokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AdminTokenRow | null>(null);
  const [form] = Form.useForm<TokenValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api<AdminTokenRow[]>("/gateway/tokens?all=1");
      if (payload.code === 0) setRows(payload.data ?? []);
      else message.error(payload.message || "令牌列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (row: AdminTokenRow) => {
    form.resetFields();
    form.setFieldsValue({
      name: row.name,
      group: row.group,
      status: row.status,
      unlimitedQuota: row.unlimitedQuota,
      remainQuota: row.remainQuota,
      validDays: undefined,
      modelLimitsOn: row.modelLimitsOn,
      modelLimits: row.modelLimits,
      allowIps: row.allowIps,
    });
    setEditing(row);
  };

  const submit = async () => {
    if (!editing) return;
    const values = await form.validateFields();
    const body: Record<string, unknown> = {
      name: values.name,
      group: values.group,
      status: values.status,
      unlimitedQuota: values.unlimitedQuota,
      modelLimitsOn: values.modelLimitsOn,
      modelLimits: values.modelLimits ?? "",
      allowIps: values.allowIps ?? "",
    };
    // 令牌额度与账号额度是两本账：非不限额时才写剩余额度
    if (!values.unlimitedQuota) body.remainQuota = Math.trunc(values.remainQuota ?? 0);
    // 0 ＝「改成永不过期」：不填这个方向就回不去，留空才是不修改
    if (values.validDays !== undefined && values.validDays >= 0) {
      body.expiredAt =
        values.validDays === 0
          ? -1
          : Math.floor(Date.now() / 1000) + values.validDays * 86400;
    }
    const payload = await api(`/gateway/tokens/${editing.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (payload.code !== 0) {
      message.error(payload.message);
      return;
    }
    message.success("令牌已更新");
    setEditing(null);
    await load();
  };

  const setStatus = async (row: AdminTokenRow, status: number) => {
    const payload = await api(`/gateway/tokens/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    if (payload.code !== 0) {
      message.error(payload.message);
      return;
    }
    message.success(status === 1 ? "已启用" : "已禁用");
    await load();
  };

  const remove = (row: AdminTokenRow) => {
    modal.confirm({
      title: `删除令牌 ${row.name || row.keyMasked}`,
      content: "删除后该密钥立即失效，历史用量日志仍以快照保留。",
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const payload = await api(`/gateway/tokens/${row.id}`, { method: "DELETE" });
        if (payload.code !== 0) {
          message.error(payload.message);
          return;
        }
        message.success("令牌已删除");
        await load();
      },
    });
  };

  return (
    <>
      <Notice variant="info">
        令牌额度独立于账号额度：调用先扣令牌剩余（不限额则只扣账号），账号余额不足时按可用额度结算。
      </Notice>

      <Panel
        title="全部令牌"
        titleBadge={
          <span className="text-12 muted">
            共 {rows.length} 个 · 启用 {rows.filter((row) => row.status === 1).length} 个
          </span>
        }
      >
        <div className="table-wrap">
          <Table<AdminTokenRow>
            rowKey="id"
            size="middle"
            loading={loading}
            dataSource={rows}
            pagination={tablePagination}
            locale={{ emptyText: <EmptyState icon="🔑" text="还没有用户签发令牌" /> }}
            columns={[
              { title: "ID", width: 60, render: (_, row) => <span className="mono">{row.id}</span> },
              {
                title: "名称 / 归属",
                width: 190,
                render: (_, row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.name || "未命名"}</div>
                    <div className="text-12 muted">
                      {row.userName ? row.userName : `#${row.userId}`}
                      {row.userId === me?.id ? " · 我自己" : ""}
                    </div>
                  </div>
                ),
              },
              {
                title: "归属租户",
                width: 140,
                render: (_, row) =>
                  row.tenantId ? (
                    <span className="text-12">{row.tenantName || `租户 #${row.tenantId}`}</span>
                  ) : (
                    <span className="text-12 muted">无租户（历史令牌）</span>
                  ),
              },
              {
                title: "密钥",
                width: 170,
                render: (_, row) => <span className="mono text-12">{row.keyMasked}</span>,
              },
              {
                title: "状态",
                width: 90,
                render: (_, row) => (
                  <Badge
                    label={TOKEN_STATUS_LABEL[row.status] ?? "未知"}
                    variant={TOKEN_STATUS_VARIANT[row.status] ?? "gray"}
                  />
                ),
              },
              {
                title: "剩余 / 已用",
                width: 160,
                render: (_, row) => (
                  <div>
                    <span className="mono text-12">
                      {row.unlimitedQuota ? "不限额" : quotaText(row.remainQuota)}
                    </span>
                    <div className="text-12 muted">已耗 {quotaText(row.usedQuota)}</div>
                  </div>
                ),
              },
              {
                title: "模型白名单",
                width: 150,
                render: (_, row) =>
                  row.modelLimitsOn ? (
                    <span className="mono text-12">
                      {row.modelLimits || "（未填）"}
                    </span>
                  ) : (
                    <span className="text-12 muted">不限制</span>
                  ),
              },
              {
                title: "分组",
                width: 110,
                render: (_, row) => <span className="text-12">{row.group}</span>,
              },
              {
                title: "有效期",
                width: 160,
                render: (_, row) => <span className="text-12">{epochText(row.expiredAt)}</span>,
              },
              {
                title: "最近调用",
                width: 160,
                // accessedAt 用 0 表示「从未调用」，不能复用永不过期的口径
                render: (_, row) => (
                  <span className="text-12">
                    {row.accessedAt > 0
                      ? new Date(row.accessedAt * 1000).toLocaleString("zh-CN", {
                          hour12: false,
                        })
                      : "从未调用"}
                  </span>
                ),
              },
              {
                title: "操作",
                width: 210,
                render: (_, row) => (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Button size="small" onClick={() => openEdit(row)}>
                      编辑
                    </Button>
                    <Button
                      size="small"
                      danger={row.status === 1}
                      onClick={() => void setStatus(row, row.status === 1 ? 2 : 1)}
                    >
                      {row.status === 1 ? "禁用" : "启用"}
                    </Button>
                    <Button size="small" onClick={() => remove(row)}>
                      删除
                    </Button>
                  </div>
                ),
              },
            ]}
            expandable={{
              expandedRowRender: (row) => (
                <div className="text-12" style={{ display: "grid", gap: 4 }}>
                  <div>
                    <span className="muted">IP 白名单：</span>
                    <span className="mono">{row.allowIps || "（不限制）"}</span>
                  </div>
                  <div>
                    <span className="muted">创建时间：</span>
                    {new Date(row.createdAt).toLocaleString("zh-CN", { hour12: false })}
                  </div>
                </div>
              ),
            }}
          />
        </div>
      </Panel>

      <Modal
        title={editing ? `编辑令牌 · ${editing.name || editing.keyMasked}` : "编辑令牌"}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={() => void submit()}
        okText="保存"
        cancelText="取消"
        width={640}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <div className="form-2col">
            <Form.Item
              name="name"
              label="令牌名称"
              rules={[{ required: true, whitespace: true, message: "请输入名称" }]}
            >
              <Input placeholder="例如：本机开发 / Cursor" />
            </Form.Item>
            <Form.Item name="group" label="分组" extra="限定可路由的渠道与模型分组">
              <Input placeholder="default" />
            </Form.Item>
            <Form.Item name="status" label="状态">
              <Select
                options={[
                  { value: 1, label: "启用" },
                  { value: 2, label: "禁用" },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="validDays"
              label="重设有效期（天）"
              extra="留空表示不修改；填 0 改为永不过期"
            >
              <InputNumber min={0} style={{ width: "100%" }} placeholder="例如 30" />
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="unlimitedQuota" label="不限额" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              noStyle
              shouldUpdate={(prev, next) => prev.unlimitedQuota !== next.unlimitedQuota}
            >
              {({ getFieldValue }) =>
                getFieldValue("unlimitedQuota") ? null : (
                  <Form.Item
                    name="remainQuota"
                    label="剩余额度"
                    extra={quotaUnitHint(perUnit)}
                  >
                    <InputNumber
                      min={0}
                      step={perUnit ? Math.round(perUnit / 10) : 1}
                      style={{ width: "100%" }}
                    />
                  </Form.Item>
                )
              }
            </Form.Item>
          </div>
          <div className="form-2col">
            <Form.Item name="modelLimitsOn" label="限制可用模型" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              noStyle
              shouldUpdate={(prev, next) => prev.modelLimitsOn !== next.modelLimitsOn}
            >
              {({ getFieldValue }) =>
                getFieldValue("modelLimitsOn") ? (
                  <Form.Item name="modelLimits" label="可用模型">
                    <Input placeholder="英文逗号分隔，例如 gpt-x,claude-y" />
                  </Form.Item>
                ) : null
              }
            </Form.Item>
          </div>
          <Form.Item
            name="allowIps"
            label="IP 白名单"
            rules={[ipRulesRule()]}
            extra="逗号或换行分隔，支持精确地址、CIDR 网段、前缀通配或 *；留空表示不限制来源 IP"
          >
            <Input.TextArea rows={2} placeholder="1.2.3.4, 5.6.7.0/24, 10.0.*" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
