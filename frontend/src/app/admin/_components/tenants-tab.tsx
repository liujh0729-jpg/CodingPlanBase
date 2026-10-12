"use client";

import { App, Button, Form, Input, Modal, Select, Space, Table } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Notice, Panel } from "@/components/ui/panel";
import { api, postJson } from "@/lib/api";
import { fmtTime } from "@/lib/datetime";
import {
  ENTITLEMENT_KIND_LABEL,
  MEMBER_ROLE_LABEL,
  MEMBER_ROLE_VARIANT,
  ROLE_LABEL,
  ROLE_VARIANT,
  epochText,
  fenText,
  poolTxnText,
  quotaText,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_VARIANT,
  PRODUCT_TYPE_LABEL,
  type AccountPage,
  type AccountRow,
  type AdminOrderRow,
  type EntitlementRow,
  type TenantPoolTxnRow,
  type TenantRow,
} from "@/lib/gateway";
import { MEMBER_ROLE_ADMIN, MEMBER_ROLE_USER } from "@/lib/session";
import { tablePagination } from "./common";

type TenantPage = {
  list: TenantRow[];
  total: number;
  page: number;
  pageSize: number;
};

type CreateValues = {
  name: string;
  code: string;
  contact?: string;
  remark?: string;
};

type PoolValues = { delta: number; note?: string };

type AdminValues = { username: string; password: string; displayName?: string };

type JoinValues = { username: string; memberRole: number; quota?: number };

const STATUS_OPTIONS = [
  { value: 1, label: "正常" },
  { value: 0, label: "已停用" },
];

const MEMBER_ROLE_OPTIONS = [
  { value: MEMBER_ROLE_USER, label: MEMBER_ROLE_LABEL[MEMBER_ROLE_USER] },
  { value: MEMBER_ROLE_ADMIN, label: MEMBER_ROLE_LABEL[MEMBER_ROLE_ADMIN] },
];

/**
 * 租户管理（平台侧）：系统管理员对租户的全部处置——
 * 开通 / 启停、额度池划拨与回收、开通租户管理员账号，并下钻该租户的成员、软件权益与订购记录。
 * 成员也可以从平台侧补加：把已有账号拉进这个租户（一个账号可同时属于多个租户）。
 */
export function TenantsTab() {
  const { message, modal } = App.useApp();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState<number | undefined>();
  const [rows, setRows] = useState<TenantPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TenantRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [poolFor, setPoolFor] = useState<TenantRow | null>(null);
  const [adminFor, setAdminFor] = useState<TenantRow | null>(null);
  const [detailFor, setDetailFor] = useState<TenantRow | null>(null);
  const [createForm] = Form.useForm<CreateValues>();
  const [editForm] = Form.useForm<CreateValues>();
  const [poolForm] = Form.useForm<PoolValues>();
  const [adminForm] = Form.useForm<AdminValues>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (keyword.trim()) query.set("keyword", keyword.trim());
      if (status !== undefined) query.set("status", String(status));
      const payload = await api<TenantPage>(`/admin/tenants?${query.toString()}`);
      if (payload.code === 0 && payload.data) setRows(payload.data);
      else message.error(payload.message || "租户列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, status, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitCreate = async () => {
    const values = await createForm.validateFields();
    const payload = await postJson<TenantRow>("/admin/tenants", {
      name: values.name.trim(),
      code: values.code.trim(),
      contact: values.contact?.trim() || undefined,
      remark: values.remark?.trim() || undefined,
    });
    if (payload.code !== 0) {
      message.error(payload.message);
      return;
    }
    message.success("租户已开通");
    setCreating(false);
    createForm.resetFields();
    await load();
  };

  const submitEdit = async () => {
    const row = editing;
    if (!row) return;
    const values = await editForm.validateFields();
    const payload = await api(`/admin/tenants/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: values.name.trim(),
        contact: values.contact?.trim() || "",
        remark: values.remark?.trim() || "",
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

  const submitPool = async () => {
    const row = poolFor;
    if (!row) return;
    const values = await poolForm.validateFields();
    const payload = await postJson<{ quotaPool: number }>(
      `/admin/tenants/${row.id}/pool`,
      { delta: Math.trunc(Number(values.delta)), note: values.note?.trim() || undefined },
    );
    if (payload.code !== 0) {
      message.error(payload.message);
      return;
    }
    message.success(Number(values.delta) > 0 ? "已划拨到额度池" : "已从额度池回收");
    setPoolFor(null);
    poolForm.resetFields();
    await load();
  };

  const submitAdmin = async () => {
    const row = adminFor;
    if (!row) return;
    const values = await adminForm.validateFields();
    const payload = await postJson(`/admin/tenants/${row.id}/admins`, {
      username: values.username.trim(),
      password: values.password,
      displayName: values.displayName?.trim() || undefined,
    });
    if (payload.code !== 0) {
      message.error(payload.message);
      return;
    }
    message.success("租户管理员已开通：该账号登录后，前台侧栏会出现「本租户管理」");
    setAdminFor(null);
    adminForm.resetFields();
    await load();
  };

  const toggleStatus = (row: TenantRow) => {
    const next = row.status === 1 ? 0 : 1;
    modal.confirm({
      title: next === 1 ? `启用 ${row.name}` : `停用 ${row.name}`,
      content:
        next === 1
          ? "启用后该租户可正常订购，其下用户可正常调用网关。"
          : "停用后该租户下所有用户的网关调用立即被拦截，租户管理员也无法再订购；额度池与用户数据保留，重新启用即恢复。",
      okText: next === 1 ? "确认启用" : "确认停用",
      okButtonProps: next === 1 ? undefined : { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const payload = await postJson(`/admin/tenants/${row.id}/status`, {
          status: next,
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
      <Notice variant="info">
        口径：租户＝平台交付给 B 端客户的独立工作区。平台在这里管租户（开通、启停、额度池、
        成员与管理员）；租户管理员在自家前台侧栏的「本租户管理」里管自己的人和额度。一个账号可以同时属于多个租户，
        在每个租户里各有一份额度和一档租户内权限（成员 / 管理员）。
      </Notice>

      <Panel title="租户列表"
        titleBadge={
          <span className="text-12 muted">共 {rows?.total ?? 0} 个租户 · 额度单位与人民币换算见「模型设置」</span>
        }
        extra={
          <Space size={8} wrap>
            <Input.Search
              allowClear
              placeholder="搜索名称 / 编码 / 联系人"
              style={{ width: 220 }}
              onSearch={(value) => {
                setPage(1);
                setKeyword(value);
              }}
            />
            <Select
              allowClear
              style={{ width: 130 }}
              placeholder="全部状态"
              value={status}
              onChange={(value) => {
                setPage(1);
                setStatus(value);
              }}
              options={STATUS_OPTIONS}
            />
            <Button
              type="primary"
              onClick={() => {
                createForm.resetFields();
                setCreating(true);
              }}
            >
              开通租户
            </Button>
          </Space>
        }
      >
        <div className="table-wrap">
          <Table<TenantRow>
            rowKey="id"
            size="middle"
            loading={loading}
            dataSource={rows?.list ?? []}
            locale={{ emptyText: <EmptyState icon="🏬" text="还没有租户，先开通一个" /> }}
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
                title: "租户",
                width: 200,
                render: (_, row) => (
                  <div>
                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                    <div className="text-12 muted mono">{row.code}</div>
                  </div>
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
                title: "额度池余量",
                width: 180,
                render: (_, row) => (
                  <div>
                    <span className="mono">{quotaText(row.quotaPool)}</span>
                    <div className="text-12 muted">已消耗 {quotaText(row.usedQuota)}</div>
                  </div>
                ),
              },
              {
                title: "成员数",
                width: 90,
                render: (_, row) => (
                  <span className="mono">{row.memberCount ?? 0}</span>
                ),
              },
              {
                title: "服务到期",
                width: 160,
                render: (_, row) => (
                  <span className="text-12">
                    {row.expiresAt ? epochText(row.expiresAt) : "未订阅"}
                  </span>
                ),
              },
              {
                title: "联系人",
                width: 160,
                render: (_, row) => (
                  <div>
                    <div className="text-12">{row.contact || "—"}</div>
                    <div className="text-12 muted">{fmtTime(row.createdAt)}</div>
                  </div>
                ),
              },
              {
                title: "操作",
                width: 300,
                render: (_, row) => (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Button size="small" onClick={() => setDetailFor(row)}>
                      下钻
                    </Button>
                    <Button size="small" onClick={() => {
                      editForm.setFieldsValue({
                        name: row.name,
                        code: row.code,
                        contact: row.contact,
                        remark: row.remark,
                      });
                      setEditing(row);
                    }}>
                      编辑
                    </Button>
                    <Button size="small" onClick={() => {
                      poolForm.resetFields();
                      setPoolFor(row);
                    }}>
                      划拨额度
                    </Button>
                    <Button size="small" onClick={() => {
                      adminForm.resetFields();
                      setAdminFor(row);
                    }}>
                      开通管理员
                    </Button>
                    <Button
                      size="small"
                      danger={row.status === 1}
                      onClick={() => toggleStatus(row)}
                    >
                      {row.status === 1 ? "停用" : "启用"}
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Panel>

      <Modal
        title="开通租户"
        open={creating}
        onCancel={() => setCreating(false)}
        onOk={() => void submitCreate()}
        okText="开通"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            name="name"
            label="租户名称"
            rules={[{ required: true, whitespace: true, message: "请输入租户名称" }]}
          >
            <Input placeholder="例如：某某科技有限公司" />
          </Form.Item>
          <Form.Item
            name="code"
            label="租户编码"
            extra="用于对账与检索，创建后不再修改"
            rules={[
              { required: true, whitespace: true, message: "请输入租户编码" },
              { pattern: /^[a-z0-9_-]{2,32}$/, message: "2-32 位小写字母、数字或 - _" },
            ]}
          >
            <Input placeholder="例如：acme-cn" autoComplete="off" />
          </Form.Item>
          <Form.Item name="contact" label="联系人">
            <Input placeholder="对接人 / 联系方式" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="商务口径、合同编号等" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`编辑租户 ${editing?.name ?? ""}`}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={() => void submitEdit()}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="name"
            label="租户名称"
            rules={[{ required: true, whitespace: true, message: "请输入租户名称" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="code" label="租户编码" extra="编码不可修改，只作展示">
            <Input disabled className="mono" />
          </Form.Item>
          <Form.Item name="contact" label="联系人">
            <Input />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`额度池划拨 · ${poolFor?.name ?? ""}`}
        open={Boolean(poolFor)}
        onCancel={() => setPoolFor(null)}
        onOk={() => void submitPool()}
        okText="确认调整"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={poolForm} layout="vertical">
          <Form.Item
            name="delta"
            label="变动额度"
            extra={
              poolFor
                ? `池内当前 ${quotaText(poolFor.quotaPool)} quota；租户管理员从这里给自家用户发额度`
                : undefined
            }
            rules={[{ required: true, message: "请输入变动额度" }]}
          >
            <Input type="number" placeholder="正数=划拨，负数=回收" />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="例如：Q4 预算 / 误充回收" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`开通租户管理员 · ${adminFor?.name ?? ""}`}
        open={Boolean(adminFor)}
        onCancel={() => setAdminFor(null)}
        onOk={() => void submitAdmin()}
        okText="开通"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={adminForm} layout="vertical">
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
        </Form>
        <Notice variant="info">
          新建的是一个全局身份为「普通用户」的账号，同时把它加入本租户并把租户内权限设为「管理员」：
          登录后切到这个租户就能看到侧栏的「本租户管理」，从租户额度池给自家成员发额度、管成员。
          额度池仍由平台在这里划拨。
        </Notice>
      </Modal>

      <TenantDetailModal
        tenant={detailFor}
        onClose={() => setDetailFor(null)}
        onChanged={() => void load()}
      />
    </>
  );
}

/** 租户下钻：本体资料 + 成员（可补加）+ 软件权益 + 订购记录 + 额度池流水（都按该租户收口）。 */
function TenantDetailModal({
  tenant,
  onClose,
  onChanged,
}: {
  tenant: TenantRow | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { message, modal } = App.useApp();
  const [entitlements, setEntitlements] = useState<EntitlementRow[]>([]);
  const [orders, setOrders] = useState<AdminOrderRow[]>([]);
  const [txns, setTxns] = useState<TenantPoolTxnRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState<AccountPage | null>(null);
  const [memberPage, setMemberPage] = useState(1);
  const [memberKeyword, setMemberKeyword] = useState("");
  const [memberLoading, setMemberLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinForm] = Form.useForm<JoinValues>();

  const tenantId = tenant?.id ?? 0;

  // 换租户重新打开时回到第一页，别把上一个租户的筛选与页码带过去
  useEffect(() => {
    setMemberPage(1);
    setMemberKeyword("");
  }, [tenantId]);

  const loadMembers = useCallback(async () => {
    if (!tenantId) return;
    setMemberLoading(true);
    try {
      const query = new URLSearchParams({ page: String(memberPage), pageSize: "10" });
      if (memberKeyword.trim()) query.set("keyword", memberKeyword.trim());
      const payload = await api<AccountPage>(
        `/admin/tenants/${tenantId}/users?${query.toString()}`,
      );
      if (payload.code === 0 && payload.data) setMembers(payload.data);
      else message.error(payload.message || "成员列表加载失败");
    } finally {
      setMemberLoading(false);
    }
  }, [tenantId, memberPage, memberKeyword, message]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const submitJoin = async () => {
    const values = await joinForm.validateFields();
    const payload = await postJson(`/admin/tenants/${tenantId}/members`, {
      username: values.username.trim(),
      memberRole: values.memberRole,
      quota: Math.trunc(Number(values.quota ?? 0)),
    });
    if (payload.code !== 0) {
      message.error(payload.message);
      return;
    }
    message.success("已加入该租户");
    setJoining(false);
    joinForm.resetFields();
    await loadMembers();
    onChanged();
  };

  /** 租户内权限只有一档「管理员」能拿到前台侧栏的「本租户管理」那一组；改的是成员身份，不动他的全局账号身份。 */
  const setMemberRole = (row: AccountRow, next: number) => {
    modal.confirm({
      title:
        next === MEMBER_ROLE_ADMIN
          ? `在 ${tenant?.name ?? "该租户"} 设为管理员`
          : `在 ${tenant?.name ?? "该租户"} 降为成员`,
      content:
        next === MEMBER_ROLE_ADMIN
          ? "该成员登录并切到这个租户后，前台侧栏出现「本租户管理」，可管自家成员与额度池分配。"
          : "降为成员后，这个租户的「本租户管理」菜单对他立即消失；他在其他租户里的身份不受影响。",
      okText: "确认",
      cancelText: "取消",
      onOk: async () => {
        const payload = await api(`/admin/tenants/${tenantId}/members/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ memberRole: next }),
        });
        if (payload.code !== 0) {
          message.error(payload.message);
          return;
        }
        message.success("已更新租户内权限");
        await loadMembers();
      },
    });
  };

  const toggleMember = (row: AccountRow) => {
    const next = row.memberStatus === 1 ? 0 : 1;
    modal.confirm({
      title: next === 1 ? `在本租户启用 ${row.username}` : `在本租户停用 ${row.username}`,
      content:
        next === 1
          ? "启用后该成员可在本租户正常使用额度与令牌。"
          : "只停用「在这个租户里」的身份：他切到本租户时立即不能调用网关，本租户给的额度冻结；账号本身与其他租户不受影响。",
      okText: next === 1 ? "确认启用" : "确认停用",
      okButtonProps: next === 1 ? undefined : { danger: true },
      cancelText: "取消",
      onOk: async () => {
        const payload = await api(`/admin/tenants/${tenantId}/members/${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: next }),
        });
        if (payload.code !== 0) {
          message.error(payload.message);
          return;
        }
        message.success(next === 1 ? "已启用" : "已停用");
        await loadMembers();
      },
    });
  };

  useEffect(() => {
    if (!tenant) return;
    let alive = true;
    setLoading(true);
    void Promise.all([
      api<EntitlementRow[]>(`/admin/tenants/${tenant.id}/entitlements`),
      api<{ list: AdminOrderRow[] }>(`/admin/orders?tenantId=${tenant.id}&pageSize=20`),
      api<{ list: TenantPoolTxnRow[] }>(`/admin/tenants/${tenant.id}/txns?pageSize=20`),
    ]).then(([entPayload, orderPayload, txnPayload]) => {
      if (!alive) return;
      if (entPayload.code === 0) setEntitlements(entPayload.data ?? []);
      if (orderPayload.code === 0) setOrders(orderPayload.data?.list ?? []);
      if (txnPayload.code === 0) setTxns(txnPayload.data?.list ?? []);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [tenant]);

  return (
    <Modal
      title={`租户下钻 · ${tenant?.name ?? ""}`}
      open={Boolean(tenant)}
      onCancel={onClose}
      footer={<Button onClick={onClose}>关闭</Button>}
      width={860}
      destroyOnHidden
    >
      {tenant ? (
        <div style={{ display: "grid", gap: 14 }}>
          <div className="form-2col text-12">
            <div>
              <span className="muted">编码：</span>
              <span className="mono">{tenant.code}</span>
            </div>
            <div>
              <span className="muted">联系人：</span>
              {tenant.contact || "—"}
            </div>
            <div>
              <span className="muted">额度池余量：</span>
              <span className="mono">{quotaText(tenant.quotaPool)}</span>
            </div>
            <div>
              <span className="muted">已消耗：</span>
              <span className="mono">{quotaText(tenant.usedQuota)}</span>
            </div>
            <div>
              <span className="muted">服务到期：</span>
              {tenant.expiresAt ? epochText(tenant.expiresAt) : "未订阅"}
            </div>
            <div>
              <span className="muted">开通时间：</span>
              {fmtTime(tenant.createdAt)}
            </div>
            {tenant.remark ? (
              <div style={{ gridColumn: "1 / -1" }}>
                <span className="muted">备注：</span>
                {tenant.remark}
              </div>
            ) : null}
          </div>

          <div>
            <div
              className="text-12 muted"
              style={{ marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}
            >
              <span>
                成员（{members?.total ?? 0} 个 · 一个账号可同时属于多个租户，这里只动他在本租户的身份）
              </span>
              <Space size={6}>
                <Input.Search
                  allowClear
                  placeholder="搜索用户名 / 昵称"
                  style={{ width: 180 }}
                  onSearch={(value) => {
                    setMemberPage(1);
                    setMemberKeyword(value);
                  }}
                />
                <Button size="small" type="primary" onClick={() => { joinForm.resetFields(); setJoining(true); }}>
                  加入已有账号
                </Button>
              </Space>
            </div>
            <div className="table-wrap">
              <Table<AccountRow>
                rowKey="id"
                size="small"
                loading={memberLoading}
                dataSource={members?.list ?? []}
                locale={{ emptyText: <EmptyState icon="👥" text="该租户还没有成员" /> }}
                pagination={{
                  ...tablePagination,
                  current: memberPage,
                  pageSize: 10,
                  total: members?.total ?? 0,
                  onChange: setMemberPage,
                }}
                columns={[
                  {
                    title: "账号",
                    width: 160,
                    render: (_, row) => (
                      <div>
                        <div className="text-12" style={{ fontWeight: 600 }}>
                          {row.displayName || row.username}
                        </div>
                        <div className="text-12 muted mono">{row.username}</div>
                      </div>
                    ),
                  },
                  {
                    title: "全局身份",
                    width: 110,
                    render: (_, row) => (
                      <Badge
                        label={ROLE_LABEL[row.role] || `角色 ${row.role}`}
                        variant={ROLE_VARIANT[row.role] || "gray"}
                      />
                    ),
                  },
                  {
                    title: "本租户权限",
                    width: 100,
                    render: (_, row) => (
                      <Badge
                        label={MEMBER_ROLE_LABEL[row.memberRole ?? 0] || "成员"}
                        variant={MEMBER_ROLE_VARIANT[row.memberRole ?? 0] || "gray"}
                      />
                    ),
                  },
                  {
                    title: "本租户额度",
                    width: 150,
                    render: (_, row) => (
                      <div>
                        <span className="mono text-12">{quotaText(row.quota ?? 0)}</span>
                        <div className="text-12 muted">
                          已用 {quotaText(row.usedQuota ?? 0)} · {row.requestCount ?? 0} 次
                        </div>
                      </div>
                    ),
                  },
                  {
                    title: "在本租户",
                    width: 110,
                    render: (_, row) => (
                      <Badge
                        label={row.memberStatus === 1 ? "正常" : "本租户已停用"}
                        variant={row.memberStatus === 1 ? "green" : "gray"}
                      />
                    ),
                  },
                  {
                    title: "操作",
                    width: 220,
                    render: (_, row) => (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <Button
                          size="small"
                          onClick={() =>
                            setMemberRole(
                              row,
                              row.memberRole === MEMBER_ROLE_ADMIN ? MEMBER_ROLE_USER : MEMBER_ROLE_ADMIN,
                            )
                          }
                        >
                          {row.memberRole === MEMBER_ROLE_ADMIN ? "降为成员" : "设为管理员"}
                        </Button>
                        <Button size="small" danger={row.memberStatus === 1} onClick={() => toggleMember(row)}>
                          {row.memberStatus === 1 ? "停用" : "启用"}
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />
            </div>
            <div className="text-12 muted" style={{ marginTop: 6 }}>
              要改这个成员在本租户的额度，去「账号管理 → 分配额度」并点名本租户；新建账号并在建号时选定本租户也在「账号管理」。
            </div>
          </div>

          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              软件权益（订阅 / 功能买断到账）
            </div>
            <div className="table-wrap">
              <Table<EntitlementRow>
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={entitlements}
                pagination={false}
                locale={{ emptyText: <EmptyState icon="🎫" text="该租户还没有生效过的软件权益" /> }}
                columns={[
                  { title: "商品", render: (_, row) => row.name || row.productId },
                  {
                    title: "类型",
                    width: 110,
                    render: (_, row) => (
                      <Badge
                        label={ENTITLEMENT_KIND_LABEL[row.kind] || row.kind}
                        variant="violet"
                      />
                    ),
                  },
                  {
                    title: "状态",
                    width: 100,
                    render: (_, row) => (
                      <Badge label={row.active ? "生效中" : "已失效"} variant={row.active ? "green" : "gray"} />
                    ),
                  },
                  {
                    title: "到期",
                    width: 160,
                    render: (_, row) => (
                      <span className="text-12">{row.expiresAt ? epochText(row.expiresAt) : "长期有效"}</span>
                    ),
                  },
                ]}
              />
            </div>
          </div>

          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              订购记录（最近 20 单）
            </div>
            <div className="table-wrap">
              <Table<AdminOrderRow>
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={orders}
                pagination={false}
                locale={{ emptyText: <EmptyState icon="🧾" text="该租户还没有订购记录" /> }}
                columns={[
                  { title: "下单时间", width: 150, render: (_, row) => <span className="text-12">{fmtTime(row.createdAt)}</span> },
                  { title: "单号", width: 190, render: (_, row) => <span className="mono text-12">{row.merchantOrderNo}</span> },
                  {
                    title: "商品",
                    width: 160,
                    render: (_, row) => (
                      <span className="text-12">
                        {PRODUCT_TYPE_LABEL[row.productType] || row.productType} · {row.productId}
                      </span>
                    ),
                  },
                  { title: "金额", width: 110, render: (_, row) => <span className="mono text-12">{fenText(row.amountFen)}</span> },
                  {
                    title: "额度",
                    width: 110,
                    render: (_, row) => <span className="mono text-12">{row.quotaGranted ? quotaText(row.quotaGranted) : "—"}</span>,
                  },
                  {
                    title: "状态",
                    width: 100,
                    render: (_, row) => (
                      <Badge
                        label={ORDER_STATUS_LABEL[row.status] || row.status}
                        variant={ORDER_STATUS_VARIANT[row.status] || "gray"}
                      />
                    ),
                  },
                ]}
              />
            </div>
          </div>

          <div>
            <div className="text-12 muted" style={{ marginBottom: 6 }}>
              额度池流水（最近 20 笔）
            </div>
            <div className="table-wrap">
              <Table<TenantPoolTxnRow>
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={txns}
                pagination={{ ...tablePagination, pageSize: 5 }}
                locale={{ emptyText: <EmptyState icon="💰" text="暂无额度池流水" /> }}
                columns={[
                  { title: "时间", width: 150, render: (_, row) => <span className="text-12">{fmtTime(row.createdAt)}</span> },
                  {
                    title: "变动",
                    width: 120,
                    render: (_, row) => (
                      <span className="mono text-12" style={{ color: row.delta >= 0 ? "#1677ff" : "#d4380d" }}>
                        {row.delta >= 0 ? "+" : ""}
                        {quotaText(row.delta)}
                      </span>
                    ),
                  },
                  { title: "变动后", width: 120, render: (_, row) => <span className="mono text-12">{quotaText(row.quotaAfter)}</span> },
                  { title: "说明", render: (_, row) => <span className="text-12">{poolTxnText(row.note)}</span> },
                ]}
              />
            </div>
          </div>
        </div>
      ) : null}

      <Modal
        title={`加入已有账号 · ${tenant?.name ?? ""}`}
        open={joining}
        onCancel={() => setJoining(false)}
        onOk={() => void submitJoin()}
        okText="加入该租户"
        cancelText="取消"
        destroyOnHidden
      >
        <Form
          form={joinForm}
          layout="vertical"
          initialValues={{ memberRole: MEMBER_ROLE_USER, quota: 0 }}
        >
          <Form.Item
            name="username"
            label="用户名"
            extra="要加入的账号必须已经在平台上注册（「账号管理」可建号）；加入不影响他在其他租户里的身份与额度"
            rules={[{ required: true, whitespace: true, message: "请输入要加入的用户名" }]}
          >
            <Input placeholder="已有账号的登录名" autoComplete="off" />
          </Form.Item>
          <Form.Item name="memberRole" label="租户内权限">
            <Select options={MEMBER_ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="quota"
            label="初始额度"
            extra="单位 quota；这里是平台直接给这个成员的份额，不从该租户额度池里扣"
          >
            <Input type="number" min={0} />
          </Form.Item>
        </Form>
      </Modal>
    </Modal>
  );
}
