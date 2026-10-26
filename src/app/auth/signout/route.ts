import { NextResponse } from "next/server";
import { env } from "@/lib/server/env";
import { supabaseForRequest } from "@/lib/server/supabase";

export async function POST() {
  const supabase = await supabaseForRequest();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${env.appUrl}/login`, { status: 303 });
}
