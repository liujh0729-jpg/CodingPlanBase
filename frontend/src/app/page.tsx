"use client";

import { CopyOutlined } from "@ant-design/icons";
import { App, Button, Table } from "antd";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  EmptyState,
  Notice,
  PageHero,
  Panel,
  StatCard,
  StatGrid,
} from "@/components/ui/panel";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/datetime";
import {
  GATEWAY_BASE_URL,
  LOG_TYPE_LABEL,
  LOG_TYPE_VARIANT,
  quotaText,
  quotaToCny,
  cnyText,
  type LogRow,
  type ModelRow,
  type TokenRow,
} from "@/lib/gateway";
import { useSession } from "@/lib/session";

type Wallet = {
  /** 额度记在「账号在某个租户里」这份成员身份上：这里就是当前租户给的那一份。 */
  tenantId: number | null;
  tenantName: string;
  quota: number;
  usedQuota: number;
  requestCount: number;
  quotaPerUnit: number;
  usedCny: number;
};

const CURL_EXAMPLE = `curl ${GATEWAY_BASE_URL}/v1/chat/completions \\
  -H "Authorization: Bearer sk-你的令牌" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"<模型名>","messages":[{"role":"user","content":"你好"}]}'`;

type Step = {
  title: string;
  desc: string;
  href: string;
  cta: string;
  /** 需要超管身份的管理动作（对应「系统设置」板块门槛），其他身份不渲染这个入口。 */
  rootOnly?: boolean;
};

const STEPS: Step[] = [
  {
    title: "接入上游模型目录",
    desc: "超级管理员在「系统设置」粘贴 AIPDD API Key，一键拉取全部模型并生成托管渠道。",
    href: "/admin/settings",
    cta: "前往设置",
    rootOnly: true,
  },
  {
    title: "核对计费口径",
    desc: "在「模型与价格」确认价目表；管理员可在后台「价目表」按模型钉住零售价。",
    href: "/models",
    cta: "查看价目表",
  },
  {
    title: "签发调用令牌",
    desc: "在「API 令牌」创建 sk- 密钥，可设额度上限、模型白名单与 IP 白名单。",
    href: "/keys",
    cta: "创建令牌",
  },
  {
    title: "发起第一次调用",
    desc: "任意 OpenAI / Anthropic 兼容客户端指向网关地址即可，按 token 自动计费。",
    href: "/usage",
    cta: "查看用量",
  },
];

export default function Home() {
  const { message } = App.useApp();
  const { me, loading, isRoot } = useSession();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [tokenCount, setTokenCount] = useState(0);
  const [modelCount, setModelCount] = useState(0);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (loading) return;
    let alive = true;
    void (async () => {
      const [walletPayload, tokens, models, logPayload] = await Promise.all([
        api<Wallet>("/gateway/wallet"),
        api<TokenRow[]>("/gateway/tokens"),
        api<{ models: ModelRow[] }>("/gateway/models"),
        api<{ list: LogRow[] }>("/gateway/logs?page=1&pageSize=8"),
      ]);
      if (!alive) return;
      if (walletPayload.code === 0 && walletPayload.data) setWallet(walletPayload.data);
      if (tokens.code === 0) setTokenCount(tokens.data?.length ?? 0);
      if (models.code === 0) setModelCount(models.data?.models.length ?? 0);
      if (logPayload.code === 0) setLogs(logPayload.data?.list ?? []);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [loading]);

  const perUnit = wallet?.quotaPerUnit || 500000;

  // 引导按身份收口：非超管没有「系统设置」这一步，标题步数跟着实际条数走
  const steps = STEPS.filter((step) => !step.rootOnly || isRoot);

  const copyExample = async () => {
    try {
      await navigator.clipboard.writeText(CURL_EXAMPLE);
      message.success("调用示例已复制");
    } catch {
      message.warning("浏览器拒绝了剪贴板访问，请手动复制下方示例");
    }
  };

  return (
    <>
      <PageHero
        title="工作台"
        desc="AI 服务总览：当前租户给你的额度余量、消耗与最近调用。令牌签发与计费口径在各对应栏目完成。"
      />

      {ready && !wallet?.tenantId ? (
        <Notice variant="warn">
          <span style={{ marginTop: 0, display: "block" }}>
            这个账号还没有归属租户：额度、令牌与用量都记在「账号在某个租户里」这份身份上，
            请先用页面右上角的「创建或加入租户」落到一个租户里（自建租户你就是该租户的管理员）。
          </span>
        </Notice>
      ) : null}

      <StatGrid>
        <StatCard
          label="可用额度"
          value={wallet ? quotaText(wallet.quota) : "—"}
          hint={
            wallet?.tenantId
              ? `${wallet.tenantName}给的份额 · ≈ ${cnyText(quotaToCny(wallet.quota, perUnit))}`
              : "还没有租户给你额度"
          }
        />
        <StatCard
          label="已消耗额度"
          value={wallet ? quotaText(wallet.usedQuota) : "—"}
          hint={wallet ? `在本租户内 · ≈ ${cnyText(wallet.usedCny)}` : undefined}
        />
        <StatCard label="累计调用次数" value={ready ? wallet?.requestCount ?? 0 : "—"} hint="在本租户内" />
        <StatCard
          label="我的令牌"
          value={ready ? tokenCount : "—"}
          hint="sk- 开头，仅创建时完整可见 · 归属当前租户"
        />
      </StatGrid>

      <div style={{ marginTop: 16 }}>
        <Panel
          title={`${steps.length} 步接入`}
          titleBadge={
            <span className="text-12 muted">
              当前可路由模型 {modelCount} 个 · 价目表由管理员维护
            </span>
          }
        >
          {ready && modelCount === 0 ? (
            <Notice variant="warn">
              网关还没有可用模型：
              {isRoot
                ? " 请到「系统设置 → AIPDD 接入」粘贴 API Key 完成目录同步。"
                : " 上游接入由超级管理员在「系统设置」完成，请联系超管后再创建令牌。"}
            </Notice>
          ) : null}
          <div className="biz-grid" style={{ marginTop: 12 }}>
            {steps.map((step, index) => (
              <Link key={step.href} href={step.href} className="biz-card">
                <span className="biz-ico">{index + 1}</span>
                <span className="biz-main">
                  <span className="biz-label">{step.title}</span>
                  <span className="biz-hint">{step.desc}</span>
                </span>
                <span
                  className="text-12"
                  style={{ fontWeight: 600, color: "var(--primary-strong)" }}
                >
                  {step.cta} →
                </span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>

      <div style={{ marginTop: 16 }}>
        <Panel
          title="最近调用"
          titleBadge={<span className="text-12 muted">最多展示 8 条</span>}
          extra={
            <Link href="/usage">
              <Button size="small" type="link">
                全部日志
              </Button>
            </Link>
          }
        >
          {logs.length ? (
            <div className="table-wrap">
              <Table<LogRow>
                rowKey="id"
                size="middle"
                dataSource={logs}
                pagination={false}
                columns={[
                  {
                    title: "时间",
                    width: 170,
                    render: (_, row) => (
                      <span className="text-12 muted">{fmtTime(row.createdAt)}</span>
                    ),
                  },
                  {
                    title: "类型",
                    width: 120,
                    render: (_, row) => (
                      <Badge
                        label={LOG_TYPE_LABEL[row.type] || "其他"}
                        variant={LOG_TYPE_VARIANT[row.type] || "gray"}
                      />
                    ),
                  },
                  {
                    title: "模型 / 说明",
                    render: (_, row) => (
                      <span>
                        {row.modelName || row.content || "—"}
                        {row.tokenName ? (
                          <span className="muted text-12"> · 令牌 {row.tokenName}</span>
                        ) : null}
                      </span>
                    ),
                  },
                  {
                    title: "tokens 入/出",
                    width: 140,
                    render: (_, row) => (
                      <span className="mono text-12">
                        {row.promptTokens}/{row.completionTokens}
                      </span>
                    ),
                  },
                  {
                    title: "消耗额度",
                    width: 170,
                    render: (_, row) => (
                      <span className="mono text-12">
                        {quotaText(row.quota)}
                        {row.quota ? ` ≈ ${cnyText(quotaToCny(row.quota, perUnit))}` : ""}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          ) : (
            <EmptyState icon="📊" text={ready ? "还没有调用记录" : "正在加载…"} />
          )}
        </Panel>
      </div>

      <div style={{ marginTop: 16 }}>
        <Panel
          title="调用示例"
          titleBadge={<span className="text-12 muted">OpenAI 兼容协议</span>}
          extra={
            <Button size="small" icon={<CopyOutlined />} onClick={() => void copyExample()}>
              复制
            </Button>
          }
        >
          <pre className="mono text-12" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
            {CURL_EXAMPLE}
          </pre>
          <div className="text-12 muted" style={{ marginTop: 10 }}>
            Anthropic 协议同理指向 <span className="mono">{GATEWAY_BASE_URL}/v1/messages</span>
            ；扣费来源是当前登录账号 <span className="mono">{me?.username}</span>
            在 <span className="mono">{wallet?.tenantName || "当前租户"}</span> 里可用额度。
          </div>
        </Panel>
      </div>
    </>
  );
}
