"use client";

import { App, Button } from "antd";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PayModal, type PayOrder } from "@/app/_components/pay-modal";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { api, postJson } from "@/lib/api";
import {
  PRODUCT_TYPE_LABEL,
  fenText,
  quotaText,
  type ConsoleOverview,
} from "@/lib/gateway";
import { useSession } from "@/lib/session";

type ChandlerStatus = { enabled: boolean };

type Product = {
  id: string;
  name: string;
  type: string;
  amountFen: number;
  quota?: number;
  serviceDays?: number;
};

/**
 * 订购管理 · 软件订购：租户向平台购买软件能力（订阅 / 功能买断 / 额度包）。
 * 支付以「下单人自己的 Chandler.work 身份」发起，所以只有租户管理员能在这里付款；
 * 到账后额度进本租户额度池、订阅与功能记在租户权益上，由平台侧订单管理核对。
 */
export function ConsoleStoreTab({
  overview,
  overviewError,
  onSettled,
}: {
  overview: ConsoleOverview | null;
  overviewError: string;
  onSettled: () => void;
}) {
  const { message } = App.useApp();
  const { me } = useSession();
  const [status, setStatus] = useState<ChandlerStatus | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [paying, setPaying] = useState<PayOrder | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const [statusPayload, productsPayload] = await Promise.all([
      api<ChandlerStatus>("/auth/chandler/status"),
      api<Product[]>("/pay/products"),
    ]);
    if (statusPayload.code === 0 && statusPayload.data) setStatus(statusPayload.data);
    if (productsPayload.code === 0) setProducts(productsPayload.data ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const enabled = Boolean(status?.enabled);
  const linked = Boolean(me?.chandlerLinked);
  // 平台停用租户后订购入口不再可用（与后端 purchaserTenant 同一口径）
  const purchasable = enabled && linked && overview?.status === 1;

  const buy = async (product: Product) => {
    setBusy(product.id);
    try {
      const created = await postJson<{
        merchantOrderNo: string;
        amountFen: number;
        productName: string;
      }>("/pay/orders", { productId: product.id });
      if (created.code !== 0 || !created.data) {
        message.error(created.message || "下单失败");
        return;
      }
      setPaying({
        merchantOrderNo: created.data.merchantOrderNo,
        productName: created.data.productName || product.name,
        amountFen: created.data.amountFen ?? product.amountFen,
      });
    } finally {
      setBusy("");
    }
  };

  if (!overview) {
    return (
      <Notice variant={overviewError ? "error" : "info"}>
        {overviewError || "正在确认本租户信息…"}
      </Notice>
    );
  }

  return (
    <>
      {status && !enabled ? (
        <Notice variant="warn">
          平台尚未开通在线支付（后台「支付管理 → 支付渠道」）。商品与价格可以先浏览，
          开通后即可在这里自助下单；急需额度请联系平台管理员在「租户管理 → 划拨额度」补充。
        </Notice>
      ) : null}

      {enabled && !linked ? (
        <Notice variant="info">
          支付需以付款人在 Chandler.work 的身份发起：请先前往
          <Link href="/account" style={{ margin: "0 4px" }}>
            账号设置
          </Link>
          完成平台账号绑定，再回到这里下单。
        </Notice>
      ) : null}

      {overview.status !== 1 ? (
        <Notice variant="error">
          本租户已被平台停用，无法下单订购；额度池余额与已有用户仍可正常查看。
        </Notice>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Panel
          title="可购买项"
          titleBadge={
            <span className="text-12 muted">
              商品清单由平台在「支付管理 → 商品与套餐」配置 · 本租户额度池余量 {quotaText(overview.quotaPool)} quota
            </span>
          }
          extra={
            <Button size="small" onClick={() => void load()}>
              刷新
            </Button>
          }
        >
          {products.length ? (
            <div className="biz-grid">
              {products.map((item) => (
                <div key={item.id} className="biz-card">
                  <span className="biz-ico">
                    {PRODUCT_TYPE_LABEL[item.type]?.slice(0, 2) || "商品"}
                  </span>
                  <span className="biz-main">
                    <span className="biz-label">
                      {item.name}
                      <Badge label={PRODUCT_TYPE_LABEL[item.type] || item.type} variant="sky" />
                    </span>
                    <span className="biz-hint">
                      {fenText(item.amountFen)}
                      {item.quota ? ` · 发放 ${quotaText(item.quota)} 额度` : ""}
                      {item.serviceDays ? ` · ${item.serviceDays} 天` : " · 长期有效"}
                    </span>
                  </span>
                  {purchasable ? (
                    <Button
                      size="small"
                      type="primary"
                      loading={busy === item.id}
                      onClick={() => void buy(item)}
                    >
                      购买
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="🧾" text="平台还没有配置可购买项" />
          )}
        </Panel>
      </div>

      <PayModal
        order={paying}
        onClose={() => setPaying(null)}
        onSettled={() => {
          onSettled();
          void load();
        }}
      />
    </>
  );
}
