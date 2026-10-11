"use client";

import { CopyOutlined } from "@ant-design/icons";
import { App, Button, Form, Input, InputNumber, Modal, Switch, Table } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, PageHero, Panel } from "@/components/ui/panel";
import { api, postJson } from "@/lib/api";
import {
  GATEWAY_BASE_URL,
  epochText,
  ipRulesRule,
  quotaText,
  type TokenRow,
} from "@/lib/gateway";
import { quotaUnitHint, useQuotaPerUnit } from "@/lib/quota";
import { useSession } from "@/lib/session";
import { tablePagination } from "@/app/admin/_components/common";

type TokenValues = {
  name: string;
  group: string;
  unlimitedQuota: boolean;
  remainQuota: number;
  validDays?: number;
  modelLimitsOn: boolean;
  modelLimits: string;
  allowIps: string;
};

const TOKEN_STATUS_LABEL: Record<number, string> = { 1: "启用", 2: "禁用", 3: "过期" };
const TOKEN_STATUS_VARIANT: Record<number, string> = { 1: "green", 2: "orange", 3: "red" };

/**
 * API 令牌：签发 sk- 密钥供网关调用。完整密钥只在创建成功那一刻返回一次，
 * 之后列表仅显示掩码，因此创建后需要立即复制保存。
 * 令牌记在「当前租户」里：同一账号在不同租户各有一套令牌，切租户后列表与扣费额度都跟着换。
 */
export default function KeysPage() {
  const { message, modal } = App.useApp();
  const { me } = useSession();
  const perUnit = useQuotaPerUnit();
  const [rows, setRows] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TokenRow | null>(null);
  const [plainKey, setPlainKey] = useState("");
  const [form] = Form.useForm<TokenValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api<TokenRow[]>("/gateway/tokens");
      if (payload.code === 0) setRows(payload.data ?? []);
      else message.error(payload.message || "令牌列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    form.resetFields();
    form.setFieldsValue({
      group: "default",
      unlimitedQuota: false,
      remainQuota: perUnit,
      modelLimitsOn: false,
    });
    setCreating(true);
  };

  const openEdit = (row: TokenRow) => {
    form.resetFields();
    form.setFieldsValue({
      name: row.name,
      group: row.group,
      unlimitedQuota: row.unlimitedQuota,
      remainQuota: row.remainQuota,
      modelLimitsOn: row.modelLimitsOn,
      modelLimits: row.modelLimits,
      allowIps: row.allowIps,
    });
    setEditing(row);
  };

  const buildBody = (values: TokenValues) => {
    const body: Record<string, unknown> = {
      name: values.name,
      group: values.group,
      unlimitedQuota: values.unlimitedQuota,
      modelLimitsOn: values.modelLimitsOn,
      modelLimits: values.modelLimits ?? "",
      allowIps: values.allowIps ?? "",
    };
    if (!values.unlimitedQuota) body.remainQuota = Math.trunc(values.remainQuota ?? 0);
    if (editing) {
      // 只在填了天数时才动有效期；0 ＝「改成永不过期」（留空才是不修改），否则这个方向去不回
      if (values.validDays !== undefined && values.validDays >= 0) {
        body.expiredAt =
          values.validDays === 0
            ? -1
            : Math.floor(Date.now() / 1000) + values.validDays * 86400;
      }
    } else {
      body.expiredAt =
        values.validDays && values.validDays > 0
          ? Math.floor(Date.now() / 1000) + values.validDays * 86400
          : -1;
    }
    return body;
  };

  const submit = async () => {
    const values = await form.validateFields();
    const body = buildBody(values);
    const payload = editing
      ? await api(`/gateway/tokens/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
      : await postJson<TokenRow & { key: string }>("/gateway/tokens", body);
    if (payload.code !== 0) {
      message.error(payload.message);
      return;
    }
    if (editing) {
      message.success("令牌已更新");
    } else {
      const created = payload.data as (TokenRow & { key: string }) | null;
      setPlainKey(created?.key ?? "");
    }
    setCreating(false);
    setEditing(null);
    await load();
  };

  const setStatus = async (row: TokenRow, status: number) => {
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

  const remove = (row: TokenRow) => {
    modal.confirm({
      title: `删除令牌 ${row.name || row.keyMasked}`,
      content: "删除后该密钥立即失效，已产生的用量记录仍会保留。",
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

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success("密钥已复制");
    } catch {
      message.warning("浏览器拒绝了剪贴板访问，请手动复制");
    }
  };

  return (
    <>
      <PageHero
        title="API 令牌"
        desc={
          me?.tenantId
            ? `用 sk- 密钥调用网关：OpenAI 兼容协议指向 ${GATEWAY_BASE_URL}/v1/chat/completions，Anthropic 协议指向 ${GATEWAY_BASE_URL}/v1/messages。当前列表是 ${me.tenantName} 这个租户里的令牌。`
            : `用 sk- 密钥调用网关：OpenAI 兼容协议指向 ${GATEWAY_BASE_URL}/v1/chat/completions，Anthropic 协议指向 ${GATEWAY_BASE_URL}/v1/messages。令牌要记在租户里才知道扣谁的额度，先创建或加入租户。`
        }
      />

      {plainKey ? (
        <Notice variant="success">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span>新密钥（仅此一次完整展示，请立即保存）：</span>
            <span className="mono" style={{ fontWeight: 600 }}>
              {plainKey}
            </span>
            <Button size="small" icon={<CopyOutlined />} onClick={() => void copy(plainKey)}>
              复制
            </Button>
            <Button size="small" type="text" onClick={() => setPlainKey("")}>
              我已保存
            </Button>
          </div>
        </Notice>
      ) : null}

      <Panel
        title="我的令牌"
        titleBadge={
          <span className="text-12 muted">
            共 {rows.length} 个 · 启用 {rows.filter((row) => row.status === 1).length} 个
          </span>
        }
        extra={
          // 令牌必须落在一个租户里才知道扣谁的额度：没有当前租户时不渲染创建入口（接口同样拒绝）
          me?.tenantId ? (
            <Button type="primary" onClick={openCreate}>
              创建令牌
            </Button>
          ) : null
        }
      >
        {!me?.tenantId ? (
          <Notice variant="warn">
            <span style={{ marginTop: 0, display: "block" }}>
              这个账号还没有归属租户，暂时不能签发令牌：额度、令牌与用量都记在「账号在某个租户里」
              这份身份上。请用页面右上角的「创建或加入租户」先落到一个租户里。
            </span>
          </Notice>
        ) : null}
        <div className="table-wrap">
          <Table<TokenRow>
            rowKey="id"
            size="middle"
            loading={loading}
            dataSource={rows}
            pagination={tablePagination}
            locale={{
              emptyText: (
                <EmptyState
                  icon="🔑"
                  text={
                    me?.tenantId
                      ? `在 ${me.tenantName} 里还没有令牌，先创建一个 sk- 密钥`
                      : "还没有令牌"
                  }
                />
              ),
            }}
            columns={[
              { title: "ID", width: 60, render: (_, row) => <span className="mono">{row.id}</span> },
              {
                title: "名称 / 密钥",
                width: 240,
                render: (_, row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.name || "未命名"}</div>
                    <div className="mono text-12 muted">{row.keyMasked}</div>
                  </div>
                ),
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
                width: 170,
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
                width: 160,
                render: (_, row) =>
                  row.modelLimitsOn ? (
                    <span className="mono text-12">{row.modelLimits || "（未填）"}</span>
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
                render: (_, row) => (
                  <span className="text-12">
                    {row.accessedAt > 0
                      ? new Date(row.accessedAt * 1000).toLocaleString("zh-CN", { hour12: false })
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
                  <div>
                    <span className="muted">调用方式：</span>
                    <span className="mono">Authorization: Bearer sk-…</span>
                  </div>
                </div>
              ),
            }}
          />
        </div>
      </Panel>

      <Modal
        title={editing ? `编辑令牌 · ${editing.name || editing.keyMasked}` : "创建令牌"}
        open={creating || Boolean(editing)}
        onCancel={() => {
          setCreating(false);
          setEditing(null);
        }}
        onOk={() => void submit()}
        okText={editing ? "保存" : "创建"}
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
              <Input placeholder="例如：Claude Code / 本机测试" />
            </Form.Item>
            <Form.Item name="group" label="分组" extra="决定可路由的渠道与模型分组">
              <Input placeholder="default" />
            </Form.Item>
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
                    label="额度上限"
                    extra={`${quotaUnitHint(perUnit)}；扣费同时受当前租户给你的可用额度约束`}
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
            <Form.Item
              name="validDays"
              label={editing ? "重设有效期（天）" : "有效期（天）"}
              extra={editing ? "留空表示不修改；填 0 改为永不过期" : "留空表示永不过期"}
            >
              <InputNumber
                min={editing ? 0 : 1}
                style={{ width: "100%" }}
                placeholder="例如 30"
              />
            </Form.Item>
            <Form.Item name="modelLimitsOn" label="限制可用模型" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          <Form.Item
            noStyle
            shouldUpdate={(prev, next) => prev.modelLimitsOn !== next.modelLimitsOn}
          >
            {({ getFieldValue }) =>
              getFieldValue("modelLimitsOn") ? (
                <Form.Item name="modelLimits" label="可用模型" extra="英文逗号分隔">
                  <Input placeholder="gpt-x,claude-y" />
                </Form.Item>
              ) : null
            }
          </Form.Item>
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
