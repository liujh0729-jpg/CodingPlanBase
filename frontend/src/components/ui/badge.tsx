import type { ReactNode } from "react";

const VARIANTS = new Set(["green", "orange", "red", "sky", "blue", "gray", "violet"]);

/** 徽标：`.badge` + `.badge-{variant}`；variant 缺省或非法时落灰。 */
export function Badge({
  label,
  variant = "gray",
}: {
  label: ReactNode;
  variant?: string;
}) {
  return (
    <span className={`badge badge-${VARIANTS.has(variant) ? variant : "gray"}`}>
      {label}
    </span>
  );
}
