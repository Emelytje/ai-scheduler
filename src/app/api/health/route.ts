import { NextResponse } from "next/server";
import { configReport } from "@/lib/server/env";

export const dynamic = "force-dynamic";

/** Which integrations are configured on this deployment (names only, never values). */
export function GET() {
  return NextResponse.json({ ok: true, ...configReport() });
}
