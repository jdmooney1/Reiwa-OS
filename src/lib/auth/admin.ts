// ============================================================================
// Supabase Auth Admin API — the ONLY module that uses SUPABASE_SECRET_KEY.
// Kept deliberately separate from privileged Postgres access (DATABASE_URL in
// src/lib/db/client.ts): one is an HTTPS API credential for managing auth
// users, the other a database connection. Neither ever reaches the browser.
// ============================================================================
import { supabaseUrl } from "@/lib/auth/supabase-server";

function secretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  return key;
}

/** Create a confirmed email+password auth user; returns the auth user id. */
export async function createAuthUser(email: string, password: string, name?: string | null): Promise<string> {
  const res = await fetch(`${supabaseUrl()}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: secretKey(),
      authorization: `Bearer ${secretKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: name ? { name } : {},
    }),
  });
  if (!res.ok) {
    throw new Error(`Auth admin createUser failed (${res.status}): ${await res.text()}`);
  }
  const body = (await res.json()) as { id?: string };
  if (!body.id) throw new Error("Auth admin createUser returned no id");
  return body.id;
}
