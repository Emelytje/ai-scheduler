import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Origins allowed to iframe /embed, read per request so changing the env var needs no rebuild. */
function embedResponse() {
  const origins = (process.env.EMBED_ALLOWED_ORIGINS ?? "").split(/[\s,]+/).filter(Boolean).join(" ");
  const res = NextResponse.next();
  res.headers.set("Content-Security-Policy", `frame-ancestors 'self' ${origins}`.trim());
  return res;
}

/** Keeps the Supabase session cookie fresh on page loads (Server Components can't write cookies). */
export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/embed") return embedResponse();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.next();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // Pages only: API routes authenticate per request; webhooks and static files skip this.
  matcher: ["/((?!api|_next/static|_next/image|embed\\.js|favicon.ico).*)"],
};
