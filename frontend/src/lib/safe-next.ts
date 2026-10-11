/** Only allow a path on this site as an authentication return target. */
export function safeNextPath(raw?: string | null, fallback = "/") {
  if (
    !raw ||
    !raw.startsWith("/") ||
    raw.startsWith("//") ||
    raw.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(raw)
  ) {
    return fallback;
  }
  return raw;
}
