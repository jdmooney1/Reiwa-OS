// ============================================================================
// Supabase Auth clients (HTTP API only — never used to read application data).
// ----------------------------------------------------------------------------
// Application reads/writes go through the RLS-gated Postgres path in
// src/lib/db/client.ts. These clients exist to establish and verify the
// signed-in user with Supabase Auth.
// ============================================================================
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseUrl, supabasePublishableKey } from "@/lib/supabase/env";

/**
 * Request-bound client using the publishable key. Reads and refreshes the
 * Supabase session cookies. Cookie writes are a no-op inside Server Components
 * (Next forbids them there) — the middleware performs the refresh instead.
 */
export function createSupabaseServerClient(): SupabaseClient {
  const cookieStore = cookies();
  return createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component render — refresh happens in middleware.
        }
      },
    },
  });
}

/**
 * Stateless client with no cookie binding, for verifying credentials outside a
 * request (scripts, integration tests). Establishes no browser session.
 */
export function createSupabaseStatelessClient(): SupabaseClient {
  return createClient(supabaseUrl(), supabasePublishableKey(), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}
