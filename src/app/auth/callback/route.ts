import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { AFTER_LOGIN_COOKIE, safeAfterLoginPath } from "@/lib/after-login";
import { env } from "@/lib/server/env";
import { supabaseForRequest } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/** Supabase Auth redirect target (magic link / Google sign-in). */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  if (code) {
    const supabase = await supabaseForRequest();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const jar = await cookies();
      const next = safeAfterLoginPath(jar.get(AFTER_LOGIN_COOKIE)?.value);
      jar.delete(AFTER_LOGIN_COOKIE);
      return NextResponse.redirect(`${env.appUrl}${next}`);
    }
  }
  return NextResponse.redirect(`${env.appUrl}/login?error=link`);
}
