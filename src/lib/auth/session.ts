import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { adminQuery, type GlobalRole, type Session } from "@/lib/db/client";

export interface AuthSession {
  userId: string;
  email: string;
  name: string | null;
  role: GlobalRole;
  orgIds: string[];
}

export function canWrite(role: GlobalRole): boolean {
  return role !== "investor_viewer";
}

/** DB session (role + org scope) derived from the auth session. The database
 *  re-derives role/orgs itself from auth.uid(); these fields drive the UI. */
export function toDbSession(s: AuthSession): Session {
  return { userId: s.userId, orgIds: s.orgIds, role: s.role, canWrite: canWrite(s.role) };
}

/**
 * The signed-in staff session: Supabase Auth verifies the user (getUser talks
 * to the auth server — never trusts the cookie alone), then the staff profile
 * and org memberships are loaded from the database. Cached per request.
 */
export const getSession = cache(async (): Promise<AuthSession | null> => {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const profile = (await adminQuery<{ user_id: string; email: string; name: string | null; global_role: GlobalRole }>(
    "select user_id, email, name, global_role from users where user_id = $1",
    [data.user.id],
  ))[0];
  if (!profile) return null; // authenticated with Supabase but not provisioned as staff

  const memberships = await adminQuery<{ org_id: string }>(
    "select org_id from organization_members where user_id = $1",
    [profile.user_id],
  );
  return {
    userId: profile.user_id,
    email: profile.email,
    name: profile.name,
    role: profile.global_role,
    orgIds: memberships.map((m) => m.org_id),
  };
});

/** For server actions/pages: the auth session or a redirect to sign-in. */
export async function requireAuth(): Promise<AuthSession> {
  const s = await getSession();
  if (s) return s;
  const { redirect } = await import("next/navigation");
  redirect("/sign-in"); // throws NEXT_REDIRECT
  throw new Error("unreachable");
}

export async function requireDbSession(): Promise<Session> {
  return toDbSession(await requireAuth());
}
