// ============================================================================
// Auth service — Supabase Auth verifies credentials; the database supplies the
// application authorisation context (global role + organisation scope).
// ----------------------------------------------------------------------------
// The role and org scope are ALWAYS read from the database on the privileged
// connection, never taken from anything the client can influence. They are then
// presented to RLS as transaction-local claims by withSession().
// ============================================================================
import { adminQuery } from "@/lib/db/client";
import { createSupabaseStatelessClient } from "@/lib/supabase/server";
import type { AuthSession } from "@/lib/auth/session";
import type { GlobalRole } from "@/lib/db/client";

interface ProfileRow {
  user_id: string;
  email: string;
  name: string | null;
  global_role: GlobalRole;
}

/** Assemble the authorisation context for an authenticated Supabase user id. */
export async function loadAuthSession(userId: string): Promise<AuthSession | null> {
  const profiles = await adminQuery<ProfileRow>(
    "select user_id, email, name, global_role from profiles where user_id = $1",
    [userId],
  );
  const profile = profiles[0];
  if (!profile) return null;

  const memberships = await adminQuery<{ org_id: string }>(
    "select org_id from organization_members where user_id = $1",
    [userId],
  );
  return {
    userId: profile.user_id,
    email: profile.email,
    name: profile.name,
    role: profile.global_role,
    orgIds: memberships.map((m) => m.org_id),
  };
}

/**
 * Verify email + password against Supabase Auth without establishing a browser
 * session. Used by scripts and integration tests; the sign-in server action uses
 * the cookie-bound client instead so the session is persisted.
 */
export async function authenticate(email: string, password: string): Promise<AuthSession | null> {
  const supabase = createSupabaseStatelessClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error || !data.user) return null;
  return loadAuthSession(data.user.id);
}
