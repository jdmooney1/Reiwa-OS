// ============================================================================
// Supabase Auth session refresh.
// ----------------------------------------------------------------------------
// Access tokens are short-lived. Server Components cannot write cookies, so the
// refresh happens here and the rotated cookies are attached to the response.
// This runs on the Edge runtime: it touches Supabase Auth only, never Postgres.
// Route protection itself stays in the (app) layout and the server actions,
// which is where the authorisation context is assembled.
// ============================================================================
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { optionalSupabaseSessionConfig } from "@/lib/supabase/env";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Resolved through the shared accessor rather than read statically here:
  // Next inlines a statically-named NEXT_PUBLIC_ variable into the edge bundle
  // at BUILD time, which would pin this middleware to whichever project the
  // build was made against even when the process has been pointed at another
  // one. The session cookie this refreshes has to belong to the same project
  // the server actions authenticate against, or nobody stays signed in.
  const config = optionalSupabaseSessionConfig();
  if (!config) return response;

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Touching getUser() is what performs the refresh.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
