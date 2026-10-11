"use client";

import { App, Button, Form, Input, Modal, Select, Table } from "antd";
import { useCallback, useEffect, useState } from "react";
import { tablePagination } from "@/app/admin/_components/common";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, Panel, StatCard, StatGrid } from "@/components/ui/panel";
import { api, postJson } from "@/lib/api";
import { fmtTime } from "@/lib/datetime";
import {
  epochText,
  MEMBER_ROLE_LABEL,
  MEMBER_ROLE_VARIANT,
  poolTxnText,
  quotaText,
  ROLE_LABEL,
  type AccountPage,
  type AccountRow,
  type ConsoleOverview,
  type TenantPoolTxnRow,
} from "@/lib/gateway";
import {
  MEMBER_ROLE_ADMIN,
  MEMBER_ROLE_USER,
  useSession,
} from "@/lib/session";

type CreateValues = {
  username: string;
  password: string;
  displayName?: string;
  memberRole: number;
  quota: number;
};

type JoinValues = {
  username: string;
  memberRole: number;
  quota: number;
};

type EditValues = {
  displayName?: string;
  email?: string;
  memberRole: number;
  status: number;
  password?: string;
};

type QuotaValues = { delta: number; note?: string };

const MEMBER_ROLE_OPTIONS = [
  { value: MEMBER_ROLE_USER, label: MEMBER_ROLE_LABEL[MEMBER_ROLE_USER] },
  { value: MEMBER_ROLE_ADMIN, label: MEMBER_ROLE_LABEL[MEMBER_ROLE_ADMIN] },
];

/**
 * 管理菜单 · 用户管理：租户管理员对自家 User 的管理。
 * 口径与平台侧「账号管理」不同——这里只看本租户的成员，能做三件事：
 * 把人放进来（建号 / 用用户名拉已有账号）、设定他在本租户内的权限（成员 / 管理员）、
 * 在本租户额度池与他之间划拨回收额度；启停的是「他在这家租户里的身份」，
 * 不影响他在别的租户，账号本身能不能登录仍由平台管。
 */
export function ConsoleUsersTab({
  overview,
  onChanged,
}: {
  overview: ConsoleOverview | null;
  onChanged: () => void;
}) {
  const { message, modal } = App.useApp();
  const { me } = useSession();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<AccountPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [txns, setTxns] = useState<TenantPoolTxnRow[]>([]);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [quotaFor, setQuotaFor] = useState<AccountRow | null>(null);
  const [createForm] = Form.useForm<CreateValues>();
  const [joinForm] = Form.useForm<JoinValues>();
  const [editForm] = Form.useForm<EditValues>();
  const [quotaForm] = Form.useForm<QuotaValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (keyword.trim()) query.set("keyword", keyword.trim());
      const payload = await api<AccountPage>(`/console/users?${query.toString()}`);
      if (payload.code === 0 && payload.data) setRows(payload.data);
      else message.error(payload.message || "用户列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, message]);

  const loadTxns = useCallback(async () => {
    const payload = await api<{ list: TenantPoolTxnRow[] }>("/console/pool/txns?pageSize=20");
    if (payload.code === 0 && payload.data) setTxns(payload.data.list);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadTxns();
  }, [loadTxns]);

  const reloadAll = async () => {
    await Promise.all([load(), loadTxns()]);
    onChanged();
  };

  const submitCreate = async () => {
    const values = await createForm.validateFields();
    const payload = await postJson(`/console/users`, {
      username: values.username.trim(),
      password: values.password,
      displayName: values.displayName?.trim() || undefined,
      memberRole: values.memberRole,
      quota: Math.trunc(Number(values.quota ?? 0)),
    });
    if (payload.code !== 0) {
      message.error(payload.message);
      return;
    }
    message.success("用户已创建并入驻本租户");
    setCreating(false);
    createForm.resetFields();
    await reloadAll();
  };

  const submitJoin = async () => {
    const values = await joinForm.validateFields();
    const payload = await postJson(`/console/users/join`, {
      username: values.username.trim(),
      memberRole: values.memberRole,
      quota: Math.trunc(Number(values.quota ?? 0)),
    });
    if (payload.code !== 0) {
      message.error(payload.message);
      return;
    }
    message.success("已加入本租户");
    setJoining(false);
    joinForm.resetFields();
    await reloadAll();
  };

  const submitEdit = async () => {
    const row = editing;
    if (!row) return;
    const values = await editForm.validateFields();
    const identity: Record<string, unknown> = {};
    if (values.status !== row.memberStatus) identity.status = values.status;
    if (values.memberRole !== row.memberRole) identity.memberRole = values.memberRole;
    const displayName = values.displayName?.trim();
    const email = values.email?.trim();
    const profile: Record<string, unknown> = {};
    if (displayName !== row.displayName) profile.displayName = displayName;
    if (email !== row.email) profile.email = email;
    const changes = { ...identity, ...profile };
    if (Object.keys(changes).length > 0) {
      const payload = await api(`/console/users/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      });
      if (payload.code !== 0) {
        message.error(payload.message);
        return;
      }
    }
    if (values.password) {
      const payload = await postJson(`/console/users/${row.id}/password`, {
        password: values.password,
      });
      if (payload.code !== 0) {
        message.error(payload.message);
        return;
      }
    }
    message.success("已保存");
    setEditing(null);
    await reloadAll();
  };

  const submitQuota = async () => {
    const row = quotaFor;
    if (!row) return;
    const values = await quotaForm.validateFields();
    const payload = await postJson(`/console/users/${row.id}/quota`, {
      delta: Math.trunc(Number(values.delta)),
      note: values.note?.trim() || undefined,
    });
    if (payload.code !== 0) {
      message.error(payload.message);
      return;
    }
    message.success(Number(values.delta) > 0 ? "额度已从额度池划拨" : "额度已收回额度池");
    setQuotaFor(null);
    quotaForm.resetFields();
    await reloadAll();
  };

  const toggleStatus = (row: AccountRow) => {
    const next = row.memberStatus === 1 ? 0 : 1;
    modal.confirm({
      title: next === 1 ? `在本租户启用 ${row.username}` : `在本租户停用 ${row.username}`,
      content:
        next === 1
          ? "启用后他回到本租户，可以继续用本租户划给他的额度与令牌。"
          : "停用只收回他在本租户里的身份：这个租户的令牌立即失效，他在别的租户不受影响。",
      okText: next === 1 ? "确认启用" : "确认停用",
      okButtonProps: next === 1 ? undefined : { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const payload = await api(`/console/users/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: next }),
        });
        if (payload.code !== 0) {
          message.error(payload.message);
          return;
        }
        message.success(next === 1 ? "已启用" : "已停用");
        await reloadAll();
      },
    });
  };

  const setRole = (row: AccountRow, memberRole: number) => {
    const isAdmin = memberRole === MEMBER_ROLE_ADMIN;
    modal.confirm({
      title: isAdmin ? `把 ${row.username} 设为本租户管理员` : `把 ${row.username} 降为成员`,
      content: isAdmin
        ? "管理员可以多一个管理入口：建号 / 拉人、启停成员、设定租户内权限、划拨与回收额度、看本租户模型使用记录。"
        : "降为成员后，他只剩建自己的令牌、看价目表与自己的用量；已经签发的令牌仍可用。",
      okText: "确认",
      okButtonProps: isAdmin ? undefined : { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const payload = await api(`/console/users/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ memberRole }),
        });
        if (payload.code !== 0) {
          message.error(payload.message);
          return;
        }
        message.success("已更新租户内权限");
        await reloadAll();
      },
    });
  };

  const openEdit = (row: AccountRow) => {
    editForm.setFieldsValue({
      displayName: row.displayName,
      email: row.email,
      memberRole: row.memberRole ?? MEMBER_ROLE_USER,
      status: row.memberStatus ?? 1,
      password: undefined,
    });
    setEditing(row);
  };

  return (
    <>
      <StatGrid>
        <StatCard
          label="额度池余量"
          value={quotaText(overview?.quotaPool ?? 0)}
          hint="订购额度包到账、平台划拨都进这里"
          icon="🏦"
        />
        <StatCard
          label="已分配给用户"
          value={quotaText(overview?.allocatedQuota ?? 0)}
          hint={`共 ${overview?.memberCount ?? 0} 个成员 · ${overview?.adminCount ?? 0} 个管理员`}
          icon="👥"
        />
        <StatCard
          label="用户已消耗"
          value={quotaText(overview?.consumedQuota ?? 0)}
          hint="按调用实时累计，不回收"
          icon="📈"
        />
        <StatCard
          label="软件服务到期"
          value={overview?.expiresAt ? epochText(overview.expiresAt) : "未订阅"}
          hint="续订订阅后自动往后顺延"
          icon="🎫"
        />
      </StatGrid>

      <div style={{ marginTop: 16 }}>
        <Panel title="本租户用户"
          titleBadge={
            <span className="text-12 muted">
              共 {rows?.total ?? 0} 个用户 · 额度从上方额度池划拨 · 租户内权限只分「成员 / 管理员」两档
            </span>
          }
          extra={
            <div style={{ display: "flex", gap: 8 }}>
              <Input.Search
                allowClear
                placeholder="搜索用户名 / 昵称"
                style={{ width: 220 }}
                onSearch={(value) => {
                  setPage(1);
                  setKeyword(value);
                }}
              />
              <Button
                onClick={() => {
                  joinForm.resetFields();
                  setJoining(true);
                }}
              >
                拉已有账号加入
              </Button>
              <Button
                type="primary"
                onClick={() => {
                  createForm.resetFields();
                  setCreating(true);
                }}
              >
                新建用户
              </Button>
            </div>
          }
        >
          {overview && overview.quotaPool <= 0 ? (
            <Notice variant="info">
              额度池已无余量，新的分配会被拒绝。可在「设置 → 订购管理」订购额度包，或联系平台管理员划拨。
            </Notice>
          ) : null}
          <div className="table-wrap">
            <Table<AccountRow>
              rowKey="id"
              size="middle"
              loading={loading}
              dataSource={rows?.list ?? []}
              locale={{ emptyText: <EmptyState icon="👥" text="还没有用户，先建一个账号" /> }}
              pagination={{
                ...tablePagination,
                current: page,
                pageSize,
                total: rows?.total ?? 0,
                onChange: (nextPage, nextSize) => {
                  setPage(nextPage);
                  setPageSize(nextSize);
                },
              }}
              columns={[
                { title: "ID", width: 70, render: (_, row) => <span className="mono">{row.id}</span> },
                {
                  title: "账号",
                  width: 200,
                  render: (_, row) => (
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {row.displayName || row.username}
                        {row.id === me?.id ? <span className="text-12 muted">（你）</span> : null}
                      </div>
                      <div className="text-12 muted mono">{row.username}</div>
                    </div>
                  ),
                },
                {
                  title: "租户内权限",
                  width: 110,
                  render: (_, row) => (
                    <Badge
                      label={MEMBER_ROLE_LABEL[row.memberRole ?? 0] ?? "成员"}
                      variant={MEMBER_ROLE_VARIANT[row.memberRole ?? 0] ?? "gray"}
                    />
                  ),
                },
                {
                  title: "在本租户",
                  width: 130,
                  render: (_, row) => (
                    <div>
                      <Badge
                        label={row.memberStatus === 0 ? "已停用" : "正常"}
                        variant={row.memberStatus === 0 ? "gray" : "green"}
                      />
                      {row.status === 0 ? (
                        <div className="text-12 muted">账号已被平台停用</div>
                      ) : row.role >= 10 ? (
                        <div className="text-12 muted">{ROLE_LABEL[row.role]}</div>
                      ) : null}
                    </div>
                  ),
                },
                {
                  title: "本租户给的额度",
                  width: 180,
                  render: (_, row) => (
                    <div>
                      <span className="mono">{quotaText(row.quota ?? 0)}</span>
                      <div className="text-12 muted">
                        已用 {quotaText(row.usedQuota ?? 0)} · {row.requestCount ?? 0} 次
                      </div>
                    </div>
                  ),
                },
                {
                  title: "最近登录",
                  width: 150,
                  render: (_, row) => (
                    <span className="text-12 muted">
                      {row.lastLoginAt ? epochText(row.lastLoginAt) : "从未登录"}
                    </span>
                  ),
                },
                {
                  title: "操作",
                  width: 300,
                  render: (_, row) => (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <Button size="small" onClick={() => openEdit(row)}>
                        编辑
                      </Button>
                      <Button
                        size="small"
                        onClick={() => {
                          quotaForm.resetFields();
                          setQuotaFor(row);
                        }}
                      >
                        划拨额度
                      </Button>
                      <Button
                        size="small"
                        onClick={() =>
                          setRole(row, (row.memberRole ?? MEMBER_ROLE_USER) === MEMBER_ROLE_ADMIN ? MEMBER_ROLE_USER : MEMBER_ROLE_ADMIN)
                        }
                      >
                        {(row.memberRole ?? MEMBER_ROLE_USER) === MEMBER_ROLE_ADMIN ? "降为成员" : "设为管理员"}
                      </Button>
                      <Button
                        size="small"
                        danger={row.memberStatus !== 0}
                        onClick={() => toggleStatus(row)}
                      >
                        {row.memberStatus === 0 ? "在本租户启用" : "在本租户停用"}
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </Panel>
      </div>

      <div style={{ marginTop: 16 }}>
        <Panel title="额度池流水"
          titleBadge={<span className="text-12 muted">平台划拨 / 订购到账 / 对用户发放与回收，逐笔留痕</span>}
          extra={
            <Button size="small" onClick={() => void loadTxns()}>
              刷新
            </Button>
          }
        >
          <div className="table-wrap">
            <Table<TenantPoolTxnRow>
              rowKey="id"
              size="small"
              dataSource={txns}
              pagination={{ ...tablePagination, pageSize: 10 }}
              locale={{ emptyText: <EmptyState icon="🧾" text="暂无额度池流水" /> }}
              columns={[
                { title: "时间", width: 170, render: (_, row) => <span className="text-12 muted">{fmtTime(row.createdAt)}</span> },
                {
                  title: "变动",
                  width: 140,
                  render: (_, row) => (
                    <span className="mono" style={{ color: row.delta >= 0 ? "#1677ff" : "#d4380d" }}>
                      {row.delta >= 0 ? "+" : ""}
                      {quotaText(row.delta)}
                    </span>
                  ),
                },
                { title: "变动后余量", width: 140, render: (_, row) => <span className="mono">{quotaText(row.quotaAfter)}</span> },
                { title: "说明", render: (_, row) => <span className="text-12">{poolTxnText(row.note)}</span> },
              ]}
            />
          </div>
        </Panel>
      </div>

      <Modal
        title="新建用户"
        open={creating}
        onCancel={() => setCreating(false)}
        onOk={() => void submitCreate()}
        okText="创建"
        cancelText="取消"
        destroyOnHidden
      >
        <Form
          form={createForm}
          layout="vertical"
          preserve={false}
          initialValues={{ memberRole: MEMBER_ROLE_USER, quota: 0 }}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[
              { required: true, whitespace: true, message: "请输入用户名" },
              { pattern: /^[A-Za-z0-9_@.-]{3,20}$/, message: "3-20 位字母、数字或 _ @ . -" },
            ]}
          >
            <Input placeholder="登录账号" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[
              { required: true, message: "请输入初始密码" },
              { min: 8, max: 64, message: "密码长度需为 8-64 位" },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="displayName" label="昵称">
            <Input placeholder="留空则与用户名相同" />
          </Form.Item>
          <Form.Item name="memberRole" label="租户内权限">
            <Select options={MEMBER_ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="quota"
            label="初始额度"
            extra={
              overview
                ? `从本租户额度池划拨，池内当前 ${quotaText(overview.quotaPool)} quota`
                : "从本租户额度池划拨"
            }
          >
            <Input type="number" min={0} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="拉已有账号加入本租户"
        open={joining}
        onCancel={() => setJoining(false)}
        onOk={() => void submitJoin()}
        okText="加入本租户"
        cancelText="取消"
        destroyOnHidden
      >
        <Form
          form={joinForm}
          layout="vertical"
          preserve={false}
          initialValues={{ memberRole: MEMBER_ROLE_USER, quota: 0 }}
        >
          <Form.Item
            name="username"
            label="对方用户名"
            extra="对方不用重新注册：加入后在顶栏切到本租户，用的就是本租户划的额度"
            rules={[{ required: true, whitespace: true, message: "请输入对方的用户名" }]}
          >
            <Input placeholder="已注册过的账号" autoComplete="off" />
          </Form.Item>
          <Form.Item name="memberRole" label="租户内权限">
            <Select options={MEMBER_ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="quota"
            label="入驻额度"
            extra={
              overview
                ? `从本租户额度池划拨，池内当前 ${quotaText(overview.quotaPool)} quota`
                : "从本租户额度池划拨"
            }
          >
            <Input type="number" min={0} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`编辑用户 ${editing?.username ?? ""}`}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={() => void submitEdit()}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical" preserve={false}>
          <Form.Item name="displayName" label="昵称">
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ type: "email", message: "邮箱格式不正确" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="memberRole" label="租户内权限">
            <Select options={MEMBER_ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="status"
            label="在本租户的身份"
            extra="停用只收回他在这家租户里的身份与令牌，不影响别的租户"
          >
            <Select
              options={[
                { value: 1, label: "正常" },
                { value: 0, label: "已停用" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="password"
            label="重置密码"
            extra="留空表示不修改密码；密码是账号级的，改了对别的租户也生效"
            rules={[{ min: 8, max: 64, message: "密码长度需为 8-64 位" }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`划拨额度 · ${quotaFor?.displayName || quotaFor?.username || ""}`}
        open={Boolean(quotaFor)}
        onCancel={() => setQuotaFor(null)}
        onOk={() => void submitQuota()}
        okText="确认调整"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={quotaForm} layout="vertical" preserve={false}>
          <Form.Item
            name="delta"
            label="变动额度"
            extra={
              quotaFor
                ? `该用户在本租户当前 ${quotaText(quotaFor.quota ?? 0)} quota，本租户额度池余量 ${quotaText(overview?.quotaPool ?? 0)} quota`
                : undefined
            }
            rules={[{ required: true, message: "请输入变动额度" }]}
          >
            <Input type="number" placeholder="正数=从池里发放，负数=收回池里" />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="例如：研发组月度预算 / 离职回收" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
