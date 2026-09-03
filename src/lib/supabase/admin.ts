// ============================================================================
// Supabase Admin API client (SUPABASE_SECRET_KEY).
// ----------------------------------------------------------------------------
// SERVER-ONLY, and used for exactly one job: managing Supabase Auth users
// (creating the seeded staff accounts). It is never used to read or write
// application tables — that is the RLS-gated Postgres path's responsibility —
// and the secret key must never reach a browser bundle.
// ============================================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl, supabaseSecretKey } from "@/lib/supabase/env";

export function createSupabaseAdminClient(): SupabaseClient {
  return createClient(supabaseUrl(), supabaseSecretKey(), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export interface StaffAccount {
  email: string;
  password: string;
  name: string;
}

/**
 * Idempotently ensure a Supabase Auth user exists with this email, returning its
 * id. An existing account keeps its password; a new one is created pre-confirmed
 * so it can sign in immediately.
 */
export async function ensureAuthUser(admin: SupabaseClient, account: StaffAccount): Promise<string> {
  const existing = await findAuthUserByEmail(admin, account.email);
  if (existing) return existing;

  const { data, error } = await admin.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: { name: account.name },
  });
  if (error || !data.user) {
    throw new Error(`Could not create Supabase Auth user ${account.email}: ${error?.message ?? "no user returned"}`);
  }
  return data.user.id;
}

/** Page through Auth users to find one by email (the Admin API has no direct lookup). */
export async function findAuthUserByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list Supabase Auth users: ${error.message}`);
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Remove a Supabase Auth user (used to keep the dev project tidy). */
export async function deleteAuthUser(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`Could not delete Supabase Auth user ${userId}: ${error.message}`);
}
