"use client";

import { Input, Table } from "antd";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, PageHero, Panel } from "@/components/ui/panel";
import { api } from "@/lib/api";
import {
  GATEWAY_BASE_URL,
  cnyText,
  previewQuota,
  quotaToCny,
  type ModelRow,
} from "@/lib/gateway";
import { tablePagination } from "@/app/admin/_components/common";

type Catalog = {
  quotaPerUnit: number;
  models: ModelRow[];
};

/**
 * 模型与价格（使用侧只读价目表）：展示网关可路由模型与计费口径，
 * 管理员改价在「管理后台 → 价目表」，此处只负责让用户看清「一次调用花多少」。
 */
export default function ModelsPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const payload = await api<Catalog>("/gateway/models");
      if (!alive) return;
      if (payload.code === 0 && payload.data) setCatalog(payload.data);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const perUnit = catalog?.quotaPerUnit || 500000;
  const rows = useMemo(() => {
    const list = catalog?.models ?? [];
    const text = keyword.trim().toLowerCase();
    if (!text) return list;
    return list.filter(
      (row) =>
        row.modelName.toLowerCase().includes(text) ||
        row.vendorName.toLowerCase().includes(text) ||
        row.tags.toLowerCase().includes(text),
    );
  }, [catalog, keyword]);

  return (
    <>
      <PageHero
        title="模型与价格"
        desc={`网关按 token 计费，输入单价以 元 / 1M tokens 表示；调用地址 ${GATEWAY_BASE_URL}/v1。`}
      />

      {rows.length === 0 && !loading ? (
        <Notice variant="warn">
          价目表为空：请联系管理员在「模型设置 → AIPDD 接入」完成模型目录同步，或在「渠道管理」手动添加渠道。
        </Notice>
      ) : null}

      <Panel
        title="价目表"
        titleBadge={<span className="text-12 muted">共 {rows.length} 个模型</span>}
        extra={
          <Input.Search
            allowClear
            placeholder="搜索模型 / 厂商"
            style={{ width: 260 }}
            onChange={(event) => setKeyword(event.target.value)}
          />
        }
      >
        <div className="table-wrap">
          <Table<ModelRow>
            rowKey="id"
            size="middle"
            loading={loading}
            dataSource={rows}
            pagination={tablePagination}
            locale={{ emptyText: <EmptyState icon="🧮" text="没有匹配的模型" /> }}
            columns={[
              {
                title: "模型",
                width: 260,
                render: (_, row) => (
                  <div>
                    <div className="mono" style={{ fontWeight: 600 }}>
                      {row.modelName}
                    </div>
                    <div className="text-12 muted">{row.vendorName || row.description || "—"}</div>
                  </div>
                ),
              },
              {
                title: "计价",
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
                width: 130,
                render: (_, row) =>
                  row.quotaType === 1 ? (
                    <span className="text-12 muted">—</span>
                  ) : (
                    <span className="mono text-12">{cnyText(row.priceCnyPerMIn)}</span>
                  ),
              },
              {
                title: "输出 ¥/1M",
                width: 130,
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
                title: "缓存 读/写倍率",
                width: 140,
                render: (_, row) => (
                  <span className="mono text-12">
                    {row.cacheReadRatio} / {row.cacheWriteRatio}
                  </span>
                ),
              },
              {
                title: "按次价",
                width: 120,
                render: (_, row) =>
                  row.quotaType === 1 ? (
                    <span className="mono text-12">{cnyText(row.callCnyPrice)}</span>
                  ) : (
                    <span className="text-12 muted">—</span>
                  ),
              },
              {
                title: "1K 输入约",
                width: 150,
                render: (_, row) => {
                  if (row.quotaType === 1) return <span className="text-12 muted">—</span>;
                  const unit = previewQuota(row, perUnit);
                  return (
                    <span className="mono text-12">
                      {cnyText(quotaToCny(unit, perUnit))}
                    </span>
                  );
                },
              },
              {
                title: "可见分组",
                width: 120,
                render: (_, row) => (
                  <span className="text-12">{row.enableGroups || "全部"}</span>
                ),
              },
              {
                title: "端点",
                width: 140,
                render: (_, row) => <span className="text-12 mono">{row.endpoints || "chat"}</span>,
              },
              {
                title: "多模态",
                width: 90,
                render: (_, row) => (
                  <Badge
                    label={row.multimodal ? "支持" : "文本"}
                    variant={row.multimodal ? "violet" : "gray"}
                  />
                ),
              },
            ]}
          />
        </div>
        <div className="text-12 muted" style={{ marginTop: 10 }}>
          按 token 计费的模型，实际扣费 = 上述折算 × 模型倍率（一个模型一个系数，对所有分组统一生效）；
          按次固定价就是标价本身，不乘倍率。额度按「1 元 = {perUnit.toLocaleString("zh-CN")} 额度」入账；
          令牌若设置了模型白名单，则只能调用白名单内的模型。
        </div>
      </Panel>
    </>
  );
}
