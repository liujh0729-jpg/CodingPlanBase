"use client";

import { ApartmentOutlined, ShopOutlined } from "@ant-design/icons";
import { App, Button, Dropdown, Form, Input, Modal, Tabs } from "antd";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { MEMBER_ROLE_LABEL, quotaText, type TenantBrief } from "@/lib/gateway";
import { MEMBER_ROLE_ADMIN, useSession } from "@/lib/session";

/**
 * 顶栏租户切换器：一个账号可以同时属于多个租户，切到哪个租户就用哪个租户划给他的额度，
 * 令牌、用量、账单也都落在那一个租户里——所以这里是「记账上下文」的开关，不只是显示名字。
 * 还没有任何租户身份时（注册后 / 被全部停用）退化成「创建或加入租户」引导按钮。
 */
export function TenantSwitcher() {
  const { me, switchTenant, createTenant, joinTenant } = useSession();
  const { message } = App.useApp();
  const [setupOpen, setSetupOpen] = useState(false);
  const [tab, setTab] = useState<"create" | "join">("create");
  const [busy, setBusy] = useState(false);
  const [createForm] = Form.useForm<{ name: string; code?: string }>();
  const [joinForm] = Form.useForm<{ code: string }>();

  if (!me) return null;

  const openSetup = (nextTab: "create" | "join") => {
    createForm.resetFields();
    joinForm.resetFields();
    setTab(nextTab);
    setSetupOpen(true);
  };

  const pick = async (tenantId: number) => {
    if (tenantId === me.tenantId) return;
    const payload = await switchTenant(tenantId);
    if (payload.code === 0) message.success("已切换租户");
    else message.error(payload.message || "切换失败");
  };

  const submitCreate = async () => {
    const values = await createForm.validateFields();
    setBusy(true);
    try {
      const payload = await createTenant(values.name.trim(), values.code?.trim());
      if (payload.code !== 0) {
        message.error(payload.message || "创建失败");
        return;
      }
      message.success("租户已创建，你是该租户的管理员");
      setSetupOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const submitJoin = async () => {
    const values = await joinForm.validateFields();
    setBusy(true);
    try {
      const payload = await joinTenant(values.code.trim());
      if (payload.code !== 0) {
        message.error(payload.message || "加入失败");
        return;
      }
      message.success("已加入该租户");
      setSetupOpen(false);
    } finally {
      setBusy(false);
    }
  };

  // 没有任何租户身份：额度、令牌、用量都还没有记账处，先把租户定下来
  if (me.tenantCount === 0) {
    return (
      <>
        <Button
          type="primary"
          ghost
          size="small"
          icon={<ShopOutlined />}
          onClick={() => openSetup("create")}
        >
          创建或加入租户
        </Button>
        <TenantSetupModal
          open={setupOpen}
          tab={tab}
          busy={busy}
          onTab={setTab}
          onCancel={() => setSetupOpen(false)}
          onCreate={() => void submitCreate()}
          onJoin={() => void submitJoin()}
          createForm={createForm}
          joinForm={joinForm}
          forced
        />
      </>
    );
  }

  const current = me.tenantId
    ? me.tenants.find((item) => item.id === me.tenantId)
    : undefined;
  const items = [
    ...me.tenants.map((tenant) => ({
      key: String(tenant.id),
      disabled: !canEnter(tenant),
      onClick: () => void pick(tenant.id),
      label: <TenantMenuItem tenant={tenant} active={tenant.id === me.tenantId} />,
    })),
    { type: "divider" as const },
    {
      key: "create",
      label: "创建新租户",
      icon: <ShopOutlined />,
      onClick: () => openSetup("create"),
    },
    {
      key: "join",
      label: "以编码加入其他租户",
      icon: <ApartmentOutlined />,
      onClick: () => openSetup("join"),
    },
  ];

  return (
    <>
      <Dropdown menu={{ items }} trigger={["click"]} placement="bottomRight">
        <a style={{ color: "inherit", cursor: "pointer" }}>
          <ShopOutlined />{" "}
          {current
            ? `${current.name} · ${MEMBER_ROLE_LABEL[current.memberRole] ?? "成员"}`
            : "未选择租户（身份已停用）"}
        </a>
      </Dropdown>
      <TenantSetupModal
        open={setupOpen}
        tab={tab}
        busy={busy}
        onTab={setTab}
        onCancel={() => setSetupOpen(false)}
        onCreate={() => void submitCreate()}
        onJoin={() => void submitJoin()}
        createForm={createForm}
        joinForm={joinForm}
      />
    </>
  );
}

/** 成员身份被租户管理员停用、或租户本身被平台停用：切过去会被后端拒，这里直接置灰。 */
function canEnter(tenant: TenantBrief): boolean {
  return tenant.memberStatus === 1 && tenant.status !== 0;
}

function TenantMenuItem({ tenant, active }: { tenant: TenantBrief; active: boolean }) {
  const usable = canEnter(tenant);
  return (
    <div style={{ minWidth: 220 }}>
      <div style={{ fontWeight: active ? 700 : 500 }}>
        {tenant.name}
        {active ? " （当前）" : ""}
      </div>
      <div className="text-12 muted" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span className="mono">{tenant.code}</span>
        <Badge
          label={MEMBER_ROLE_LABEL[tenant.memberRole] ?? "成员"}
          variant={tenant.memberRole === MEMBER_ROLE_ADMIN ? "green" : "blue"}
        />
        <span className="mono">余 {quotaText(tenant.quota)}</span>
        {!usable ? <span>不可进入</span> : null}
      </div>
    </div>
  );
}

function TenantSetupModal({
  open,
  tab,
  busy,
  forced,
  onTab,
  onCancel,
  onCreate,
  onJoin,
  createForm,
  joinForm,
}: {
  open: boolean;
  tab: "create" | "join";
  busy: boolean;
  forced?: boolean;
  onTab: (value: "create" | "join") => void;
  onCancel: () => void;
  onCreate: () => void;
  onJoin: () => void;
  createForm: ReturnType<typeof Form.useForm<{ name: string; code?: string }>>[0];
  joinForm: ReturnType<typeof Form.useForm<{ code: string }>>[0];
}) {
  return (
    <Modal
      title={forced ? "先选定你的租户" : "创建或加入租户"}
      open={open}
      onCancel={onCancel}
      onOk={tab === "create" ? onCreate : onJoin}
      okText={tab === "create" ? "创建并进入" : "加入"}
      cancelText="取消"
      okButtonProps={{ loading: busy }}
      destroyOnHidden
    >
      {forced ? (
        <p className="text-12 muted">
          额度、令牌与用量都记在「你在这个租户里」的成员身份上，所以先用一步把租户定下来：
          自己创建一个（你是该租户的管理员），或输入拿到的租户编码加入（成为该租户的成员）。
        </p>
      ) : null}
      <Tabs
        activeKey={tab}
        onChange={(value) => onTab(value === "join" ? "join" : "create")}
        items={[
          {
            key: "create",
            label: "创建租户",
            children: (
              <Form form={createForm} layout="vertical" preserve={false}>
                <Form.Item
                  name="name"
                  label="租户名称"
                  rules={[{ required: true, whitespace: true, message: "请输入租户名称" }]}
                >
                  <Input placeholder="例如：某某科技" maxLength={60} />
                </Form.Item>
                <Form.Item
                  name="code"
                  label="租户编码"
                  extra="留空自动生成；别人用这个编码就能加入你的租户"
                  rules={[
                    {
                      pattern: /^[A-Za-z0-9_-]{2,32}$/,
                      message: "编码为 2-32 位字母、数字或 _ -（保存时转小写）",
                    },
                  ]}
                >
                  <Input placeholder="可留空" maxLength={32} autoComplete="off" />
                </Form.Item>
              </Form>
            ),
          },
          {
            key: "join",
            label: "加入租户",
            children: (
              <Form form={joinForm} layout="vertical" preserve={false}>
                <Form.Item
                  name="code"
                  label="租户编码"
                  rules={[{ required: true, whitespace: true, message: "请输入租户编码" }]}
                >
                  <Input placeholder="向该租户管理员索取" maxLength={40} autoComplete="off" />
                </Form.Item>
              </Form>
            ),
          },
        ]}
      />
    </Modal>
  );
}
