"use client";

import {
  ApartmentOutlined,
  ArrowRightOutlined,
  LockOutlined,
  ShopOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { LoginForm, ProFormText } from "@ant-design/pro-components";
import { Alert, App, Button, Radio, Tabs } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand";
import { api } from "@/lib/api";
import { safeNextPath } from "@/lib/safe-next";
import styles from "./login.module.css";

type AuthValues = {
  username: string;
  password: string;
  displayName?: string;
  tenantName?: string;
  tenantCode?: string;
};

type Me = { id: number; username: string; displayName: string; role: number };

const USERNAME_RULE = /^[A-Za-z0-9_@.-]{3,20}$/;
const TENANT_CODE_RULE = /^[A-Za-z0-9_-]{2,32}$/;

export default function LoginPage() {
  const { message } = App.useApp();
  const [me, setMe] = useState<Me | null>(null);
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [mode, setMode] = useState<"login" | "register">("login");
  // 注册二选一：自建租户（自己＝该租户管理员）或按编码加入（成为该租户成员）
  const [tenantChoice, setTenantChoice] = useState<"create" | "join">("create");
  const [busy, setBusy] = useState(false);
  const [tips, setTips] = useState("");
  const [notInstalled, setNotInstalled] = useState(false);

  const next = useMemo(() => {
    if (typeof window === "undefined") return "/";
    const target = new URLSearchParams(window.location.search).get("next");
    return safeNextPath(target);
  }, []);

  const load = useCallback(async () => {
    // 登录页不能走会触发 401 跳转的 api()：未登录是这里的正常状态
    const [mePayload, settingsPayload, installPayload] = await Promise.all([
      api<Me>("/auth/me").catch(() => null),
      api<{ allow_registration: boolean }>("/settings/public").catch(() => null),
      api<{ installed: boolean }>("/install/status").catch(() => null),
    ]);
    setMe(mePayload?.code === 0 ? mePayload.data : null);
    if (settingsPayload?.code === 0 && settingsPayload.data) {
      setAllowRegistration(settingsPayload.data.allow_registration);
    }
    // 全新库还没有任何账号，注册也只出普通用户：把安装向导摆在登录页最显眼处
    setNotInstalled(installPayload?.code === 0 && installPayload.data?.installed === false);
  }, []);

  useEffect(() => {
    void load();
    if (
      new URLSearchParams(window.location.search).get("reason") === "expired"
    ) {
      setTips("登录状态已过期，请重新登录");
    }
  }, [load]);

  const submit = async (values: AuthValues) => {
    if (busy) return false;
    setTips("");
    setBusy(true);
    try {
      const path =
        mode === "login"
          ? `/api/auth/login?next=${encodeURIComponent(next)}`
          : "/api/auth/register";
      const response = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          mode === "login"
            ? { username: values.username.trim(), password: values.password }
            : {
                username: values.username.trim(),
                password: values.password,
                displayName: values.displayName?.trim(),
                tenantMode: tenantChoice,
                tenantName: values.tenantName?.trim(),
                tenantCode: values.tenantCode?.trim(),
              },
        ),
      });
      const payload = (await response.json()) as {
        code: number;
        message?: string;
      };
      if (payload.code !== 0) {
        setTips(payload.message || "操作失败");
        return false;
      }
      if (mode === "register") message.success("注册成功，正在进入工作台");
      window.location.href = next;
      return true;
    } catch {
      setTips("网络异常，请稍后再试");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const changeMode = (value: string) => {
    setMode(value === "register" ? "register" : "login");
    setTips("");
  };

  return (
    <div className={styles.page}>
      <a href="#login-content" className={styles.skipLink}>
        跳转到登录表单
      </a>
      <main className={styles.main} id="login-content">
        <section className={styles.authSection} aria-label="底座账号登录">
          <LoginForm<AuthValues>
            logo={<BrandLogo size={48} className={styles.logo} />}
            title={<h1 className={styles.title}>{PRODUCT_NAME}</h1>}
            subTitle={PRODUCT_TAGLINE}
            contentStyle={{ width: "100%", maxWidth: 368 }}
            onFinish={submit}
            onFinishFailed={() => setTips("")}
            disabled={busy}
            validateTrigger="onBlur"
            submitter={
              me
                ? false
                : {
                    searchConfig: {
                      submitText: mode === "login" ? "登 录" : "注册并登录",
                    },
                    submitButtonProps: {
                      loading: busy,
                      className: styles.submit,
                    },
                  }
            }
            message={
              tips ? (
                <Alert
                  className={styles.alert}
                  title={tips}
                  type="error"
                  showIcon
                  role="alert"
                />
              ) : undefined
            }
          >
            {me ? (
              <div className={styles.current}>
                <span className={styles.currentAvatar} aria-hidden="true">
                  <UserOutlined />
                </span>
                <h2>欢迎回来，{me.displayName || me.username}</h2>
                <p>你已登录，可以继续管理网关与额度。</p>
                <Button
                  type="primary"
                  size="large"
                  block
                  onClick={() => (window.location.href = next)}
                >
                  进入工作台 <ArrowRightOutlined />
                </Button>
                <Button
                  type="link"
                  onClick={() => (window.location.href = "/api/auth/logout?next=/login")}
                >
                  退出并切换账号
                </Button>
              </div>
            ) : (
              <>
                {notInstalled ? (
                  <Alert
                    className={styles.alert}
                    type="warning"
                    showIcon
                    title="系统还没有安装"
                    description={
                      <span>
                        数据库里还没有超级管理员。先跑完
                        <a href="/install">安装向导</a>
                        （配库 → 建表 → 建管理员），再回来登录。
                      </span>
                    }
                  />
                ) : null}
                {allowRegistration ? (
                  <Tabs
                    className={styles.tabs}
                    activeKey={mode}
                    onChange={changeMode}
                    centered
                    items={[
                      { key: "login", label: "账号登录", disabled: busy },
                      { key: "register", label: "注册账号", disabled: busy },
                    ]}
                  />
                ) : null}
                {mode === "register" ? (
                  <ProFormText
                    name="displayName"
                    fieldProps={{
                      size: "large",
                      prefix: <UserOutlined />,
                      autoComplete: "nickname",
                      "aria-label": "昵称",
                    }}
                    placeholder="昵称（可留空）"
                  />
                ) : null}
                <ProFormText
                  name="username"
                  fieldProps={{
                    size: "large",
                    prefix: <UserOutlined />,
                    autoComplete: "username",
                    "aria-label": "用户名",
                  }}
                  placeholder="用户名"
                  rules={[
                    { required: true, whitespace: true, message: "请输入用户名" },
                    ...(mode === "register"
                      ? [
                          {
                            pattern: USERNAME_RULE,
                            message: "用户名需为 3-20 位字母、数字或 _ @ . -",
                          },
                        ]
                      : []),
                  ]}
                />
                <ProFormText.Password
                  name="password"
                  fieldProps={{
                    size: "large",
                    prefix: <LockOutlined />,
                    autoComplete:
                      mode === "login" ? "current-password" : "new-password",
                    "aria-label": "密码",
                  }}
                  placeholder="密码"
                  rules={[
                    { required: true, message: "请输入密码" },
                    ...(mode === "register"
                      ? [
                          {
                            min: 8,
                            max: 64,
                            message: "密码长度需为 8-64 位",
                          },
                        ]
                      : []),
                  ]}
                />
                {mode === "register" ? (
                  <>
                    <div className={styles.tenantChoice}>
                      <Radio.Group
                        value={tenantChoice}
                        onChange={(event) =>
                          setTenantChoice(
                            event.target.value === "join" ? "join" : "create",
                          )
                        }
                        disabled={busy}
                        optionType="button"
                        options={[
                          {
                            value: "create",
                            label: (
                              <span>
                                <ShopOutlined /> 创建租户
                              </span>
                            ),
                          },
                          {
                            value: "join",
                            label: (
                              <span>
                                <ApartmentOutlined /> 加入租户
                              </span>
                            ),
                          },
                        ]}
                      />
                    </div>
                    {tenantChoice === "create" ? (
                      <>
                        <ProFormText
                          name="tenantName"
                          fieldProps={{
                            size: "large",
                            prefix: <ShopOutlined />,
                            maxLength: 60,
                            "aria-label": "租户名称",
                          }}
                          placeholder="租户名称（你是该租户的管理员）"
                          rules={[
                            {
                              required: true,
                              whitespace: true,
                              message: "请输入租户名称",
                            },
                          ]}
                        />
                        <ProFormText
                          name="tenantCode"
                          fieldProps={{
                            size: "large",
                            maxLength: 32,
                            autoComplete: "off",
                            "aria-label": "租户编码",
                          }}
                          placeholder="租户编码（可留空，自动生成）"
                          rules={[
                            {
                              pattern: TENANT_CODE_RULE,
                              message: "编码为 2-32 位字母、数字或 _ -",
                            },
                          ]}
                        />
                      </>
                    ) : (
                      <ProFormText
                        name="tenantCode"
                        fieldProps={{
                          size: "large",
                          prefix: <ApartmentOutlined />,
                          maxLength: 32,
                          autoComplete: "off",
                          "aria-label": "租户编码",
                        }}
                        placeholder="租户编码（向该租户管理员索取）"
                        rules={[
                          {
                            required: true,
                            whitespace: true,
                            message: "请输入租户编码",
                          },
                          {
                            pattern: TENANT_CODE_RULE,
                            message: "编码为 2-32 位字母、数字或 _ -",
                          },
                        ]}
                      />
                    )}
                  </>
                ) : null}
                <div className={styles.formNote}>
                  <LockOutlined aria-hidden="true" />
                  <span>
                    {mode === "login"
                      ? "使用本底座账号登录；管理员可在后台开设分级账号"
                      : "额度、令牌与用量都记在租户里：自建租户你就是该租户的管理员，加入别人的租户则用该租户划给你的额度"}
                  </span>
                </div>
              </>
            )}
          </LoginForm>
        </section>
      </main>
      <footer className={styles.footer}>
        <p className={styles.services}>
          用户分级 · AI 服务 · 调用计费 · 额度分配 · B 端在线支付
        </p>
        <p className={styles.copyright}>
          © {new Date().getFullYear()} {PRODUCT_NAME}
        </p>
      </footer>
    </div>
  );
}
