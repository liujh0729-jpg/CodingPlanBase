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
  // 两区按「路径前缀 + 身份」判定：平台后台是一棵独立菜单树，其余（含 `/console/*`）都在前台这一棵树里。
  // 深链到不属于当前身份的区时不渲染该区菜单，只看到前台导航。
  const isPlatformArea =
    pathname.startsWith(ADMIN_PATH_PREFIX) && Boolean(isAdmin);

  // 身份决定可见性：非管理员不渲染平台后台菜单；后台内部再按板块 minRole 过滤（模型设置＝超管）；
  // 租户那一层的管理动作不另开区、不进顶栏，就是前台侧栏里按「当前租户里的角色」多出的那一组
  // （`baseRouteFor` 的「本租户管理」组，role=5 才渲染；切租户后按新租户的角色重算）。
  const menuTree = isPlatformArea
    ? adminRouteFor(isRoot)
    : baseRouteFor({ canOrder, canManageTenant: isTenantAdmin });
  // 换区或换租户时整棵内容树都被重建：租户是记账上下文，切过去以后每个板块都要按新租户重新取数，
  // 只靠 ProLayout 自己在挂载时生成的侧栏菜单会停在上一区（客户端跳转才会暴露）；
  // 各板块的列表态留在组件里，不重挂就会看到上一个租户的数据。
  const areaKey = `${isPlatformArea ? "platform" : "front"}:${
    me?.tenantId ?? 0
  }`;
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
        // 两棵菜单树的顶层都是「分组」（前台：AI 服务 / 本租户管理 / 设置；后台：平台管理后台），不是可导航节点。
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
          // 顶栏只留「平台管理后台」这一层的进出：它是真正另起一棵菜单树的区。
          // 租户那一层的管理动作不在顶栏出现——它并入前台侧栏的「本租户管理」分组，
          // 由当前租户里的角色决定渲不渲染，用户不需要「切换区域」就能管自家成员。
          if (isAdmin) {
            const area = isPlatformArea
              ? { label: "返回前台", path: "/", icon: <AppstoreOutlined /> }
              : {
                  label: "管理后台",
                  path: ADMIN_PATH_PREFIX,
                  icon: <AppstoreOutlined />,
                };
            actions.push(
              <a
                key={area.label}
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
                  // 租户这一层的管理动作不在这里出现：它们是前台侧栏「本租户管理」那一组，
                  // 头像菜单只留个人项（与侧栏同源，不再给第二个入口）
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
