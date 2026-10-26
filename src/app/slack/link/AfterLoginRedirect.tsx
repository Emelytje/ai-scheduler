"use client";

import { useEffect } from "react";
import { AFTER_LOGIN_COOKIE } from "@/lib/after-login";

/** Remember where to come back to, then go to the sign-in page. */
export function AfterLoginRedirect({ path }: { path: string }) {
  useEffect(() => {
    document.cookie = `${AFTER_LOGIN_COOKIE}=${encodeURIComponent(path)}; path=/; max-age=900; samesite=lax`;
    window.location.href = "/login";
  }, [path]);
  return <p className="as-app as-hint">Taking you to sign in…</p>;
}
