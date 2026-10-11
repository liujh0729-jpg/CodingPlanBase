import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { PRODUCT_NAME } from "@/lib/brand";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: PRODUCT_NAME,
    template: `%s | ${PRODUCT_NAME}`,
  },
  description:
    "CodingPlan Base 编程底座：本地用户与分级权限、AI 服务、调用计费与额度分配、B 端在线支付骨架。",
  icons: {
    icon: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <div id="enterprise-root">
          <Providers>
            <AppShell>{children}</AppShell>
          </Providers>
        </div>
      </body>
    </html>
  );
}
