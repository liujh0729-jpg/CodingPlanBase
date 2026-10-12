"use client";

import { App, Button, Descriptions, Form, Input, Table } from "antd";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, PageHero, Panel } from "@/components/ui/panel";
import { api, postJson } from "@/lib/api";
import { fmtTime } from "@/lib/datetime";
import { siteUrl } from "@/lib/config";
import {
  MEMBER_ROLE_LABEL,
  MEMBER_ROLE_VARIANT,
  ROLE_LABEL,
  ROLE_VARIANT,
  epochText,
  quotaText,
  type TenantBrief,
} from "@/lib/gateway";
import { useSession } from "@/lib/session";

type ChandlerStatus = { enabled: boolean };

/**
 * 账号设置：账号资料、所属租户与登录凭据、Chandler.work 平台账号绑定。
 * 额度与用量都记在「账号在某个租户里」这份成员身份上，所以这里先看当前租户给的那一份，
 * 再看自己在各租户里的份额；软件订购属于租户对平台的交易，收在「设置 → 订购管理」（仅当前租户管理员可见）。
 */
export default function AccountPage() {
  const { message } = App.useApp();
  const { me, loading, logout } = useSession();
  const [chandler, setChandler] = useState<ChandlerStatus | null>(null);
  const [pwdForm] = Form.useForm<{
    oldPassword: string;
    newPassword: string;
    confirm: string;
  }>();
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    void (async () => {
      const payload = await api<ChandlerStatus>("/auth/chandler/status");
      if (payload.code === 0 && payload.data) setChandler(payload.data);
    })();
  }, []);

  // 回调页带 ?chandler=linked|failed&reason=，只在首屏提示一次
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const state = query.get("chandler");
    if (!state) return;
    const reason = decodeURIComponent(query.get("reason") || "");
    setNotice(
      state === "linked"
        ? "Chandler.work 账号已绑定，租户管理员可在「设置 → 订购管理」下单。"
        : `绑定失败：${reason || "平台未返回有效授权"}`,
    );
    window.history.replaceState(null, "", "/account");
  }, []);

  const changePassword = async () => {
    const values = await pwdForm.validateFields();
    setBusy("password");
    try {
      const payload = await postJson("/auth/password", {
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      });
      if (payload.code !== 0) {
        message.error(payload.message);
        return;
      }
      message.success("密码已修改，下次登录请使用新密码");
      pwdForm.resetFields();
    } finally {
      setBusy("");
    }
  };

  /** 绑定平台身份：整站只有这一处发起授权，订购管理需要绑定时引导到这里。 */
  const bindChandler = async () => {
    setBusy("bind");
    try {
      const redirectUri = `${siteUrl}/api/auth/chandler/callback`;
      const payload = await api<{ url: string }>(
        `/auth/chandler/authorize-url?redirectUri=${encodeURIComponent(redirectUri)}&state=bind`,
      );
      if (payload.code !== 0 || !payload.data?.url) {
        message.error(payload.message || "未取得授权地址");
        return;
      }
      window.location.href = payload.data.url;
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <PageHero
        title="账号设置"
        desc="账号资料与登录凭据在这里维护；Chandler.work 绑定在这里完成，订阅、功能买断与额度包由租户管理员在「订购管理」下单。"
        extra={
          <Button onClick={logout} disabled={loading}>
            退出登录
          </Button>
        }
      />

      {notice ? (
        <Notice variant={notice.startsWith("绑定失败") ? "error" : "success"}>
          {notice}
        </Notice>
      ) : null}

      <Panel title="账号信息">
        {loading ? (
          <EmptyState icon="👤" text="正在读取账号信息…" />
        ) : me ? (
          <Descriptions
            column={{ xs: 1, sm: 2, lg: 3 }}
            size="small"
            items={[
              {
                key: "username",
                label: "登录账号",
                children: <span className="mono">{me.username}</span>,
              },
              { key: "displayName", label: "昵称", children: me.displayName || "—" },
              {
                key: "role",
                label: "角色",
                children: (
                  <Badge
                    label={ROLE_LABEL[me.role] || `角色 ${me.role}`}
                    variant={ROLE_VARIANT[me.role] || "gray"}
                  />
                ),
              },
              {
                key: "status",
                label: "状态",
                children: (
                  <Badge
                    label={me.status === 1 ? "正常" : "已停用"}
                    variant={me.status === 1 ? "green" : "red"}
                  />
                ),
              },
              {
                key: "group",
                label: "分组",
                children: <span className="mono">{me.userGroup}</span>,
              },
              { key: "email", label: "邮箱", children: me.email || "未填写" },
              {
                key: "tenant",
                label: "当前租户",
                children: me.tenantId ? (
                  <span>
                    {me.tenantName}
                    <span className="mono text-12 muted">（{me.tenantCode}）</span>
                  </span>
                ) : (
                  <Badge label="未加入租户" variant="orange" />
                ),
              },
              {
                key: "memberRole",
                label: "在本租户的身份",
                children: me.tenantId ? (
                  <Badge
                    label={MEMBER_ROLE_LABEL[me.memberRole] || `权限 ${me.memberRole}`}
                    variant={MEMBER_ROLE_VARIANT[me.memberRole] || "gray"}
                  />
                ) : (
                  <span className="text-12 muted">—</span>
                ),
              },
              {
                key: "quota",
                label: "可用额度",
                children: (
                  <span>
                    <span className="mono">{quotaText(me.quota)}</span>
                    <div className="text-12 muted">
                      {me.tenantId ? "本租户给我的份额" : "还没有租户给我额度"}
                    </div>
                  </span>
                ),
              },
              {
                key: "used",
                label: "累计消耗（本租户）",
                children: <span className="mono">{quotaText(me.usedQuota)}</span>,
              },
              {
                key: "count",
                label: "累计调用（本租户）",
                children: <span className="mono">{me.requestCount}</span>,
              },
              {
                key: "chandler",
                label: "Chandler.work",
                children: me.chandlerLinked ? (
                  <Badge label="已绑定" variant="green" />
                ) : (
                  <Badge label="未绑定" variant="gray" />
                ),
              },
              {
                key: "lastLogin",
                label: "最近登录",
                children: me.lastLoginAt ? epochText(me.lastLoginAt) : "—",
              },
              {
                key: "createdAt",
                label: "注册时间",
                children: fmtTime(me.createdAt),
              },
            ]}
          />
        ) : null}
        <div className="text-12 muted" style={{ marginTop: 8 }}>
          昵称与邮箱：租户里的成员由所在租户管理员在「本租户管理 → 用户管理」维护，平台账号由平台管理员在「账号管理」维护。
          {me?.tenantId
            ? "可用额度是当前这个租户划给我的一份，不足请联系该租户管理员；切到别的租户，额度、令牌与用量都跟着换成那个租户的。"
            : "还没有加入任何租户：用顶部「创建或加入租户」建一个（自己就是该租户的管理员），或输入租户编码加入。"}
        </div>
      </Panel>

      <div style={{ marginTop: 16 }}>
        <Panel
          title="我的租户"
          titleBadge={
            <span className="text-12 muted">
              共 {me?.tenants.length ?? 0} 个 · 一个账号可以属于多个租户，各租户独立记账
            </span>
          }
        >
          {(me?.tenants.length ?? 0) === 0 ? (
            <EmptyState
              icon="🏢"
              text={
                me
                  ? "这个账号还不属于任何租户，调用网关前需要先有租户给它额度。"
                  : "正在读取账号资料…"
              }
            />
          ) : (
            <div className="table-wrap">
              <Table<TenantBrief>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={me?.tenants ?? []}
                columns={[
                  {
                    title: "租户",
                    render: (_row, item) => (
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          {item.name}
                          {item.id === me?.tenantId ? (
                            <span style={{ marginLeft: 6 }}>
                              <Badge label="当前" variant="green" />
                            </span>
                          ) : null}
                        </div>
                        <div className="text-12 muted mono">{item.code}</div>
                      </div>
                    ),
                  },
                  {
                    title: "租户内权限",
                    width: 110,
                    render: (_row, item) => (
                      <Badge
                        label={MEMBER_ROLE_LABEL[item.memberRole] || `权限 ${item.memberRole}`}
                        variant={MEMBER_ROLE_VARIANT[item.memberRole] || "gray"}
                      />
                    ),
                  },
                  {
                    title: "状态",
                    width: 110,
                    render: (_row, item) => (
                      <Badge
                        label={
                          item.memberStatus !== 1
                            ? "本租户内已停用"
                            : item.status === 0
                              ? "租户已停用"
                              : "正常"
                        }
                        variant={
                          item.memberStatus === 1 && item.status !== 0 ? "green" : "gray"
                        }
                      />
                    ),
                  },
                  {
                    title: "可用额度",
                    width: 130,
                    render: (_row, item) => <span className="mono">{quotaText(item.quota)}</span>,
                  },
                  {
                    title: "已用 / 调用",
                    width: 160,
                    render: (
                      _row,
                      item,
                    ) => (
                      <span className="text-12 muted">
                        {quotaText(item.usedQuota)} · {item.requestCount} 次
                      </span>
                    ),
                  },
                  {
                    title: "加入时间",
                    width: 160,
                    render: (_row, item) => (
                      <span className="text-12 muted">{fmtTime(item.joinedAt)}</span>
                    ),
                  },
                ]}
              />
            </div>
          )}
          <div className="text-12 muted" style={{ marginTop: 8 }}>
            要改用另一个租户的额度与令牌，点页面右上角的租户名称切换；加入新租户用「以编码加入其他租户」，前提是知道该租户的编码。
          </div>
        </Panel>
      </div>

      <div style={{ marginTop: 16 }}>
        <Panel
          title="Chandler.work 账号"
          titleBadge={
            me?.chandlerLinked ? (
              <Badge label="已绑定" variant="green" />
            ) : (
              <Badge label="未绑定" variant="orange" />
            )
          }
          extra={
            chandler?.enabled ? (
              <Button loading={busy === "bind"} onClick={() => void bindChandler()}>
                {me?.chandlerLinked ? "重新授权" : "绑定平台账号"}
              </Button>
            ) : null
          }
        >
          {chandler?.enabled ? (
            <Notice variant="info">
              支付需以付款人在 Chandler.work 的身份发起：绑定后本站会把平台身份挂到当前账号，
              租户的订阅与功能权益、额度包到账都记在本租户上。绑定完成后由租户管理员在
              「设置 → 订购管理」下单。
            </Notice>
          ) : (
            <div className="text-12 muted">
              在线支付尚未开通（由管理员在「支付管理 → 支付渠道」开通），当前账号无需绑定平台身份；
              额度由管理员发放——租户用户由本租户管理员从额度池划拨，平台直属账号由平台管理员在
              「账号管理 → 分配额度」发放。
            </div>
          )}
        </Panel>
      </div>

      <div style={{ marginTop: 16 }}>
        <Panel title="修改密码">
          <Form form={pwdForm} layout="vertical" style={{ maxWidth: 420 }}>
            <Form.Item
              name="oldPassword"
              label="当前密码"
              rules={[{ required: true, message: "请输入当前密码" }]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[
                { required: true, message: "请输入新密码" },
                { min: 8, max: 64, message: "密码长度需为 8-64 位" },
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item
              name="confirm"
              label="确认新密码"
              dependencies={["newPassword"]}
              rules={[
                { required: true, message: "请再次输入新密码" },
                ({ getFieldValue }) => ({
                  validator(_rule, value) {
                    if (!value || getFieldValue("newPassword") === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error("两次输入的密码不一致"));
                  },
                }),
              ]}
            >
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Button
              type="primary"
              loading={busy === "password"}
              onClick={() => void changePassword()}
            >
              保存新密码
            </Button>
          </Form>
        </Panel>
      </div>
    </>
  );
}
