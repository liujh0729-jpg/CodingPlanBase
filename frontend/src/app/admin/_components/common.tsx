"use client";

import type { TablePaginationConfig } from "antd";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/datetime";

/* ============================================================
   管理后台：取数（403 友好提示不崩页面）与共享表格口径
   ============================================================ */

export type LoadResult<T> = {
  data: T | null;
  forbidden: boolean;
  message: string;
};

/**
 * 取数统一入口：失败（无权限 / 接口异常）不抛错，交由页面展示友好提示。
 * 管理接口均需管理员，普通用户返回 20002（ROLE_MISMATCH，HTTP 403）。
 */
export async function loadApi<T>(path: string): Promise<LoadResult<T>> {
  try {
    const payload = await api<T>(path);
    if (payload.code === 0) {
      return { data: payload.data, forbidden: false, message: "" };
    }
    return {
      data: null,
      forbidden: payload.code === 20002 || payload.code === 403,
      message: payload.message || "加载失败",
    };
  } catch (error) {
    return { data: null, forbidden: false, message: (error as Error).message };
  }
}

export const tablePagination: TablePaginationConfig = {
  pageSize: 10,
  pageSizeOptions: [10, 20, 50],
  showSizeChanger: true,
  showTotal: (total) => `共 ${total} 条`,
};

/** 设置类表单的「标签 + 控件 + 说明」三段式，全站设置页统一走这里。 */
export function FieldLabel({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="ant-form-item" style={{ marginBottom: 16 }}>
      <div className="text-12 muted" style={{ marginBottom: 4 }}>
        {label}
      </div>
      {children}
      {hint ? (
        <div className="text-12 muted" style={{ marginTop: 4 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export { fmtTime };
