"use client";

import { App, Button, Form, Input, Modal, Select, Table } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Panel } from "@/components/ui/panel";
import { api, postJson } from "@/lib/api";
import { fmtTime } from "@/lib/datetime";
import {
  epochText,
  MEMBER_ROLE_LABEL,
  MEMBER_ROLE_VARIANT,
  quotaText,
  ROLE_LABEL,
  ROLE_VARIANT,
  TXN_TYPE_LABEL,
  type AccountPage,
  type AccountRow,
  type TenantOption,
  type QuotaTxnRow,
} from "@/lib/gateway";
import {
  MEMBER_ROLE_ADMIN,
  MEMBER_ROLE_USER,
  ROLE_ADMIN,
  ROLE_ROOT,
  ROLE_USER,
  useSession,
} from "@/lib/session";
import { tablePagination } from "./common";

type CreateValues = {
  username: string;
  password: string;
  displayName?: string;
  role: number;
  tenantId?: number;
  memberRole: number;
  quota: number;
};

type EditValues = {
  displayName?: string;
  email?: string;
  role: number;
  status: number;
  password?: string;
};

type QuotaValues = { tenantId: number; delta: number; note?: string };

/**
 * 账号管理：全平台账号的建号、检索、启停与身份调整。
 * 额度记在「这个人在这家租户里」的成员身份上，同一个人跨租户各有一份，
 * 所以这里看额度必须先点名租户：按租户筛时列里就是那一份，不筛时给全部租户的合计。
 * 租户内的权限（成员 / 管理员）与启停属租户自己那一层（成员侧栏的「本租户管理」），平台只在「租户管理」里开人和补加成员。
 */
export function UsersTab() {
  const { message, modal } = App.useApp();
  const { me, isRoot } = useSession();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState("");
  // 'none'＝只看没有任何租户身份的平台直属账号，数字＝该租户的成员
  const [tenantId, setTenantId] = useState<number | "none" | undefined>();
  const [memberRole, setMemberRole] = useState<number | undefined>();
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [rows, setRows] = useState<AccountPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [quotaFor, setQuotaFor] = useState<AccountRow | null>(null);
  const [txnsFor, setTxnsFor] = useState<AccountRow | null>(null);
  const [createForm] = Form.useForm<CreateValues>();
  const [editForm] = Form.useForm<EditValues>();
  const [quotaForm] = Form.useForm<QuotaValues>();
  // 选了归属租户才谈得上额度：平台直属账号没有成员身份，额度无处可记
  const createTenantId = Form.useWatch("tenantId", createForm);
  const editRole = Form.useWatch("role", editForm) ?? editing?.role ?? ROLE_USER;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (keyword.trim()) query.set("keyword", keyword.trim());
      if (tenantId) query.set("tenantId", String(tenantId));
      // 租户内权限只对「某个租户的成员」有意义，没筛租户时后端也不接这个条件
      if (tenantId && tenantId !== "none" && memberRole) {
        query.set("memberRole", String(memberRole));
      }
      const payload = await api<AccountPage>(`/users?${query.toString()}`);
      if (payload.code === 0 && payload.data) setRows(payload.data);
      else message.error(payload.message || "用户列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, tenantId, memberRole, message]);

  useEffect(() => {
    void load();
  }, [load]);

  // 租户下拉：按租户筛账号、建号时指定归属、发额度点名租户都取自这份清单（只含启用中的租户）
  useEffect(() => {
    void api<TenantOption[]>("/admin/tenants/options").then((payload) => {
      if (payload.code === 0) setTenants(payload.data ?? []);
    });
  }, []);

  // 全局身份只有 普通用户 / 平台管理员 / 超级管理员；「租户管理员」是租户内的角色，不在这里给
  const roleOptions = [
    { value: ROLE_USER, label: ROLE_LABEL[ROLE_USER] },
    { value: ROLE_ADMIN, label: ROLE_LABEL[ROLE_ADMIN] },
    ...(isRoot ? [{ value: ROLE_ROOT, label: ROLE_LABEL[ROLE_ROOT] }] : []),
  ];

  // 「平台直属」与具体租户并列：平台账号（管理员 / 超管）与各租户 User 要能分开查
  const tenantOptions: { value: number | "none"; label: string }[] = [
    { value: "none", label: "平台直属（没有任何租户身份）" },
    ...tenants.map((item) => ({
      value: item.id,
      label: `${item.name}（${item.code}）`,
    })),
  ];

  const scopedTenantId = typeof tenantId === "number" ? tenantId : undefined;
  const tenantName = (id: number) =>
    tenants.find((item) => item.id === id)?.name || `租户 #${id}`;

  /**
   * 行操作的可处置性：后端 adminUpdate / adminGrantQuota 都规定超管账号只能由超管本人处置，
   * 平台管理员点了必然 403 —— 所以这些按钮对超管行根本不渲染（流水是只读的，保留）。
   */
  const canOperate = (row: AccountRow) => isRoot || row.role < ROLE_ROOT;

  const submitCreate = async () => {
    const values = await createForm.validateFields();
    const payload = await postJson("/users", {
      username: values.username.trim(),
      password: values.password,
      displayName: values.displayName?.trim() || undefined,
      role: values.role,
      tenantId: values.tenantId ?? null,
      memberRole: values.memberRole,
      quota: values.tenantId ? Math.trunc(Number(values.quota ?? 0)) : 0,
    });
    if (payload.code !== 0) {
      message.error(payload.message);
      return;
    }
    message.success("账号已创建");
    setCreating(false);
    createForm.resetFields();
    await load();
  };

  const submitEdit = async () => {
    const values = await editForm.validateFields();
    if (!editing) return;
    const payload = await api(`/users/${editing.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        displayName: values.displayName?.trim() || undefined,
        email: values.email?.trim() || undefined,
        role: values.role,
        status: values.status,
        password: values.password || undefined,
      }),
    });
    if (payload.code !== 0) {
      message.error(payload.message);
      return;
    }
    message.success("已保存");
    setEditing(null);
    await load();
  };

  const submitQuota = async () => {
    const values = await quotaForm.validateFields();
    if (!quotaFor) return;
    const payload = await postJson(`/users/${quotaFor.id}/quota`, values);
    if (payload.code !== 0) {
      message.error(payload.message);
      return;
    }
    message.success("额度已调整");
    setQuotaFor(null);
    quotaForm.resetFields();
    await load();
  };

  /** 发额度要先定「在哪个租户里」：默认用当前筛选的租户，只有一个租户身份就直接选上。 */
  const openQuota = (row: AccountRow) => {
    quotaForm.resetFields();
    const preferred =
      scopedTenantId && row.tenants.some((item) => item.id === scopedTenantId)
        ? scopedTenantId
        : row.tenants.length === 1
          ? row.tenants[0].id
          : undefined;
    quotaForm.setFieldsValue({ tenantId: preferred });
    setQuotaFor(row);
  };

  const toggleStatus = (row: AccountRow) => {
    const next = row.status === 1 ? 0 : 1;
    modal.confirm({
      title: next === 1 ? `启用 ${row.username}` : `停用 ${row.username}`,
      content:
        next === 1
          ? "启用后该账号可正常登录并进入其所属的各个租户。"
          : "停用是账号级的：该账号立即无法登录，各租户里已签发的令牌同步失效（网关按账号状态拦截）。",
      okText: next === 1 ? "确认启用" : "确认停用",
      okButtonProps: next === 1 ? undefined : { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const payload = await api(`/users/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: next }),
        });
        if (payload.code !== 0) {
          message.error(payload.message);
          return;
        }
        message.success(next === 1 ? "已启用" : "已停用");
        await load();
      },
    });
  };

  return (
    <>
      <Panel title="账号列表"
        titleBadge={
          <span className="text-12 muted">
            共 {rows?.total ?? 0} 个账号 · 额度单位与人民币换算见「模型设置」
          </span>
        }
        extra={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Input.Search
              allowClear
              placeholder="搜索用户名 / 昵称"
              style={{ width: 220 }}
              onSearch={(value) => {
                setPage(1);
                setKeyword(value);
              }}
            />
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="归属：全部账号"
              style={{ width: 210 }}
              value={tenantId}
              onChange={(value) => {
                setPage(1);
                setTenantId(value);
                // 租户内权限只对具体租户成立，换归属（含切到「平台直属」）就回到「全部」
                setMemberRole(undefined);
              }}
              options={tenantOptions}
            />
            {scopedTenantId ? (
              <Select
                allowClear
                placeholder="租户内权限：全部"
                style={{ width: 150 }}
                value={memberRole}
                onChange={(value) => {
                  setPage(1);
                  setMemberRole(value);
                }}
                options={[
                  { value: MEMBER_ROLE_USER, label: MEMBER_ROLE_LABEL[MEMBER_ROLE_USER] },
                  { value: MEMBER_ROLE_ADMIN, label: MEMBER_ROLE_LABEL[MEMBER_ROLE_ADMIN] },
                ]}
              />
            ) : null}
            <Button
              type="primary"
              onClick={() => {
                createForm.resetFields();
                setCreating(true);
              }}
            >
              新建账号
            </Button>
          </div>
        }
      >
        <div className="table-wrap">
          <Table<AccountRow>
            rowKey="id"
            size="middle"
            loading={loading}
            dataSource={rows?.list ?? []}
            locale={{ emptyText: <EmptyState icon="👥" text="没有匹配的账号" /> }}
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
                width: 190,
                render: (_, row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.displayName || row.username}</div>
                    <div className="text-12 muted mono">{row.username}</div>
                  </div>
                ),
              },
              {
                title: "全局身份",
                width: 120,
                render: (_, row) => (
                  <Badge label={ROLE_LABEL[row.role] || `身份 ${row.role}`} variant={ROLE_VARIANT[row.role]} />
                ),
              },
              {
                title: "状态",
                width: 90,
                render: (_, row) => (
                  <Badge
                    label={row.status === 1 ? "正常" : "已停用"}
                    variant={row.status === 1 ? "green" : "gray"}
                  />
                ),
              },
              {
                title: scopedTenantId ? "在本租户的身份" : "所属租户",
                width: 200,
                render: (_, row) => {
                  if (scopedTenantId) {
                    const member = row.tenants.find((item) => item.id === scopedTenantId);
                    if (!member) return <span className="text-12 muted">—</span>;
                    return (
                      <div>
                        <Badge
                          label={MEMBER_ROLE_LABEL[member.memberRole] ?? "成员"}
                          variant={MEMBER_ROLE_VARIANT[member.memberRole] ?? "gray"}
                        />
                        {member.memberStatus === 0 ? (
                          <div className="text-12 muted">在本租户已停用</div>
                        ) : null}
                      </div>
                    );
                  }
                  if (!row.tenantCount) {
                    return <span className="text-12 muted">平台直属（无租户）</span>;
                  }
                  return (
                    <div>
                      <div className="text-12">{tenantName(row.tenants[0].id)}</div>
                      <div className="text-12 muted">
                        {row.tenantCount > 1 ? `等 ${row.tenantCount} 个租户` : tenantName(row.tenants[0].id)}
                      </div>
                    </div>
                  );
                },
              },
              {
                title: scopedTenantId ? "本租户额度" : "各租户额度合计",
                width: 180,
                render: (_, row) => {
                  const scoped = scopedTenantId
                    ? row.tenants.find((item) => item.id === scopedTenantId)
                    : undefined;
                  const quota = scoped ? scoped.quota : row.tenants.reduce((sum, item) => sum + item.quota, 0);
                  const used = scoped
                    ? scoped.usedQuota
                    : row.tenants.reduce((sum, item) => sum + item.usedQuota, 0);
                  const calls = scoped
                    ? scoped.requestCount
                    : row.tenants.reduce((sum, item) => sum + item.requestCount, 0);
                  if (!row.tenantCount && !scoped) {
                    return <span className="text-12 muted">平台直属账号不记额度</span>;
                  }
                  return (
                    <div>
                      <span className="mono">{quotaText(quota)}</span>
                      <div className="text-12 muted">
                        已用 {quotaText(used)} · {calls} 次
                      </div>
                      {!scoped && row.tenantCount > 1 ? (
                        <div className="text-12 muted">按租户各一份，切租户花自己那一份</div>
                      ) : null}
                    </div>
                  );
                },
              },
              {
                title: "分组",
                width: 110,
                render: (_, row) => <span className="text-12">{row.userGroup || "default"}</span>,
              },
              {
                title: "最近登录",
                width: 170,
                render: (_, row) => (
                  <span className="text-12 muted">
                    {row.lastLoginAt ? epochText(row.lastLoginAt) : "从未登录"}
                  </span>
                ),
              },
              {
                title: "操作",
                width: 260,
                render: (_, row) => (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {canOperate(row) ? (
                      <Button size="small" onClick={() => {
                        editForm.setFieldsValue({
                          displayName: row.displayName,
                          email: row.email,
                          role: row.role,
                          status: row.status,
                          password: undefined,
                        });
                        setEditing(row);
                      }}>
                        编辑
                      </Button>
                    ) : null}
                    {canOperate(row) && row.tenantCount > 0 ? (
                      <Button size="small" onClick={() => openQuota(row)}>
                        分配额度
                      </Button>
                    ) : null}
                    <Button size="small" onClick={() => setTxnsFor(row)}>
                      流水
                    </Button>
                    {canOperate(row) ? (
                      <Button
                        size="small"
                        danger={row.status === 1}
                        disabled={row.id === me?.id}
                        onClick={() => toggleStatus(row)}
                      >
                        {row.status === 1 ? "停用" : "启用"}
                      </Button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <Modal
        title="新建账号"
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
          initialValues={{ role: ROLE_USER, memberRole: MEMBER_ROLE_USER, quota: 0 }}
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
          <Form.Item name="role" label="全局身份" rules={[{ required: true }]} extra="「租户管理员」不是一种全局身份：它在下面用「租户内权限」设定">
            <Select options={roleOptions} />
          </Form.Item>
          <Form.Item
            name="tenantId"
            label="加入租户"
            extra={
              createTenantId
                ? undefined
                : "留空＝平台直属账号（管理员 / 超管这一类）；平台直属账号不记额度，要给额度请先选一个租户"
            }
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="不加入任何租户"
              options={tenantOptions.filter((item) => item.value !== "none")}
            />
          </Form.Item>
          {createTenantId ? (
            <>
              <Form.Item name="memberRole" label="租户内权限">
                <Select
                  options={[
                    { value: MEMBER_ROLE_USER, label: MEMBER_ROLE_LABEL[MEMBER_ROLE_USER] },
                    { value: MEMBER_ROLE_ADMIN, label: MEMBER_ROLE_LABEL[MEMBER_ROLE_ADMIN] },
                  ]}
                />
              </Form.Item>
              <Form.Item
                name="quota"
                label="初始额度"
                extra="单位 quota，0 表示需后续分配；这里是平台直接给这个成员的额度上限，不从该租户额度池里扣"
              >
                <Input type="number" min={0} />
              </Form.Item>
            </>
          ) : null}
        </Form>
      </Modal>

      <Modal
        title={`编辑账号 ${editing?.username ?? ""}`}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={() => void submitEdit()}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical">
          <Form.Item name="displayName" label="昵称">
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ type: "email", message: "邮箱格式不正确" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label="全局身份" extra="不能授予高于自己的身份；超级管理员仅超管本人可调整。租户内的权限请在「租户管理 → 下钻」或该租户里的「用户管理」设定">
            <Select options={roleOptions} />
          </Form.Item>
          <Form.Item
            name="status"
            label="状态"
            extra="账号级启停：停用后他在所有租户里都登不了，各租户的成员身份保留"
          >
            <Select
              options={[
                { value: 1, label: "正常" },
                { value: 0, label: "停用" },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="password"
            label="重置密码"
            extra="留空表示不修改密码"
            rules={[{ min: 8, max: 64, message: "密码长度需为 8-64 位" }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`分配额度 · ${quotaFor?.displayName || quotaFor?.username || ""}`}
        open={Boolean(quotaFor)}
        onCancel={() => setQuotaFor(null)}
        onOk={() => void submitQuota()}
        okText="确认调整"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={quotaForm} layout="vertical" preserve={false}>
          <Form.Item
            name="tenantId"
            label="在哪个租户里"
            extra="额度记在成员身份上：同一个人跨租户各有一份，先点名动哪一份"
            rules={[{ required: true, message: "请选择租户" }]}
          >
            <Select
              placeholder="选择租户"
              options={(quotaFor?.tenants ?? []).map((item) => ({
                value: item.id,
                label: `${item.name}（${item.code}）· 当前 ${quotaText(item.quota)} quota`,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="delta"
            label="变动额度"
            rules={[{ required: true, message: "请输入变动额度" }]}
          >
            <Input type="number" placeholder="正数=分配，负数=扣减" />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="例如：Q4 预算 / 误充回收" />
          </Form.Item>
        </Form>
      </Modal>

      <TxnsModal user={txnsFor} tenantId={scopedTenantId} onClose={() => setTxnsFor(null)} />
    </>
  );
}

/** 额度流水：按「这个人在某个租户里」的账目查看，不筛租户时看他在各租户的全部流水。 */
function TxnsModal({
  user,
  tenantId,
  onClose,
}: {
  user: AccountRow | null;
  tenantId?: number;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<QuotaTxnRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    setLoading(true);
    const query = tenantId ? `&tenantId=${tenantId}` : "";
    void api<{ list: QuotaTxnRow[] }>(`/users/${user.id}/txns?pageSize=50${query}`)
      .then((payload) => {
        if (alive && payload.code === 0) setRows(payload.data?.list ?? []);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user, tenantId]);

  const tenantLabel = (id: number) =>
    user?.tenants.find((item) => item.id === id)?.name || (id ? `租户 #${id}` : "未记租户");

  return (
    <Modal
      title={`额度流水 · ${user?.username ?? ""}`}
      open={Boolean(user)}
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
      width={720}
      destroyOnHidden
    >
      <div className="table-wrap">
        <Table<QuotaTxnRow>
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          pagination={{ ...tablePagination, pageSize: 10 }}
          locale={{ emptyText: <EmptyState icon="🧾" text="暂无额度流水" /> }}
          columns={[
            { title: "时间", width: 160, render: (_, row) => <span className="text-12 muted">{fmtTime(row.createdAt)}</span> },
            {
              title: "租户",
              width: 150,
              render: (_, row) => (
                <span className="text-12">{tenantLabel(row.tenantId ?? 0)}</span>
              ),
            },
            {
              title: "类型",
              width: 110,
              render: (_, row) => <Badge label={TXN_TYPE_LABEL[row.type] || row.type} variant={row.delta >= 0 ? "green" : "orange"} />,
            },
            {
              title: "变动",
              width: 130,
              render: (_, row) => (
                <span className="mono" style={{ color: row.delta >= 0 ? "#1677ff" : "#d4380d" }}>
                  {row.delta >= 0 ? "+" : ""}
                  {quotaText(row.delta)}
                </span>
              ),
            },
            { title: "变动后", width: 130, render: (_, row) => <span className="mono">{quotaText(row.quotaAfter)}</span> },
            { title: "备注", render: (_, row) => <span className="text-12">{row.note || "—"}</span> },
          ]}
        />
      </div>
    </Modal>
  );
}
