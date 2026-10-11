"use client";

import { DefaultFooter } from "@ant-design/pro-components";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/brand";

export function ProFooter() {
  return (
    <DefaultFooter
      className="enterprise-footer"
      copyright={`${new Date().getFullYear()} ${PRODUCT_NAME} · ${PRODUCT_TAGLINE}`}
    />
  );
}
