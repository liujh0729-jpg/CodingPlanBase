import styles from "./brand-logo.module.css";

type BrandLogoProps = {
  size?: number;
  className?: string;
};

/** 品牌标记：内联 SVG，不依赖任何图片资源（开源仓不分发第三方品牌素材）。 */
export function BrandLogo({ size = 32, className }: BrandLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="CodingPlan Base"
      className={[styles.logo, className].filter(Boolean).join(" ")}
    >
      <defs>
        <linearGradient id="cpb-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1677ff" />
          <stop offset="100%" stopColor="#4dd0c1" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#cpb-mark)" />
      <path
        d="M25 22 16 32l9 10M39 22l9 10-9 10M35 19l-6 26"
        fill="none"
        stroke="#fff"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
