import { NextResponse } from "next/server";
import { env } from "@/lib/server/env";
import { supabaseForRequest } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

/** Supabase Auth redirect target (magic link / Google sign-in). */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  if (code) {
    const supabase = await supabaseForRequest();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${env.appUrl}/`);
  }
  return NextResponse.redirect(`${env.appUrl}/login?error=link`);
}
