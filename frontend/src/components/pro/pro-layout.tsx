"use client";

import {
  ApiOutlined,
  AppstoreOutlined,
  AuditOutlined,
  DashboardOutlined,
  FileDoneOutlined,
  HomeOutlined,
  IdcardOutlined,
  KeyOutlined,
  LogoutOutlined,
  PayCircleOutlined,
  ProfileOutlined,
  RobotOutlined,
  SettingOutlined,
  ShopOutlined,
  GiftOutlined,
  UsergroupAddOutlined,
} from "@ant-design/icons";
import {
  ProLayout,
  SettingDrawer,
  type ProLayoutProps,
  type ProSettings,
} from "@ant-design/pro-components";
import { Dropdown } from "antd";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { defaultSettings } from "@/config/default-settings";
import {
  ADMIN_PATH_PREFIX,
  adminRouteFor,
  baseRouteFor,
  consoleRouteFor,
  CONSOLE_PATH,
  type BaseRoute,
} from "@/config/routes";
import { PRODUCT_NAME } from "@/lib/brand";
import { useSession } from "@/lib/session";
import { BrandLogo } from "../brand-logo";
import { ProFooter } from "./footer";
import { TenantSwitcher } from "./tenant-switcher";

const ROUTE_ICONS = {
  dashboard: <DashboardOutlined />,
  chip: <RobotOutlined />,
  key: <KeyOutlined />,
  audit: <AuditOutlined />,
  idcard: <IdcardOutlined />,
  peoples: <UsergroupAddOutlined />,
  api: <ApiOutlined />,
  order: <ProfileOutlined />,
  pay: <PayCircleOutlined />,
  shop: <ShopOutlined />,
  gift: <GiftOutlined />,
  "file-done": <FileDoneOutlined />,
  setting: <SettingOutlined />,
  home: <HomeOutlined />,
} as const;

type MenuRoute = {
  path?: string;
  name?: string;
  key?: string;
  type?: "group";
  syntheticGroup?: boolean;
  icon?: ReactNode;
  hideInMenu?: boolean;
  routes?: MenuRoute[];
};

function withRouteIcons(route: BaseRoute): MenuRoute {
  const path =
    route.path ||
    (route.type === "group" && route.name
      ? `/__menu/${encodeURIComponent(route.name)}`
      : undefined);
  return {
    path,
    name: route.name,
    key: path,
    syntheticGroup: route.type === "group",
    hideInMenu: route.hideInMenu,
    icon: route.icon
      ? ROUTE_ICONS[route.icon as keyof typeof ROUTE_ICONS]
      : undefined,
    routes: route.routes
      ?.filter((child) => !child.hideInMenu)
      .map((child) => withRouteIcons(child))
      .filter((child) =>
        child.syntheticGroup
          ? Boolean(child.routes?.length)
          : Boolean(child.path || child.routes?.length),
      ),
  };
}

const SETTINGS_KEY = "codingplan-base-pro-settings";

/** 只收真正的菜单叶子：带子项的节点（含外壳 `/` 与 `type: group` 分组）不参与选中态。 */
function leafPaths(route: BaseRoute, out: string[] = []): string[] {
  if (route.routes?.length) {
    route.routes.forEach((child) => leafPaths(child, out));
    return out;
  }
  if (route.path?.startsWith("/")) out.push(route.path);
  return out;
}

/**
 * 侧栏选中态：深链到不属于当前身份菜单树的路由（租户管理员看 `/admin/*`、平台管理员进 `/console`）时，
 * 菜单树里没有命中项，侧栏就一片没有高亮、用户不知道自己在哪；这里退回该区域的第一项，
 * 只改选中态，不改地址栏，页面本身仍按身份出「无访问权限」。
 */
function menuActivePath(tree: BaseRoute, pathname: string): string {
  const paths = leafPaths(tree);
  const exact = paths.find((item) => item === pathname);
  if (exact) return exact;
  const nested = paths
    .filter((item) => item !== "/" && pathname.startsWith(`${item}/`))
    .sort((a, b) => b.length - a.length)[0];
  if (nested) return nested;
  return paths.includes("/") ? "/" : paths[0] || pathname;
}

export function EnterpriseProLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, loading, isAdmin, isRoot, isTenantAdmin, canOrder, logout } =
    useSession();
  const [settings, setSettings] = useState<ProLayoutProps>(defaultSettings);
  const [pathnameReady, setPathnameReady] = useState(false);
  // 三区按「路径前缀 + 身份」判定：同一张 user 表只是权限分级，高一层就多一个自己的管理区域。
  // 深链到不属于当前身份的区时不渲染该区菜单，只看到前台导航。
  const isPlatformArea =
    pathname.startsWith(ADMIN_PATH_PREFIX) && Boolean(isAdmin);
  const isConsoleArea = pathname.startsWith(CONSOLE_PATH) && isTenantAdmin;

  // 身份决定可见性：非管理员不渲染平台后台菜单；后台内部再按板块 minRole 过滤（系统设置＝超管）；
  // 管理菜单只对「当前租户的管理员」渲染，且进去后整棵侧栏换成租户这一层的板块；
  // 前台的「订购管理」对租户管理员与平台管理员 / 超管都渲染（前者下单，后者看全平台单据）
  const menuTree = isPlatformArea
    ? adminRouteFor(isRoot)
    : isConsoleArea
      ? consoleRouteFor()
      : baseRouteFor({ canOrder });
  // 换区或换租户时整棵内容树都被重建：租户是记账上下文，切过去以后每个板块都要按新租户重新取数，
  // 只靠 ProLayout 自己在挂载时生成的侧栏菜单会停在上一区（客户端跳转才会暴露）；
  // 各板块的列表态留在组件里，不重挂就会看到上一个租户的数据。
  const areaKey = `${
    isPlatformArea ? "platform" : isConsoleArea ? "console" : "front"
  }:${me?.tenantId ?? 0}`;
  const menuRoute = withRouteIcons(menuTree);
  const activePath = menuActivePath(menuTree, pathname);

  useEffect(() => {
    setPathnameReady(true);
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    try {
      setSettings({
        ...defaultSettings,
        ...(JSON.parse(raw) as ProLayoutProps),
      });
    } catch {
      window.localStorage.removeItem(SETTINGS_KEY);
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle("colorWeak", Boolean(settings.colorWeak));
  }, [settings.colorWeak]);

  const displayName = me?.displayName || me?.username || "未登录";

  return (
    <div id="enterprise-pro-layout" className="enterprise-pro-layout">
      <ProLayout
        key={areaKey}
        {...settings}
        // 三棵菜单树的顶层都是「分组」（AI 服务 / 设置 / 平台管理后台 / 管理菜单），不是可导航节点。
        // 默认 sub 模式会把分组渲染成可折叠 submenu：折叠分组的子项根本不在 DOM 里，
        // 用户返回前台就看到一个光秃秃的「设置」标题，误以为菜单丢了——这里固定用 group 模式常驻展开。
        menu={{ type: "group" }}
        logo={<BrandLogo />}
        location={{ pathname: pathnameReady ? activePath : "/" }}
        route={menuRoute}
        menuItemRender={(item, dom) => {
          if (!item.path || item.children?.length) {
            return dom;
          }
          return (
            <a
              onClick={(event) => {
                event.preventDefault();
                router.push(item.path || "/");
              }}
            >
              {dom}
            </a>
          );
        }}
        menuProps={{
          onClick: ({ key, domEvent }) => {
            domEvent.preventDefault();
            if (typeof key === "string" && key.startsWith("/")) {
              router.push(key);
            }
          },
        }}
        breadcrumbRender={(routers = []) => [
          { path: "/", title: PRODUCT_NAME },
          ...routers,
        ]}
        itemRender={(route) => {
          const href =
            "path" in route && typeof route.path === "string"
              ? route.path
              : "/";
          const title =
            ("title" in route && route.title) ||
            ("breadcrumbName" in route && route.breadcrumbName) ||
            href;
          return <Link href={href || "/"}>{title}</Link>;
        }}
        actionsRender={() => {
          // 顶栏第一件事是「现在在哪个租户里记账」：一个账号可属多个租户，切过去以后
          // 额度、令牌、用量、账单都按那一个租户算；没有租户身份时这里就是创建/加入引导。
          const actions: ReactNode[] = [<TenantSwitcher key="tenant" />];
          // 前台 ↔ 本层管理入口的切换：平台管理员切「管理后台」，租户管理员切「管理菜单」，
          // 已在管理区内则切回前台。
          const area = isPlatformArea
            ? { label: "返回前台", path: "/", icon: <AppstoreOutlined /> }
            : isAdmin
              ? { label: "管理后台", path: ADMIN_PATH_PREFIX, icon: <AppstoreOutlined /> }
              : isConsoleArea
                ? { label: "返回前台", path: "/", icon: <ShopOutlined /> }
                : isTenantAdmin
                  ? {
                      label: "管理菜单",
                      path: CONSOLE_PATH,
                      icon: <ShopOutlined />,
                    }
                  : null;
          if (area) {
            actions.push(
              <a
                key="area"
                style={{ color: "inherit" }}
                onClick={(event) => {
                  event.preventDefault();
                  router.push(area.path);
                }}
              >
                {area.icon} {area.label}
              </a>,
            );
          }
          return actions;
        }}
        avatarProps={{
          size: "small",
          title: loading ? "…" : displayName,
          render: (_, avatarChildren) => (
            <Dropdown
              menu={{
                items: [
                  {
                    key: "account",
                    icon: <IdcardOutlined />,
                    label: "账号设置",
                    onClick: () => router.push("/account"),
                  },
                  {
                    key: "usage",
                    icon: <AuditOutlined />,
                    label: "用量与额度",
                    onClick: () => router.push("/usage"),
                  },
                  // 租户这一层的管理入口，只有租户管理员看得到
                  ...(isTenantAdmin
                    ? [
                        {
                          key: "console",
                          icon: <ShopOutlined />,
                          label: "管理菜单",
                          onClick: () => router.push(CONSOLE_PATH),
                        },
                      ]
                    : []),
                  { type: "divider" },
                  {
                    key: "logout",
                    icon: <LogoutOutlined />,
                    label: "退出登录",
                    onClick: logout,
                  },
                ],
              }}
            >
              {avatarChildren}
            </Dropdown>
          ),
        }}
        footerRender={() => <ProFooter />}
      >
        {children}
      </ProLayout>
      <SettingDrawer
        disableUrlParams
        enableDarkTheme
        hideHintAlert
        hideCopyButton
        settings={settings as ProSettings}
        onSettingChange={(next) => {
          const merged = { ...defaultSettings, ...next };
          setSettings(merged);
          window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
        }}
        getContainer={() =>
          document.getElementById("enterprise-pro-layout") || document.body
        }
      />
    </div>
  );
}
