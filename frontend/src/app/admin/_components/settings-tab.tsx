"use client";

import { App, Button, Input, InputNumber, Space, Switch } from "antd";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Notice, Panel } from "@/components/ui/panel";
import { api, postJson } from "@/lib/api";
import { fmtTime } from "@/lib/datetime";
import { FieldLabel, loadApi } from "./common";

type SettingsMap = Record<string, string>;

type SetupStatus = {
  hasKey: boolean;
  modelCount: number;
  revision: string;
  syncedAt: string | null;
  sourceBaseUrl: string;
};

/**
 * 系统设置（超级管理员板块）：AIPDD 接入向导（密钥只写不读）、计费换算参数与开放注册。
 * 在线支付与商品配置在「支付管理」板块。
 * 密钥类配置后端读取时掩码，掩码值或空值提交视为「不修改」。
 */
export function SettingsTab() {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<SettingsMap | null>(null);
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [wizard, setWizard] = useState({ key: "" });
  const [billingForm, setBillingForm] = useState<SettingsMap>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsResult, setupResult] = await Promise.all([
        loadApi<SettingsMap>("/settings"),
        loadApi<SetupStatus>("/gateway/setup/status"),
      ]);
      if (settingsResult.data) {
        setSettings(settingsResult.data);
        setBillingForm(
          pick(settingsResult.data, [
            "quota_per_unit",
            "pricing_markup",
            "new_user_quota",
            "catalog_sync_interval_minutes",
            "allow_registration",
          ]),
        );
      } else if (!settingsResult.forbidden) {
        message.error(settingsResult.message || "设置加载失败");
      }
      if (setupResult.data) setStatus(setupResult.data);
      if (setupResult.forbidden || settingsResult.forbidden) {
        message.warning("需要超级管理员权限才能查看系统设置");
      }
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (name: string, body: SettingsMap) => {
    setSaving(name);
    try {
      const payload = await api<SettingsMap>("/settings", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (payload.code !== 0) {
        message.error(payload.message);
        return false;
      }
      message.success("已保存");
      await load();
      return true;
    } finally {
      setSaving("");
    }
  };

  const runSetup = async () => {
    if (!wizard.key.trim()) {
      message.warning("请填写 AIPDD API Key");
      return;
    }
    // 目录来源地址是 AIPDD 平台的固定量（换密钥不换地址），所以这里只提交 Key；
    // 需要指向别的地址时用后端 AIPDD_BASE_URL 环境变量覆盖，界面不开放输入。
    setSaving("wizard");
    try {
      const payload = await postJson<{ revision: string; models: number }>(
        "/gateway/setup",
        { key: wizard.key.trim() },
      );
      if (payload.code !== 0) {
        message.error(payload.message);
        return;
      }
      message.success(`接入成功，已拉取 ${payload.data?.models ?? 0} 个模型`);
      setWizard({ key: "" });
      await load();
    } finally {
      setSaving("");
    }
  };

  const syncCatalog = async () => {
    setSaving("sync");
    try {
      const payload = await postJson<{ revision: string; models: number }>(
        "/gateway/catalog/sync",
        {},
      );
      if (payload.code !== 0) {
        message.error(payload.message);
        return;
      }
      message.success(`目录已同步：${payload.data?.models ?? 0} 个模型`);
      await load();
    } finally {
      setSaving("");
    }
  };

  return (
    <>
      <Panel
        title="AIPDD 接入"
        titleBadge={
          status ? (
            <Badge
              label={status.hasKey ? "已接入" : "未接入"}
              variant={status.hasKey ? "green" : "orange"}
            />
          ) : null
        }
      >
        {loading ? (
          <Notice variant="info">正在读取配置…</Notice>
        ) : (
          <>
            {!status?.hasKey ? (
              <Notice variant="warn">
                尚未配置 AIPDD API Key：填入 Key 后点「保存并同步」，系统会写入密钥、创建托管渠道并拉取全部模型价目表。
              </Notice>
            ) : (
              <Notice variant="success">
                已接入：模型 {status?.modelCount ?? 0} 个
                {status?.revision ? ` · 目录版本 ${status.revision}` : ""}
                {status?.syncedAt ? ` · 最近同步 ${fmtTime(status.syncedAt)}` : ""}
                {status?.sourceBaseUrl ? ` · 来源 ${status.sourceBaseUrl}` : ""}
              </Notice>
            )}
            <FieldLabel
              label="AIPDD API Key"
              hint={
                settings?.aipdd_api_key
                  ? `当前 ${settings.aipdd_api_key}；留空表示不修改`
                  : "密钥仅存于服务端数据库，界面不回显明文"
              }
            >
              <Input.Password
                value={wizard.key}
                onChange={(event) => setWizard({ ...wizard, key: event.target.value })}
                placeholder="粘贴 AIPDD API Key"
                autoComplete="off"
              />
            </FieldLabel>
            <div className="text-12 muted" style={{ marginTop: 10 }}>
              目录来源 <span className="mono">{settings?.aipdd_base_url || "https://api.aipdd.work"}</span>
              {" · "}AIPDD 的上游地址是平台固定量（换密钥不换地址），界面不提供输入；确需指向别的地址，用后端
              AIPDD_BASE_URL 环境变量覆盖。
            </div>
            <Space>
              <Button
                type="primary"
                loading={saving === "wizard"}
                onClick={() => void runSetup()}
              >
                保存并同步
              </Button>
              <Button loading={saving === "sync"} onClick={() => void syncCatalog()}>
                仅同步目录
              </Button>
            </Space>
          </>
        )}
      </Panel>

      <Panel title="计费与换算">
        <div className="form-2col">
          <FieldLabel label="1 元对应额度" hint="quota_per_unit，网关计费的换算基数，至少 1（为 0 时额度无法换算金额）">
            <InputNumber
              min={1}
              max={1000000000}
              step={10000}
              style={{ width: "100%" }}
              value={Number(billingForm.quota_per_unit || 0)}
              onChange={(value) =>
                setBillingForm({ ...billingForm, quota_per_unit: String(value ?? 0) })
              }
            />
          </FieldLabel>
          <FieldLabel
            label="零售定价倍率"
            hint="目录批发价 × 该倍率 = 对外零售价，用于反推上游成本与利润；至少 0.01，填 0 会把全表零售价算成 0 元"
          >
            <InputNumber
              min={0.01}
              max={100}
              step={0.01}
              style={{ width: "100%" }}
              value={Number(billingForm.pricing_markup || 0)}
              onChange={(value) =>
                setBillingForm({ ...billingForm, pricing_markup: String(value ?? 0) })
              }
            />
          </FieldLabel>
          <FieldLabel label="新注册用户赠送额度" hint="注册与首次登录时发放，0 表示不发放">
            <InputNumber
              min={0}
              max={1000000000}
              step={1000}
              style={{ width: "100%" }}
              value={Number(billingForm.new_user_quota || 0)}
              onChange={(value) =>
                setBillingForm({ ...billingForm, new_user_quota: String(value ?? 0) })
              }
            />
          </FieldLabel>
          <FieldLabel
            label="目录同步间隔（分钟）"
            hint="0 表示关闭定时同步；保存后最迟 1 分钟按新间隔执行，不用重启后端"
          >
            <InputNumber
              min={0}
              max={1440}
              step={1}
              style={{ width: "100%" }}
              value={Number(billingForm.catalog_sync_interval_minutes || 0)}
              onChange={(value) =>
                setBillingForm({
                  ...billingForm,
                  catalog_sync_interval_minutes: String(value ?? 0),
                })
              }
            />
          </FieldLabel>
          <FieldLabel label="开放注册" hint="关闭后仅管理员可在「账号管理」或管理菜单建号">
            <Switch
              checked={billingForm.allow_registration === "true"}
              onChange={(checked) =>
                setBillingForm({
                  ...billingForm,
                  allow_registration: checked ? "true" : "false",
                })
              }
            />
          </FieldLabel>
        </div>
        <Button
          type="primary"
          loading={saving === "billing"}
          onClick={() => void patch("billing", billingForm)}
        >
          保存计费参数
        </Button>
      </Panel>
    </>
  );
}

function pick(source: SettingsMap, keys: string[]): SettingsMap {
  const out: SettingsMap = {};
  for (const key of keys) out[key] = source[key] ?? "";
  return out;
}
