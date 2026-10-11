"use client";

import type { CSSProperties, ReactNode } from "react";

export type HeroTab = { key: string; label: string; count?: number };

/**
 * 页签条（`.tabs` + `.tab-item` 胶囊分段）：放不下时**整行折到第二行**。
 * 不用 antd `Segmented`：它的滑块动效 + 放不下时的内部横滚会「跳」
 * （点页签时隐藏 radio 获焦，浏览器为露出获焦项会横滚宿主容器）。
 */
export function TabStrip({
  items,
  value,
  onChange,
  style,
}: {
  items: HeroTab[];
  value?: string;
  onChange: (key: string) => void;
  style?: CSSProperties;
}) {
  return (
    <div className="tabs" role="tablist" style={style}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === value}
          className={item.key === value ? "tab-item active" : "tab-item"}
          onClick={() => onChange(item.key)}
        >
          {item.count ? `${item.label}（${item.count}）` : item.label}
        </button>
      ))}
    </div>
  );
}

/**
 * 页头：标题与页签条同处首行（页签贴右上角），板块介绍整行落在标题下方 ——
 * 页签条与介绍各占一行，互不挤压（页签条放不下时整行折到第二行）。
 */
export function PageHero({
  title,
  desc,
  tabs,
  activeTab,
  onTabChange,
  extra,
}: {
  title: string;
  desc?: ReactNode;
  tabs?: HeroTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  extra?: ReactNode;
}) {
  return (
    <div className="page-hero">
      <div className="page-hero-head">
        <h2 className="page-hero-title">{title}</h2>
        <div className="page-hero-side">
          {tabs?.length ? (
            <TabStrip
              items={tabs}
              value={activeTab}
              onChange={(key) => onTabChange?.(key)}
            />
          ) : null}
          {extra}
        </div>
      </div>
      {desc ? <p className="page-hero-desc">{desc}</p> : null}
    </div>
  );
}

/**
 * 栏目内子视图切换器：放在面板正文首行、随面板标题一起切换（同「灵工发薪」子页签口径），
 * 不放 .panel-head —— 否则窄容器下中文长标题会被切换器挤压换行。
 */
export function ColumnSwitch({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <TabStrip
      items={options.map((item) => ({ key: item.value, label: item.label }))}
      value={value}
      onChange={onChange}
      style={{ marginBottom: 12 }}
    />
  );
}

export function Panel({
  title,
  extra,
  children,
  titleBadge,
}: {
  title: string;
  extra?: ReactNode;
  children: ReactNode;
  titleBadge?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{title}</h3>
        {/* 说明与标题平级：放不下时说明整段换行，标题不被挤压（见 globals.css 的 .panel-head） */}
        {titleBadge ? <span className="panel-badge">{titleBadge}</span> : null}
        {extra ? <div className="panel-extra">{extra}</div> : null}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="stat-card">
      {icon ? <div className="stat-ico">{icon}</div> : null}
      <div style={{ minWidth: 0 }}>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {hint ? <div className="stat-hint">{hint}</div> : null}
      </div>
    </div>
  );
}

export function Notice({
  variant = "info",
  children,
}: {
  variant?: "info" | "warn" | "error" | "success";
  children: ReactNode;
}) {
  return <div className={`notice notice-${variant}`}>{children}</div>;
}

export function EmptyState({
  icon = "📭",
  text,
}: {
  icon?: string;
  text: string;
}) {
  return (
    <div className="empty">
      <div className="empty-ico">{icon}</div>
      <div>{text}</div>
    </div>
  );
}