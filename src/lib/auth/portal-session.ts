// ============================================================================
// Kind-aware sessions (P3) — one Supabase Auth user resolves to ONE identity.
// ----------------------------------------------------------------------------
// Two identity kinds exist and never blend:
//
//   internal — a `profiles` row (P0). Staff keep email/password sign-in and
//              the internal Reiwa OS surface.
//   investor — an active `investor_contacts` row of an active organisation,
//              anchored on auth_user_id (P1). OTP-only, portal surface only.
//
// Resolution order is deliberate: the internal identity wins. A staff member
// whose email happens to overlap an investor contact is NEVER treated as an
// investor, and an investor (no profiles row) can never resolve internally —
// requireAuth() already turns them away from every internal route.
//
// Nothing about organisations, entitlements or document tiers lives in the
// session or the token. This module resolves only WHO the user is; WHAT they
// may see stays derived inside the database from auth.uid() (P1 helpers).
// ============================================================================
import { adminQuery } from "@/lib/db/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { loadAuthSession } from "@/lib/auth/service";
import type { AuthSession } from "@/lib/auth/session";

export interface PortalIdentity {
  authUserId: string;
  investorContactId: string;
  investorOrgId: string;
  email: string;
  name: string;
  title: string | null;
  investorOrgName: string;
}

/**
 * The ACTIVE investor contact behind a Supabase Auth user id, or null.
 * Deactivated contacts and non-active organisations resolve to nothing — the
 * same rule app.current_investor_contact_id() applies inside the database.
 * Privileged lookup, like P0 session assembly: identity resolution only.
 */
export async function loadPortalIdentity(authUserId: string): Promise<PortalIdentity | null> {
  const rows = await adminQuery<{
    investor_contact_id: string; investor_org_id: string; email: string;
    name: string; title: string | null; org_name: string;
  }>(
    `select c.investor_contact_id, c.investor_org_id, c.email, c.name, c.title,
            o.name as org_name
       from investor_contacts c
       join investor_organizations o on o.investor_org_id = c.investor_org_id
      where c.auth_user_id = $1
        and c.is_active
        and o.status = 'active'`,
    [authUserId]);
  const r = rows[0];
  if (!r) return null;
  return {
    authUserId,
    investorContactId: r.investor_contact_id,
    investorOrgId: r.investor_org_id,
    email: r.email,
    name: r.name,
    title: r.title,
    investorOrgName: r.org_name,
  };
}

export type Identity =
  | { kind: "internal"; session: AuthSession }
  | { kind: "investor"; investor: PortalIdentity };

/** The one identity behind the current request's Supabase session, or null. */
export async function resolveIdentity(): Promise<Identity | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const internal = await loadAuthSession(data.user.id);
  if (internal) return { kind: "internal", session: internal };

  const investor = await loadPortalIdentity(data.user.id);
  if (investor) return { kind: "investor", investor };
  return null;
}

/** The signed-in INVESTOR for this request, or null (staff resolve to null). */
export async function getPortalSession(): Promise<PortalIdentity | null> {
  const identity = await resolveIdentity();
  return identity?.kind === "investor" ? identity.investor : null;
}

/**
 * For /portal pages: the investor identity, or the explicit redirect the
 * session kind calls for — staff back to the internal app, everyone else to
 * the investor access flow.
 */
export async function requirePortalSession(): Promise<PortalIdentity> {
  const identity = await resolveIdentity();
  const { redirect } = await import("next/navigation");
  if (identity?.kind === "investor") return identity.investor;
  if (identity?.kind === "internal") redirect("/portfolio");
  redirect("/portal/verify");
  throw new Error("unreachable");
}
