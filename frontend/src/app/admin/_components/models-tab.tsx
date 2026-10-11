"use client";

import { App, Button, Form, Input, InputNumber, Modal, Select, Table, Tooltip } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { api, postJson } from "@/lib/api";
import { cnyText, previewQuota, quotaText, quotaToCny, type ModelRow } from "@/lib/gateway";
import { tablePagination } from "./common";

type ModelValues = {
  quotaType: number;
  modelRatio: number;
  completionRatio: number;
  cacheReadRatio: number;
  cacheWriteRatio: number;
  callCnyPrice: number;
  groupRatio: number;
  enableGroups: string;
  endpoints: string;
  description: string;
};

const PRICE_SOURCE_LABEL: Record<string, string> = {
  catalog: "目录同步",
  manual: "管理员钉价",
  auto: "调用自动生成",
};

const PRICE_SOURCE_VARIANT: Record<string, string> = {
  catalog: "sky",
  manual: "violet",
  auto: "gray",
};

type ModelCatalog = {
  quotaPerUnit: number;
  models: ModelRow[];
};

/**
 * 价目表：金额口径统一为人民币 ——
 * 输入单价为「元 / 1M tokens」，输出与缓存按倍率折算；quotaType=1 走按次固定价。
 * 只有真的改动价格字段（计价方式 / 输入单价 / 输出与缓存倍率 / 按次价）才钉价（priceSource=manual），
 * 钉住的模型可用「恢复目录价」按当前目录快照立刻改回目录口径；备注与端点被同步覆盖、不触发钉价。
 */
export function ModelsTab() {
  const { message, modal } = App.useApp();
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<ModelRow | null>(null);
  const [form] = Form.useForm<ModelValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api<ModelCatalog>("/gateway/models");
      if (payload.code === 0 && payload.data) {
        setCatalog(payload.data);
        setRows(payload.data.models ?? []);
      } else {
        message.error(payload.message || "模型价目表加载失败");
      }
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const payload = await postJson<{ revision: string; models: number }>(
        "/gateway/catalog/sync",
        {},
      );
      if (payload.code !== 0) {
        message.error(payload.message);
        return;
      }
      message.success(`目录已同步：${payload.data?.models ?? 0} 个模型`);
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const openEdit = (row: ModelRow) => {
    form.resetFields();
    form.setFieldsValue({
      quotaType: row.quotaType,
      modelRatio: row.modelRatio,
      completionRatio: row.completionRatio,
      cacheReadRatio: row.cacheReadRatio,
      cacheWriteRatio: row.cacheWriteRatio,
      callCnyPrice: row.callCnyPrice,
      groupRatio: row.groupRatio,
      enableGroups: row.enableGroups,
      endpoints: row.endpoints,
      description: row.description,
    });
    setEditing(row);
  };

  const submit = async () => {
    if (!editing) return;
    const values = await form.validateFields();
    const payload = await api<ModelRow>(`/gateway/models/${editing.id}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    });
    if (payload.code !== 0) {
      message.error(payload.message);
      return;
    }
    message.success(
      (payload.data as ModelRow | null)?.priceSource === "manual"
        ? "定价已保存并钉住，目录同步不会覆盖"
        : "定价已保存：这一行的价格仍由目录同步接管",
    );
    setEditing(null);
    await load();
  };

  /** 恢复目录价：后端按当前目录快照立刻重算这一行并交还同步接管，不等下一次同步跑。 */
  const resetPrice = (row: ModelRow) => {
    modal.confirm({
      title: `恢复目录价 · ${row.modelName}`,
      content:
        "取消钉价，并按当前模型目录快照立刻重算这一行的输入 / 输出 / 缓存倍率与按次价格；此后目录同步继续接管这个模型。快照里没有这个模型时会拒绝，保持现价不动。",
      okText: "恢复目录价",
      cancelText: "再想想",
      onOk: async () => {
        const payload = await api(`/gateway/models/${row.id}/price/reset`, {
          method: "POST",
        });
        if (payload.code !== 0) {
          message.error(payload.message);
          return;
        }
        message.success("已恢复目录价，目录同步重新接管这个模型");
        await load();
      },
    });
  };

  const perUnit = catalog?.quotaPerUnit ?? 500000;

  return (
    <>
      <Notice variant="info">
        计费口径：按 token 的模型，单次费用(元) = (输入 tokens × 输入单价 + 输出 tokens × 输入单价 × 输出倍率 +
        缓存读 × 输入单价 × 缓存读倍率 + 缓存写 × 输入单价 × 缓存写倍率) ÷ 1,000,000 ×
        模型倍率；按次固定价就是标价本身、不乘模型倍率。扣费额度 = 费用 ×{" "}
        {perUnit.toLocaleString("zh-CN")}（1 元）。模型倍率是一个模型一个系数，对所有分组统一生效；
        「可见分组」只决定这个模型出现在哪些分组的模型清单里，不参与算价。
      </Notice>

      <Panel
        title="模型价目表"
        titleBadge={
          <span className="text-12 muted">
            共 {rows.length} 个 · 钉价 {rows.filter((row) => row.priceSource === "manual").length} 个
          </span>
        }
        extra={
          <Button loading={syncing} onClick={() => void sync()}>
            同步模型目录
          </Button>
        }
      >
        <div className="table-wrap">
          <Table<ModelRow>
            rowKey="id"
            size="middle"
            loading={loading}
            dataSource={rows}
            pagination={tablePagination}
            locale={{ emptyText: <EmptyState icon="🧮" text="还没有模型，请先在系统设置里完成 AIPDD 接入或新建渠道" /> }}
            columns={[
              {
                title: "模型",
                width: 240,
                render: (_, row) => (
                  <div>
                    <div className="mono" style={{ fontWeight: 600 }}>
                      {row.modelName}
                    </div>
                    <div className="text-12 muted">
                      {row.vendorName || row.description || "—"}
                    </div>
                  </div>
                ),
              },
              {
                title: "计价方式",
                width: 100,
                render: (_, row) => (
                  <Badge
                    label={row.quotaType === 1 ? "按次" : "按 token"}
                    variant={row.quotaType === 1 ? "orange" : "blue"}
                  />
                ),
              },
              {
                title: "输入 ¥/1M",
                width: 120,
                render: (_, row) =>
                  row.quotaType === 1 ? (
                    <span className="text-12 muted">—</span>
                  ) : (
                    <span className="mono text-12">{cnyText(row.priceCnyPerMIn)}</span>
                  ),
              },
              {
                title: "输出 ¥/1M",
                width: 120,
                render: (_, row) =>
                  row.quotaType === 1 ? (
                    <span className="text-12 muted">—</span>
                  ) : (
                    <span className="mono text-12">
                      {cnyText(row.priceCnyPerMOut)}
                    </span>
                  ),
              },
              {
                title: "缓存倍率 读/写",
                width: 130,
                render: (_, row) => (
                  <span className="mono text-12">
                    {row.cacheReadRatio} / {row.cacheWriteRatio}
                  </span>
                ),
              },
              {
                title: "按次价",
                width: 110,
                render: (_, row) =>
                  row.quotaType === 1 ? (
                    <span className="mono text-12">{cnyText(row.callCnyPrice)}</span>
                  ) : (
                    <span className="text-12 muted">—</span>
                  ),
              },
              {
                title: "模型倍率",
                width: 100,
                render: (_, row) => (
                  <Tooltip title="一个模型一个系数，对所有分组统一生效；按次固定价不乘这个倍率">
                    <span className="mono text-12">{row.groupRatio}</span>
                  </Tooltip>
                ),
              },
              {
                title: "1K 输入约",
                width: 130,
                render: (_, row) => {
                  if (row.quotaType === 1) return <span className="text-12 muted">—</span>;
                  const quota = previewQuota(row, perUnit);
                  return (
                    <Tooltip title={`折算 ${quotaText(quota)} 额度`}>
                      <span className="mono text-12">
                        {cnyText(quotaToCny(quota, perUnit))}
                      </span>
                    </Tooltip>
                  );
                },
              },
              {
                title: "可见分组",
                width: 140,
                render: (_, row) => (
                  <span className="text-12">{row.enableGroups || "全部"}</span>
                ),
              },
              {
                title: "定价来源",
                width: 130,
                render: (_, row) => (
                  <Badge
                    label={PRICE_SOURCE_LABEL[row.priceSource] || row.priceSource || "未定价"}
                    variant={PRICE_SOURCE_VARIANT[row.priceSource] || "gray"}
                  />
                ),
              },
              {
                title: "操作",
                width: 170,
                render: (_, row) => (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button size="small" onClick={() => openEdit(row)}>
                      定价
                    </Button>
                    {row.priceSource === "manual" ? (
                      <Button size="small" onClick={() => resetPrice(row)}>
                        恢复目录价
                      </Button>
                    ) : null}
                  </div>
                ),
              },
            ]}
            expandable={{
              expandedRowRender: (row) => (
                <div className="text-12" style={{ display: "grid", gap: 4 }}>
                  <div>
                    <span className="muted">能力 / 端点：</span>
                    <span className="mono">{row.endpoints || "chat"}</span>
                    <span className="muted"> · 多模态：</span>
                    {row.multimodal ? "是" : "否"}
                  </div>
                  <div>
                    <span className="muted">说明：</span>
                    {row.description || "—"}
                  </div>
                  <div>
                    <span className="muted">标签：</span>
                    {row.tags || "—"}
                  </div>
                </div>
              ),
            }}
          />
        </div>
      </Panel>

      <Modal
        title={editing ? `定价 · ${editing.modelName}` : "定价"}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={() => void submit()}
        okText="保存定价"
        cancelText="取消"
        width={680}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <div className="form-2col">
            <Form.Item name="quotaType" label="计价方式">
              <Select
                options={[
                  { value: 0, label: "按 token" },
                  { value: 1, label: "按次固定价" },
                ]}
              />
            </Form.Item>
            <Form.Item
              name="groupRatio"
              label="模型倍率"
              extra="一个模型一个系数，对所有分组统一生效；>1 加价，<1 折扣。按次固定价不乘这个倍率"
            >
              <InputNumber min={0} step={0.1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="modelRatio"
              label="输入单价（元 / 1M tokens）"
              extra="输出与缓存以倍率基于此价折算"
            >
              <InputNumber min={0} step={0.1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="completionRatio" label="输出倍率">
              <InputNumber min={0} step={0.1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="cacheReadRatio" label="缓存读倍率">
              <InputNumber min={0} step={0.05} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="cacheWriteRatio" label="缓存写倍率">
              <InputNumber min={0} step={0.05} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="callCnyPrice" label="按次价格（元）" extra="仅「按次固定价」生效">
              <InputNumber min={0} step={0.001} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="endpoints"
              label="端点"
              extra="英文逗号分隔，例如 chat,responses；这一项与备注都会被目录同步覆盖"
            >
              <Input placeholder="chat" />
            </Form.Item>
          </div>
          <Form.Item name="enableGroups" label="可用分组" extra="留空表示所有分组可用">
            <Input placeholder="default, vip" />
          </Form.Item>
          <Form.Item name="description" label="备注说明" extra="目录同步会用上游说明覆盖这里；只改备注不会钉价">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
