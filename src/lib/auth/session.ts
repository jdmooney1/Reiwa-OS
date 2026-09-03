// ============================================================================
// Session — Supabase Auth owns the cookie; this module turns a verified Supabase
// user into the application's authorisation context.
// ----------------------------------------------------------------------------
// `supabase.auth.getUser()` re-validates the access token with the Auth server,
// so a tampered cookie cannot mint a session. Role and organisation scope come
// from the database, not from the token.
// ============================================================================
import * as React from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadAuthSession } from "@/lib/auth/service";
import type { GlobalRole, Session } from "@/lib/db/client";

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

/** DB session (role + org scope) derived from the auth session. */
export function toDbSession(s: AuthSession): Session {
  return { userId: s.userId, orgIds: s.orgIds, role: s.role, canWrite: canWrite(s.role) };
}

/**
 * React's per-request memo, which deduplicates the layout's and the page's
 * lookups within a single render. `cache` only exists in React's server build,
 * so outside Next (scripts, integration tests) this degrades to a plain call.
 */
function perRequest<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const reactCache = (React as { cache?: <T>(f: T) => T }).cache;
  return typeof reactCache === "function" ? reactCache(fn) : fn;
}

/** The signed-in user for this request, or null. Memoised per request. */
export const getSession = perRequest(async (): Promise<AuthSession | null> => {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return loadAuthSession(data.user.id);
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
