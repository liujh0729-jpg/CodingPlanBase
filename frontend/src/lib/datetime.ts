/** 后端时间统一为 ISO(UTC)，展示一律转本地时区的 `YYYY-MM-DD HH:mm`。 */
export function fmtDateTime(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.replace("T", " ").slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** 列表「时间」列口径：全站统一走这里，各页面不要再各自实现。 */
export function fmtTime(value: unknown): string {
  return fmtDateTime(value);
}

/** 日期列：仅取 YYYY-MM-DD。 */
export function fmtDate(value: unknown): string {
  const raw = String(value ?? "");
  return raw ? raw.slice(0, 10) : "—";
}
