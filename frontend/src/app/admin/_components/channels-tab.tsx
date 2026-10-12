"use client";

import {
  App,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Table,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { api, postJson } from "@/lib/api";
import {
  CHANNEL_STATUS_LABEL,
  CHANNEL_STATUS_VARIANT,
  quotaText,
  type ChannelPreset,
  type ChannelRow,
} from "@/lib/gateway";
import { tablePagination } from "./common";

type ChannelValues = {
  presetKey?: string;
  type: number;
  name: string;
  key?: string;
  baseUrl: string;
  apiPrefix: string;
  models: string;
  group: string;
  priority: number;
  weight: number;
  autoBan: number;
  modelMapping?: string;
  paramOverride?: string;
  headerOverride?: string;
  testModel?: string;
  tag?: string;
};

/**
 * JSON 覆盖字段的本地校验：后端入库前按同样规则校验（必须是 JSON 对象，
 * 重定向/请求头的值还必须是字符串），这里提前拦住是为了避免填坏了保存时才报错。
 */
function jsonRule(label: string, stringValuesOnly = false) {
  return {
    validator: (_: unknown, value?: string) => {
      const raw = (value || "").trim();
      if (!raw) return Promise.resolve();
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return Promise.reject(new Error(`${label} 不是合法的 JSON`));
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return Promise.reject(new Error(`${label} 必须是 JSON 对象，例如 {"a":"b"}`));
      }
      if (stringValuesOnly) {
        const bad = Object.entries(parsed as Record<string, unknown>).find(
          ([, item]) => typeof item !== "string",
        );
        if (bad) return Promise.reject(new Error(`${label} 的 "${bad[0]}" 值必须是字符串`));
      }
      return Promise.resolve();
    },
  };
}

/**
 * 渠道管理：上游标准模板（OpenAI / DeepSeek / 火山方舟 / 通义 / 智谱 / Anthropic…，
 * 编号与默认地址由后端 /gateway/channels/presets 下发）、从上游拉取模型清单、
 * 拉取后勾选入库价目表并并进本渠道模型清单、
 * 选路池（优先级分层 + 层内权重随机 + 多密钥轮换）、密钥被拒时换 key、
 * 渠道故障时换下一个渠道、连通性测试与自动禁用、模型重定向与参数/请求头覆盖。
 */
export function ChannelsTab() {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<ChannelRow[]>([]);
  const [presets, setPresets] = useState<ChannelPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ChannelRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [pulling, setPulling] = useState(false);
  const [importing, setImporting] = useState<ChannelRow | null>(null);
  const [importList, setImportList] = useState<{ name: string; known: boolean }[]>(
    [],
  );
  const [importPicked, setImportPicked] = useState<string[]>([]);
  const [importPath, setImportPath] = useState("");
  const [pullingList, setPullingList] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [form] = Form.useForm<ChannelValues>();
  const presetKey = Form.useWatch("presetKey", form);
  const pickedPreset = presets.find((item) => item.key === presetKey) || null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [channels, presetList] = await Promise.all([
        api<ChannelRow[]>("/gateway/channels"),
        api<ChannelPreset[]>("/gateway/channels/presets"),
      ]);
      if (channels.code === 0) setRows(channels.data ?? []);
      else message.error(channels.message || "渠道列表加载失败");
      // 模板加载失败不弹错：列表照常可用，只是新建时下拉为空，管理员仍可手填三项
      if (presetList.code === 0) setPresets(presetList.data ?? []);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOfType = (type: number) =>
    presets.find((item) => item.type === type)?.nameZh || `类型 ${type}`;

  const openForm = (row?: ChannelRow) => {
    form.resetFields();
    if (row) {
      form.setFieldsValue({
        presetKey: presets.find((item) => item.type === row.type)?.key,
        type: row.type,
        name: row.name,
        baseUrl: row.baseUrl,
        apiPrefix: row.apiPrefix,
        models: row.models,
        group: row.group,
        priority: row.priority,
        weight: row.weight,
        autoBan: row.autoBan,
        modelMapping: row.modelMapping,
        paramOverride: row.paramOverride,
        headerOverride: row.headerOverride,
        testModel: row.testModel,
        tag: row.tag,
      });
      setEditing(row);
      return;
    }
    const openai = presets.find((item) => item.key === "openai") || null;
    form.setFieldsValue({
      presetKey: openai?.key,
      type: openai?.type ?? 1,
      baseUrl: openai?.baseUrl ?? "",
      apiPrefix: openai?.apiPrefix ?? "/v1",
      group: "default",
      priority: 0,
      weight: 0,
      autoBan: 1,
    });
    setCreating(true);
  };

  /** 换模板＝带出该源的默认编号 / 地址 / 前缀；三项都能手改，接自建中转就覆盖掉。 */
  const applyPreset = (key: string) => {
    const preset = presets.find((item) => item.key === key);
    if (!preset) return;
    form.setFieldsValue({
      type: preset.type,
      baseUrl: preset.baseUrl,
      apiPrefix: preset.apiPrefix,
    });
  };

  const pullModels = async () => {
    if (!editing) return;
    setPulling(true);
    try {
      const payload = await postJson<{ models: string[]; modelsPath: string }>(
        `/gateway/channels/${editing.id}/fetch-models`,
        {},
      );
      if (payload.code !== 0) {
        message.error(payload.message || "上游没有返回模型清单");
        return;
      }
      const models = payload.data?.models ?? [];
      form.setFieldsValue({ models: models.join(",") });
      message.success(`已拉取 ${models.length} 个模型（${payload.data?.modelsPath}）`);
    } finally {
      setPulling(false);
    }
  };

  const submit = async () => {
    const { presetKey: key, ...values } = await form.validateFields();
    const payload = editing
      ? await api(`/gateway/channels/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(values),
        })
      : // 模板名一并提交：地址/前缀/编号留空时由后端按模板兜默认值
        await postJson("/gateway/channels", { ...values, preset: key || undefined });
    if (payload.code !== 0) {
      message.error(payload.message);
      return;
    }
    message.success(editing ? "渠道已更新" : "渠道已创建");
    setEditing(null);
    setCreating(false);
    await load();
  };

  /**
   * 上游清单入库：拉回来的模型直接建进价目表（0 价待定价），并把这个模型名并进本渠道的模型清单。
   * 只在编辑渠道里填 models 是不够的——价目表没这一行时计费按 0 放行，等于白送。
   */
  const openImport = async (row: ChannelRow) => {
    setImporting(row);
    setImportList([]);
    setImportPicked([]);
    setPullingList(true);
    try {
      const [fetched, catalog] = await Promise.all([
        postJson<{ models: string[]; modelsPath: string }>(
          `/gateway/channels/${row.id}/fetch-models`,
          {},
        ),
        api<{ models: { modelName: string }[] }>("/gateway/models"),
      ]);
      if (fetched.code !== 0) {
        message.error(fetched.message || "上游没有返回模型清单");
        setImporting(null);
        return;
      }
      const names = fetched.data?.models ?? [];
      const known = new Set(
        (catalog.data?.models ?? []).map((item) => item.modelName),
      );
      setImportPath(fetched.data?.modelsPath ?? "");
      setImportList(names.map((name) => ({ name, known: known.has(name) })));
      // 默认勾上还没进价目表的那些：已在的重复入库没有意义
      setImportPicked(names.filter((name) => !known.has(name)).slice(0, 500));
    } finally {
      setPullingList(false);
    }
  };

  const submitImport = async () => {
    if (!importing || importPicked.length === 0) return;
    setImportSaving(true);
    try {
      const payload = await postJson<{
        created: number;
        existed: number;
        channelModels: number;
      }>("/gateway/models/import", {
        channelId: importing.id,
        models: importPicked,
      });
      if (payload.code !== 0) {
        message.error(payload.message);
        return;
      }
      message.success(
        `已入库 ${payload.data?.created ?? 0} 个模型（${payload.data?.existed ?? 0} 个原本就在价目表），本渠道模型清单现为 ${payload.data?.channelModels ?? 0} 个`,
      );
      setImporting(null);
      await load();
    } finally {
      setImportSaving(false);
    }
  };

  const setStatus = async (row: ChannelRow, status: number) => {
    const payload = await postJson(`/gateway/channels/${row.id}/status`, { status });
    if (payload.code !== 0) {
      message.error(payload.message);
      return;
    }
    message.success(status === 1 ? "已启用" : "已手动禁用");
    await load();
  };

  const remove = (row: ChannelRow) => {
    modal.confirm({
      title: `删除渠道 ${row.name}`,
      content: "历史用量日志会以快照形式保留该渠道归属，不受删除影响。",
      okText: "确认删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const payload = await api(`/gateway/channels/${row.id}`, { method: "DELETE" });
        if (payload.code !== 0) {
          message.error(payload.message);
          return;
        }
        message.success("渠道已删除");
        await load();
      },
    });
  };

  const test = async (row: ChannelRow) => {
    setTesting(row.id);
    try {
      const payload = await postJson<{
        ok: boolean;
        message: string;
        elapsed: number;
        status: number;
      }>(`/gateway/channels/${row.id}/test`, { model: row.testModel || undefined });
      if (payload.code !== 0) {
        message.error(payload.message);
        return;
      }
      const data = payload.data;
      if (data?.ok) message.success(`测试通过 · ${data.elapsed}ms`);
      else message.error(`测试失败：${data?.message || "上游无有效响应"}`);
      await load();
    } finally {
      setTesting(null);
    }
  };

  const managed = rows.filter((row) => row.isManaged === 1);

  return (
    <>
      {managed.length ? (
        <Notice variant="info">
          托管渠道（由 AIPDD 接入向导创建，{managed.map((row) => row.name).join("、")}）
          的密钥与目录由系统维护；手动渠道可与托管渠道共存，按优先级 / 权重共同选路。
        </Notice>
      ) : null}

      <Panel
        title="渠道列表"
        titleBadge={
          <span className="text-12 muted">
            共 {rows.length} 个 · 启用 {rows.filter((row) => row.status === 1).length} 个
          </span>
        }
        extra={
          <Button type="primary" onClick={() => openForm()}>
            新建渠道
          </Button>
        }
      >
        <div className="table-wrap">
          <Table<ChannelRow>
            rowKey="id"
            size="middle"
            loading={loading}
            dataSource={rows}
            pagination={tablePagination}
            locale={{ emptyText: <EmptyState icon="🔌" text="还没有渠道" /> }}
            columns={[
              { title: "ID", width: 60, render: (_, row) => <span className="mono">{row.id}</span> },
              {
                title: "名称",
                width: 200,
                render: (_, row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {row.name}
                      {row.isManaged === 1 ? (
                        <Badge label="托管" variant="sky" />
                      ) : null}
                    </div>
                    <div className="text-12 muted mono">{row.baseUrl || "—"}</div>
                  </div>
                ),
              },
              {
                title: "类型",
                width: 150,
                render: (_, row) => nameOfType(row.type),
              },
              {
                title: "状态",
                width: 110,
                render: (_, row) => (
                  <Badge
                    label={CHANNEL_STATUS_LABEL[row.status] ?? "未知"}
                    variant={CHANNEL_STATUS_VARIANT[row.status] ?? "gray"}
                  />
                ),
              },
              {
                title: "分组",
                width: 120,
                render: (_, row) => <span className="text-12">{row.group}</span>,
              },
              {
                title: "优先级 / 权重",
                width: 130,
                render: (_, row) => (
                  <span className="mono text-12">
                    {row.priority} / {row.weight}
                  </span>
                ),
              },
              {
                title: "密钥",
                width: 170,
                render: (_, row) => (
                  <div>
                    <span className="mono text-12">{row.keyMasked || "—"}</span>
                    <div className="text-12 muted">{row.keyCount} 个（轮换）</div>
                  </div>
                ),
              },
              {
                title: "模型数",
                width: 90,
                render: (_, row) =>
                  row.models ? row.models.split(",").filter(Boolean).length : "全部",
              },
              {
                title: "响应",
                width: 130,
                render: (_, row) => (
                  <div>
                    <span className="mono text-12">{row.responseTime}ms</span>
                    <div className="text-12 muted">已耗 {quotaText(row.usedQuota)}</div>
                  </div>
                ),
              },
              {
                title: "操作",
                width: 260,
                render: (_, row) => (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Button size="small" onClick={() => openForm(row)}>
                      编辑
                    </Button>
                    <Button
                      size="small"
                      loading={testing === row.id}
                      onClick={() => void test(row)}
                    >
                      测试
                    </Button>
                    <Button size="small" onClick={() => void openImport(row)}>
                      拉取入库
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
                    <span className="muted">上游路径前缀：</span>
                    <span className="mono">{row.apiPrefix || "/v1"}</span>
                  </div>
                  <div>
                    <span className="muted">模型清单：</span>
                    <span className="mono">{row.models || "（空＝按目录全量）"}</span>
                  </div>
                  <div>
                    <span className="muted">模型重定向：</span>
                    <span className="mono">{row.modelMapping || "—"}</span>
                  </div>
                  <div>
                    <span className="muted">参数覆盖：</span>
                    <span className="mono">{row.paramOverride || "—"}</span>
                  </div>
                  <div>
                    <span className="muted">请求头覆盖：</span>
                    <span className="mono">{row.headerOverride || "—"}</span>
                  </div>
                  <div>
                    <span className="muted">测试模型：</span>
                    <span className="mono">{row.testModel || "—"}</span>
                    <span className="muted"> · 自动禁用：</span>
                    {row.autoBan === 1 ? "开启" : "关闭"}
                    {row.tag ? (
                      <>
                        <span className="muted"> · 标签：</span>
                        {row.tag}
                      </>
                    ) : null}
                  </div>
                  {row.remark ? (
                    <div>
                      <span className="muted">最近一次失败（上游报文里的密钥已掩码）：</span>
                      <span className="mono">{row.remark}</span>
                    </div>
                  ) : null}
                </div>
              ),
            }}
          />
        </div>
      </Panel>

      <Modal
        title={editing ? `编辑渠道 · ${editing.name}` : "新建渠道"}
        open={creating || Boolean(editing)}
        onCancel={() => {
          setCreating(false);
          setEditing(null);
        }}
        onOk={() => void submit()}
        okText="保存"
        cancelText="取消"
        width={720}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <div className="form-2col">
            <Form.Item
              name="presetKey"
              label="上游模板"
              extra={
                pickedPreset?.website ? (
                  <a href={pickedPreset.website} target="_blank" rel="noreferrer">
                    到 {pickedPreset.nameEn} 控制台取密钥
                  </a>
                ) : (
                  "选模板带出默认地址与路径前缀；接自建中转选「自定义」"
                )
              }
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="选择上游来源"
                onChange={applyPreset}
                options={presets
                  .filter((item) => item.creatable)
                  .map((item) => ({ value: item.key, label: item.nameZh }))}
              />
            </Form.Item>
            <Form.Item
              name="type"
              label="类型编号"
              extra="沿用 new-api 的渠道编号，由模板带出"
              rules={[{ required: true, message: "请选择上游模板" }]}
            >
              <InputNumber min={1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="name"
              label="渠道名称"
              rules={[{ required: true, whitespace: true, message: "请输入渠道名称" }]}
            >
              <Input placeholder="例如：AIPDD 主账号 / 备用转发" />
            </Form.Item>
            <Form.Item
              name="baseUrl"
              label="Base URL"
              extra="只到域名，不含路径前缀，例如 https://api.example.com"
              rules={[{ required: true, whitespace: true, message: "请输入上游地址" }]}
            >
              <Input placeholder="https://..." />
            </Form.Item>
            <Form.Item
              name="apiPrefix"
              label="上游路径前缀"
              extra="客户端的 /v1/... 会换成这一段：OpenAI /v1、火山 /api/v3、通义 /compatible-mode/v1、智谱 /api/paas/v4"
            >
              <Input placeholder="/v1" />
            </Form.Item>
            <Form.Item name="group" label="分组" extra="与令牌 / 模型的分组匹配，多个用英文逗号分隔">
              <Input placeholder="default" />
            </Form.Item>
            <Form.Item name="priority" label="优先级" extra="数值越大越优先；同层内按权重随机">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="weight" label="权重" extra="全为 0 时按等概率随机">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
          </div>
          <Form.Item
            name="key"
            label="上游密钥"
            rules={
              editing
                ? []
                : [{ required: true, whitespace: true, message: "请输入上游密钥" }]
            }
            extra={
              editing
                ? `当前 ${editing.keyCount} 个（掩码 ${editing.keyMasked}）；留空表示不修改`
                : pickedPreset?.keyHint
                  ? `${pickedPreset.keyHint}；多个密钥换行分隔，将按顺序轮换`
                  : "多个密钥换行分隔，将按顺序轮换"
            }
          >
            <Input.TextArea rows={3} placeholder="sk-...&#10;sk-..." autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="models"
            label="支持模型"
            extra="逗号分隔；留空表示接受该渠道分组下的全部模型"
          >
            <Input.TextArea rows={2} placeholder="gpt-x,claude-y" />
          </Form.Item>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: -16,
              marginBottom: 16,
            }}
          >
            <Button size="small" disabled={!editing} loading={pulling} onClick={() => void pullModels()}>
              从上游拉取模型
            </Button>
            <span className="text-12 muted">
              {editing
                ? "拉取结果只填进表单，点「保存」才写进渠道"
                : "保存后可拉取：上游地址与密钥只在后端与渠道之间往返，不经界面提交"}
            </span>
          </div>
          <div className="form-2col">
            <Form.Item name="testModel" label="测试模型">
              <Input placeholder="留空取模型清单第一项" />
            </Form.Item>
            <Form.Item name="autoBan" label="自动禁用" extra="连通性测试失败，或线上调用被上游判为密钥无效（401/403）时，自动禁用该渠道">
              <Select
                options={[
                  { value: 1, label: "开启" },
                  { value: 0, label: "关闭" },
                ]}
              />
            </Form.Item>
            <Form.Item name="tag" label="标签">
              <Input placeholder="可选，用于分组标识" />
            </Form.Item>
          </div>
          <Form.Item
            name="modelMapping"
            label="模型重定向（JSON）"
            rules={[jsonRule("模型重定向", true)]}
            extra='例如 {"gpt-4o":"gpt-4o-mini"}'
          >
            <Input.TextArea rows={2} placeholder='{"请求模型":"上游模型"}' />
          </Form.Item>
          <div className="form-2col">
            <Form.Item
              name="paramOverride"
              label="参数覆盖（JSON）"
              rules={[jsonRule("参数覆盖")]}
              extra='例如 {"temperature":0.2}'
            >
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item
              name="headerOverride"
              label="请求头覆盖（JSON）"
              rules={[jsonRule("请求头覆盖", true)]}
              extra='例如 {"anthropic-version":"2023-06-01"}'
            >
              <Input.TextArea rows={2} />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <Modal
        title={`拉取上游模型入库 · ${importing?.name || ""}`}
        open={Boolean(importing)}
        width={620}
        onCancel={() => setImporting(null)}
        destroyOnHidden
        footer={[
          <Button
            key="all"
            disabled={importList.every((item) => item.known)}
            onClick={() =>
              setImportPicked(
                importList
                  .filter((item) => !item.known)
                  .map((item) => item.name)
                  .slice(0, 500),
              )
            }
          >
            全选未入库
          </Button>,
          <Button
            key="none"
            disabled={importPicked.length === 0}
            onClick={() => setImportPicked([])}
          >
            清空
          </Button>,
          <Button key="cancel" onClick={() => setImporting(null)}>
            取消
          </Button>,
          <Button
            key="ok"
            type="primary"
            loading={importSaving}
            disabled={importPicked.length === 0}
            onClick={() => void submitImport()}
          >
            入库所选（{importPicked.length}）
          </Button>,
        ]}
      >
        <div className="text-12 muted" style={{ marginBottom: 8 }}>
          {pullingList
            ? "正在读取上游模型清单…"
            : `清单来自 ${importPath || "/v1/models"}。勾中的模型会建进价目表（先落 0 价，等定价或目录同步补价），同时并入本渠道的模型清单——两头都补齐了才调得通。`}
        </div>
        {importList.length === 0 && !pullingList ? (
          <EmptyState icon="📭" text="上游没有返回可识别的模型清单。" />
        ) : (
          <Checkbox.Group
            value={importPicked}
            onChange={(values) => setImportPicked(values as string[])}
            style={{ display: "block", maxHeight: 320, overflowY: "auto" }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              {importList.map((item) => (
                <Checkbox key={item.name} value={item.name} disabled={item.known}>
                  <span className="mono text-12">{item.name}</span>
                  {item.known ? (
                    <span className="text-12 muted"> · 已在价目表</span>
                  ) : null}
                </Checkbox>
              ))}
            </div>
          </Checkbox.Group>
        )}
      </Modal>
    </>
  );
}
