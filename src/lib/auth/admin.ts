// ============================================================================
// Investment Portal admin gate — who may see /admin and call its mutations.
// ----------------------------------------------------------------------------
// The role model is P0's: only the `reiwa_admin` global role runs the portal.
// This module is the APPLICATION-level gate (clean 404s and clear errors); the
// ENFORCEMENT stays in the database — every portal table's write policy
// requires app.is_admin(), so a request that somehow slipped past this check
// would still find no rows to read and no permission to write.
// ============================================================================
import type { AuthSession } from "@/lib/auth/session";
import { getSession, toDbSession } from "@/lib/auth/session";
import type { Session } from "@/lib/db/client";

export function isPortalAdmin(session: Pick<AuthSession, "role">): boolean {
  return session.role === "reiwa_admin";
}

/** Throwing guard for server actions. */
export function assertPortalAdmin(session: Pick<AuthSession, "role">): void {
  if (!isPortalAdmin(session)) {
    throw new Error("Not authorised — the Investment Portal admin is restricted to Reiwa administrators.");
  }
}

/**
 * For /admin pages: the signed-in Reiwa admin, a redirect to sign-in, or a 404.
 * A 404 rather than a 403 — non-admin staff should not learn the admin surface
 * exists from an error page.
 */
export async function requireAdminAuth(): Promise<AuthSession> {
  const session = await getSession();
  if (!session) {
    const { redirect } = await import("next/navigation");
    redirect("/sign-in");
  }
  if (!isPortalAdmin(session!)) {
    const { notFound } = await import("next/navigation");
    notFound();
  }
  return session!;
}

/** For admin server actions: authenticated + reiwa_admin, or throw. */
export async function requireAdminSession(): Promise<{ auth: AuthSession; db: Session }> {
  const session = await getSession();
  if (!session) throw new Error("Not signed in.");
  assertPortalAdmin(session);
  return { auth: session, db: toDbSession(session) };
}
