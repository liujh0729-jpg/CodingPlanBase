"use client";

import {
  CheckCircleOutlined,
  DatabaseOutlined,
  ReloadOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Result,
  Select,
  Spin,
  Steps,
  Tag,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { api, postJson } from "@/lib/api";
import { PRODUCT_NAME } from "@/lib/brand";
import styles from "./install.module.css";

type Dialect = "sqlite" | "mysql" | "postgresql";

type Stage = "db_unreachable" | "schema_missing" | "admin_missing" | "ready";

type InstallChecks = {
  envFile: boolean;
  envPath: string;
  envWritable: boolean;
  databaseUrlInEnv: boolean;
  jwtSecretInEnv: boolean;
  jwtSecretInRuntime: boolean;
  runtimeDialect: string;
  envDialect: string;
  sqlitePath: string;
  envMatchesRuntime: boolean;
};

type InstallStatus = {
  installed: boolean;
  stage: Stage;
  checks: InstallChecks;
  ddlFiles?: Record<string, string>;
};

type DatabaseResult = {
  dialect: Dialect;
  appliedKeys: string[];
  restartRequired: boolean;
  regenerateClient: boolean;
};

type SchemaResult = {
  dialect: string;
  appliedStatements: number;
  restartRequired: boolean;
};

type AdminResult = { user: { username: string; role: number } };

const USERNAME_RULE = /^[A-Za-z0-9_@.-]{3,20}$/;

const DIALECT_OPTIONS: { value: Dialect; label: string }[] = [
  { value: "sqlite", label: "SQLite（演示 / 单机首选，零运维）" },
  { value: "mysql", label: "MySQL 8" },
  { value: "postgresql", label: "PostgreSQL" },
];

const STEP_OF_STAGE = (checks: InstallChecks, stage: Stage) => {
  if (stage === "admin_missing") return 3;
  if (stage === "schema_missing") return 2;
  // 连不上库：没配过连接串先看待安装环境，否则回到「配置数据库」
  return checks.databaseUrlInEnv ? 1 : 0;
};

export default function InstallPage() {
  const [status, setStatus] = useState<InstallStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState("");
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [needRestart, setNeedRestart] = useState(false);
  const [finished, setFinished] = useState("");
  const [dbForm] = Form.useForm();
  const [adminForm] = Form.useForm();
  const dialect = (Form.useWatch("dialect", dbForm) || "sqlite") as Dialect;

  const refresh = useCallback(async () => {
    const payload = await api<InstallStatus>("/install/status");
    if (payload.code !== 0 || !payload.data) {
      setUnreachable(
        payload.message ||
          "读不到安装状态：后端服务没启动，或前端拿不到 /api/backend/install/status",
      );
      return null;
    }
    setUnreachable("");
    setStatus(payload.data);
    setCurrent(STEP_OF_STAGE(payload.data.checks, payload.data.stage));
    // 进程连的库与 .env 一致了，才算重启到位
    setNeedRestart(!payload.data.checks.envMatchesRuntime);
    return payload.data;
  }, []);

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    if (!status || !status.checks.sqlitePath) return;
    dbForm.setFieldsValue({ sqlitePath: status.checks.sqlitePath });
  }, [status, dbForm]);

  const saveDatabase = async (values: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    const payload = await postJson<DatabaseResult>("/install/database", values);
    setBusy(false);
    if (payload.code !== 0) {
      setError(payload.message || "写入数据库配置失败");
      return;
    }
    dbForm.setFieldsValue({ password: "" });
    setNeedRestart(Boolean(payload.data?.restartRequired));
    setNotice(
      payload.data?.restartRequired
        ? `连接配置已写入 backend/.env（${payload.data.appliedKeys.join("、")}）。${
            payload.data.regenerateClient
              ? "换了方言还要重新生成客户端：pnpm prisma:generate:" +
                (payload.data.dialect === "mysql" ? "mysql" : "postgres") +
                "。"
              : ""
          }请重启后端服务，再点下面的「我已重启」。`
        : "连接配置已写入 backend/.env，且与当前进程一致，可以直接建表。",
    );
    await refresh();
  };

  const applySchema = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    const payload = await postJson<SchemaResult>("/install/schema", {});
    setBusy(false);
    if (payload.code !== 0) {
      setError(payload.message || "建表失败");
      return;
    }
    setNotice(`表结构已建好（执行了 ${payload.data?.appliedStatements ?? 0} 条语句）。`);
    await refresh();
  };

  const createAdmin = async (values: {
    username: string;
    password: string;
    displayName?: string;
  }) => {
    setBusy(true);
    setError("");
    setNotice("");
    // 只把后端要的三项发出去：confirmPassword 属于前端校验，不该走网络
    const payload = await postJson<AdminResult>("/install/admin", {
      username: values.username,
      password: values.password,
      displayName: values.displayName,
    });
    setBusy(false);
    if (payload.code !== 0) {
      setError(payload.message || "创建超级管理员失败");
      return;
    }
    adminForm.setFieldsValue({ password: "", confirmPassword: "" });
    setFinished(payload.data?.user?.username || values.username);
    await refresh();
  };

  const checks = status?.checks;
  // 第 3 步的命令按「.env 里那个库」给，而不是表单当前选择：改了没重启也不算数
  const cliSuffix = checks?.envDialect === "mysql" ? "mysql" : "postgres";
  const dialectKey = checks?.envDialect || "sqlite";
  const ddlFile =
    status?.ddlFiles?.[dialectKey]?.replace(/\\/g, "/") ?? `prisma/sql/${dialectKey}/schema.sql`;

  const body = () => {
    if (unreachable) {
      return (
        <Alert
          type="error"
          showIcon
          title="拿不到安装状态"
          description={
            <div className={styles.stack}>
              <span>{unreachable}</span>
              <span>
                后端默认监听 1690 端口：在仓库的 <code>backend/</code> 目录执行
                <code> pnpm dev </code>把服务起来，然后点右上角「重新检测」。
              </span>
            </div>
          }
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={() => void refresh()}>
              重新检测
            </Button>
          }
        />
      );
    }
    if (!status || !checks) {
      return (
        <div style={{ padding: 48, textAlign: "center" }}>
          <Spin />
        </div>
      );
    }
    if (status.installed && !finished) {
      return (
        <Result
          status="success"
          icon={<SafetyCertificateOutlined />}
          title="系统已安装"
          subTitle="超级管理员已经存在，安装向导的所有写入口已自动关闭。用管理员账号登录即可开始配置渠道与账号。"
          extra={<Button type="primary" onClick={() => (window.location.href = "/login")}>去登录</Button>}
        />
      );
    }
    if (finished) {
      return (
        <Result
          status="success"
          title="安装完成"
          subTitle={`超级管理员 ${finished} 已创建，安装向导已关闭。接下来登录后台开通第一个租户，再配置渠道与价目表。`}
          extra={
            <Button type="primary" onClick={() => (window.location.href = "/login")}>
              进入登录页 <RightOutlined />
            </Button>
          }
        />
      );
    }

    return (
      <div className={styles.stack}>
        <Steps
          current={current}
          size="small"
          items={[
            { title: "环境检查" },
            { title: "配置数据库" },
            { title: "建表" },
            { title: "超级管理员" },
          ]}
        />

        {error ? (
          <Alert type="error" showIcon closable title={error} onClose={() => setError("")} />
        ) : null}
        {notice ? (
          <Alert
            type="info"
            showIcon
            closable
            title={notice}
            onClose={() => setNotice("")}
            action={
              needRestart ? (
                <Button size="small" type="primary" onClick={() => void refresh()}>
                  我已重启
                </Button>
              ) : null
            }
          />
        ) : null}
        {needRestart && current >= 1 ? (
          <Alert
            type="warning"
            showIcon
            title="backend/.env 与当前进程连的库不是同一个"
            description="改了数据库配置必须重启后端才会生效：建表会打到新库、建号会打到旧库。重启后点「我已重启」继续。"
            action={
              <Button size="small" onClick={() => void refresh()}>
                重新检测
              </Button>
            }
          />
        ) : null}

        {current === 0 ? (
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>安装前检查</h2>
            <p className={styles.hint}>
              向导只在这些地方可写：数据库连接串与 JWT 密钥写进被 Git 忽略的
              <code> backend/.env</code>，表结构与账号写进你选的库。任何接口都不会回显连接串和密钥。
            </p>
            <Descriptions
              bordered
              column={1}
              size="small"
              items={[
                {
                  key: "env",
                  label: "配置文件",
                  children: (
                    <>
                      <code>{checks.envPath}</code>{" "}
                      {checks.envWritable ? (
                        <Tag color="green">可写</Tag>
                      ) : (
                        <Tag color="red">不可写</Tag>
                      )}
                    </>
                  ),
                },
                {
                  key: "url",
                  label: "数据库连接串",
                  children: checks.databaseUrlInEnv ? (
                    <Tag color="green">已配置（{checks.envDialect}）</Tag>
                  ) : (
                    <Tag>未配置，下一步写入</Tag>
                  ),
                },
                {
                  key: "runtime",
                  label: "进程实际连接的库",
                  children: (
                    <>
                      {checks.runtimeDialect === "unknown" ? (
                        <Tag>未连接</Tag>
                      ) : (
                        <Tag color="blue">{checks.runtimeDialect}</Tag>
                      )}{" "}
                      {checks.envMatchesRuntime ? (
                        <Tag color="green">与配置一致</Tag>
                      ) : (
                        <Tag color="orange">与配置不一致，需重启</Tag>
                      )}
                    </>
                  ),
                },
                {
                  key: "jwt",
                  label: "JWT 密钥",
                  children:
                    checks.jwtSecretInEnv && checks.jwtSecretInRuntime ? (
                      <Tag color="green">已就绪</Tag>
                    ) : (
                      <Tag>首次启动时自动生成</Tag>
                    ),
                },
              ]}
            />
            <div className={styles.actions}>
              <Button type="primary" disabled={!checks.envWritable} onClick={() => setCurrent(1)}>
                下一步：配置数据库 <RightOutlined />
              </Button>
              {!checks.envWritable ? (
                <span className={styles.footerNote}>
                  配置文件不可写：请手工在 <code>backend/.env</code> 里填好 DATABASE_URL 后重启后端。
                </span>
              ) : null}
            </div>
          </section>
        ) : null}

        {current === 1 ? (
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>
              <DatabaseOutlined /> 配置数据库
            </h2>
            <p className={styles.hint}>
              演示与小规模单机用 SQLite（一个库文件，零运维）；正式多实例部署选 MySQL / PostgreSQL，
              建表与生成客户端要回到 <code>backend/</code> 用命令行执行，向导会把命令告诉你。
            </p>
            <Form<Record<string, unknown>>
              form={dbForm}
              layout="vertical"
              initialValues={{ dialect: "sqlite", port: 3306 }}
              onFinish={saveDatabase}
              disabled={busy}
            >
              <Form.Item name="dialect" label="数据库类型" rules={[{ required: true }]}>
                <Select options={DIALECT_OPTIONS} />
              </Form.Item>
              {dialect === "sqlite" ? (
                <Form.Item
                  name="sqlitePath"
                  label="SQLite 库文件路径"
                  extra="相对路径按 backend/ 解析；留空则沿用当前配置"
                  rules={[{ required: true, whitespace: true, message: "请填写库文件路径" }]}
                >
                  <Input placeholder="例如 E:/data/codingplan.db 或 ./prisma/dev.db" />
                </Form.Item>
              ) : (
                <>
                  <Form.Item
                    name="host"
                    label="主机"
                    rules={[{ required: true, whitespace: true, message: "请填写数据库主机" }]}
                  >
                    <Input placeholder="127.0.0.1" />
                  </Form.Item>
                  <Form.Item name="port" label="端口" rules={[{ required: true, message: "请填写端口" }]}>
                    <InputNumber min={1} max={65535} style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item
                    name="database"
                    label="数据库名"
                    rules={[{ required: true, whitespace: true, message: "请填写数据库名" }]}
                  >
                    <Input placeholder="codingplan" />
                  </Form.Item>
                  <Form.Item
                    name="username"
                    label="账号"
                    rules={[{ required: true, whitespace: true, message: "请填写数据库账号" }]}
                  >
                    <Input autoComplete="off" />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    label="密码"
                    extra="只写入 backend/.env，不回显、不进日志"
                  >
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                  {dialect === "postgresql" ? (
                    <Form.Item name="schema" label="模式（schema，可留空）">
                      <Input placeholder="public" />
                    </Form.Item>
                  ) : null}
                </>
              )}
              <div className={styles.actions}>
                <Button type="primary" htmlType="submit" loading={busy} icon={<CheckCircleOutlined />}>
                  保存并继续
                </Button>
                <Button onClick={() => setCurrent(0)}>返回检查</Button>
              </div>
            </Form>
          </section>
        ) : null}

        {current === 2 ? (
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>建表</h2>
            {checks.envDialect === "sqlite" ? (
              <>
                <p className={styles.hint}>
                  SQLite 由向导直接执行随仓的 <code>{ddlFile}</code>
                  （租户、账号、渠道、令牌、订单、额度流水等 14 张表）。目标库里已有表时向导会拒绝执行，不会覆盖数据。
                </p>
                <div className={styles.actions} style={{ marginTop: 0 }}>
                  <Button type="primary" loading={busy} onClick={() => void applySchema()}>
                    执行建表
                  </Button>
                  <Button onClick={() => setCurrent(1)}>上一步</Button>
                </div>
              </>
            ) : (
              <>
                <p className={styles.hint}>
                  外部数据库的 DDL 向导不代跑：请在 <code>backend/</code> 目录依次执行下面三条命令，
                  建表脚本是随仓的 <code>{ddlFile}</code>（租户、账号、渠道、令牌、订单、额度流水等 14 张表）。
                  库里已有表时会拒绝执行，不会覆盖数据。
                </p>
                <div className={styles.commands}>
                  <code>{`pnpm db:apply:${cliSuffix}`}</code>
                  <code>{`pnpm prisma:generate:${cliSuffix}`}</code>
                  <code>重启后端服务</code>
                </div>
                <div className={styles.actions}>
                  <Button type="primary" onClick={() => void refresh()}>
                    我已执行，继续
                  </Button>
                  <Button onClick={() => setCurrent(1)}>上一步</Button>
                </div>
              </>
            )}
          </section>
        ) : null}

        {current === 3 ? (
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>创建第一个超级管理员</h2>
            <p className={styles.hint}>
              这个角色管理租户、渠道与系统设置。建好之后安装向导立即关闭：再点这些入口会返回
              「系统已安装」，系统控制权不会第二次交出去。
            </p>
            <Form<{ username: string; password: string; displayName?: string; confirmPassword: string }>
              form={adminForm}
              layout="vertical"
              onFinish={createAdmin}
              disabled={busy}
            >
              <Form.Item
                name="username"
                label="用户名"
                rules={[
                  { required: true, whitespace: true, message: "请输入用户名" },
                  { pattern: USERNAME_RULE, message: "用户名需为 3-20 位字母、数字或 _ @ . -" },
                ]}
              >
                <Input autoComplete="username" placeholder="例如 root" />
              </Form.Item>
              <Form.Item name="displayName" label="显示名（可留空）">
                <Input autoComplete="nickname" placeholder="例如 平台管理员" />
              </Form.Item>
              <Form.Item
                name="password"
                label="密码"
                rules={[
                  { required: true, message: "请输入密码" },
                  { min: 8, max: 64, message: "密码长度需为 8-64 位" },
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <Form.Item
                name="confirmPassword"
                label="确认密码"
                dependencies={["password"]}
                rules={[
                  { required: true, message: "请再次输入密码" },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("password") === value) return Promise.resolve();
                      return Promise.reject(new Error("两次输入的密码不一致"));
                    },
                  }),
                ]}
              >
                <Input.Password autoComplete="new-password" />
              </Form.Item>
              <div className={styles.actions}>
                <Button type="primary" htmlType="submit" loading={busy}>
                  创建并完成安装
                </Button>
                <Button onClick={() => void refresh()}>重新检测</Button>
              </div>
            </Form>
          </section>
        ) : null}
      </div>
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <BrandLogo size={44} className={styles.logo} />
          <div>
            <h1 className={styles.title}>{PRODUCT_NAME} · 安装向导</h1>
            <p className={styles.subtitle}>
              配数据库 → 建表 → 建超级管理员。向导只在系统尚未安装时开放写入。
            </p>
          </div>
        </header>
        <main>{body()}</main>
        <footer className={styles.footerNote}>
          已经装好了？直接访问 <a href="/login">登录页</a>。安装完成后本页面只读，用于回看当前配置状态。
        </footer>
      </div>
    </div>
  );
}
