// ============================================================================
// Supabase server client (cookie-bound) — the only way request handlers talk
// to Supabase Auth. Uses the PUBLISHABLE key; privileged Postgres access
// (DATABASE_URL) and the SUPABASE_SECRET_KEY admin API live elsewhere and are
// never exposed here.
// ============================================================================
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  return url;
}

export function supabasePublishableKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set");
  return key;
}

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component (read-only cookies); the
          // middleware is responsible for refreshing sessions there.
        }
      },
    },
  });
}
