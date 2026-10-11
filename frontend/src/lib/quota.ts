"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

/**
 * 额度换算比例（1 元 = N 额度）只有一个来源：后端设置。
 * 读 `/gateway/wallet` 而不是 `/settings`——前者对任何登录用户开放，前后台的令牌表单
 * 能用同一个口径，不用把管理员专属接口下放。
 */
export function useQuotaPerUnit(): number {
  const [perUnit, setPerUnit] = useState(0);
  useEffect(() => {
    let alive = true;
    void api<{ quotaPerUnit: number }>("/gateway/wallet")
      .then((payload) => {
        if (!alive || payload.code !== 0) return;
        setPerUnit(Math.trunc(Number(payload.data?.quotaPerUnit) || 0));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return perUnit;
}

/** 表单里的换算提示：比例没读到之前不编一个数字出来。 */
export function quotaUnitHint(perUnit: number) {
  return perUnit > 0
    ? `1 元 = ${perUnit.toLocaleString("zh-CN")} 额度`
    : '额度按后台「计费与换算」的比例折算';
}
