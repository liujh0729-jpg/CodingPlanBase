import type { ProLayoutProps } from "@ant-design/pro-components";
import { PRODUCT_NAME } from "@/lib/brand";

export const defaultSettings: ProLayoutProps & { logo?: string } = {
  navTheme: "light",
  colorPrimary: "#1677ff",
  layout: "mix",
  contentWidth: "Fluid",
  fixedHeader: false,
  fixSiderbar: true,
  colorWeak: false,
  title: PRODUCT_NAME,
  token: {},
};
