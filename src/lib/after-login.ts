export const AFTER_LOGIN_COOKIE = "after_login";

/** Only same-site paths, never "//host" or absolute URLs (open redirect). */
export function safeAfterLoginPath(value: string | undefined | null): string {
  if (!value) return "/";
  let v = value;
  try {
    v = decodeURIComponent(value);
  } catch {
    return "/";
  }
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/";
}
