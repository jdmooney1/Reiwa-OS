// ============================================================================
// When an investor organisation may be deleted. Pure: no React, no server imports.
// ----------------------------------------------------------------------------
// Deleting an organisation cascades (0005, 0006): its contacts, entitlements, activity
// events, requests, saved opportunities and invitations all go with it. For a record that was
// never used - test imports, a typo, a duplicate - that is what you want. For a real investor
// relationship it would destroy the history of who saw and asked about what.
//
// So deletion is allowed only for an organisation that has never been USED, and the test for
// "used" is deliberately strict. Any one of these blocks it:
//
//   * a contact with a portal sign-in (auth_user_id set) - whether or not they ever logged in;
//     deleting the contact would also orphan a real Auth account
//   * any portal activity event (a login, a view, a download, a request for information)
//   * any entitlement row, INCLUDING hidden or revoked ones. Revoking keeps the row, and a
//     revoked grant looks the same as one that was never shown, so the row is the safe signal
//   * any investor request
//   * any accepted invitation
//   * any saved opportunity
//
// An organisation that fails is not "stuck": it can be set to Suspended or Closed, which stops
// portal access and keeps the record.
// ============================================================================

export interface GuardCounts {
  contacts: number;
  /** Contacts whose portal sign-in exists (auth_user_id is set). */
  provisioned: number;
  events: number;
  entitlements: number;
  requests: number;
  acceptedInvites: number;
  saved: number;
  /** Invitations that were never accepted: deleted with the organisation, never a blocker. */
  unacceptedInvites: number;
}

export interface GuardCheck {
  key: "provisioned" | "events" | "entitlements" | "requests" | "acceptedInvites" | "saved";
  label: string;
  count: number;
  /** Every check blocks when its count is above zero. */
  blocks: boolean;
}

export interface DeletionGuard {
  allowed: boolean;
  checks: GuardCheck[];
  /** Plain-English reasons it is blocked, in the order of `checks`. Empty when allowed. */
  reasons: string[];
  /** What would be deleted along with the organisation, for the confirmation panel. */
  alsoDeleted: { contacts: number; unacceptedInvites: number };
}

const CHECKS: { key: GuardCheck["key"]; label: string; noun: [string, string] }[] = [
  { key: "provisioned", label: "Contacts with a portal sign-in", noun: ["contact with a portal sign-in", "contacts with a portal sign-in"] },
  { key: "events", label: "Portal activity (logins, views, downloads)", noun: ["portal activity event", "portal activity events"] },
  { key: "entitlements", label: "Publication entitlements, including hidden or revoked", noun: ["publication entitlement (hidden or revoked ones count)", "publication entitlements (hidden or revoked ones count)"] },
  { key: "requests", label: "Investor requests", noun: ["investor request", "investor requests"] },
  { key: "acceptedInvites", label: "Accepted invitations", noun: ["accepted invitation", "accepted invitations"] },
  { key: "saved", label: "Saved opportunities", noun: ["saved opportunity", "saved opportunities"] },
];

export function evaluateGuard(counts: GuardCounts): DeletionGuard {
  const checks: GuardCheck[] = CHECKS.map((c) => ({
    key: c.key, label: c.label, count: counts[c.key], blocks: counts[c.key] > 0,
  }));
  const reasons = CHECKS
    .filter((c) => counts[c.key] > 0)
    .map((c) => `${counts[c.key]} ${counts[c.key] === 1 ? c.noun[0] : c.noun[1]}`);
  return {
    allowed: reasons.length === 0,
    checks,
    reasons,
    alsoDeleted: { contacts: counts.contacts, unacceptedInvites: counts.unacceptedInvites },
  };
}

/** The sentence shown when a delete is refused. Says why, and what to do instead. */
export function blockedMessage(guard: DeletionGuard): string {
  return `This organisation has been used, so it cannot be deleted (${guard.reasons.join(", ")}). ` +
    "Set it to Suspended or Closed instead: that stops portal access and keeps the record.";
}

/**
 * The tables whose rows hang off an investor organisation or contact.
 *
 * `blockers` are guarded above. `cascades` are deleted with the organisation and are safe to
 * lose once every blocker is zero: a contact nobody signed in as, an invitation nobody accepted.
 * A test compares this with the foreign keys in the database, so a table added later that
 * cascades from an organisation fails that test until someone decides which list it belongs in.
 */
export const GUARD_COVERAGE = {
  blockers: [
    "investor_activity_events", "publication_entitlements", "investor_requests", "investor_saved",
  ],
  cascades: ["investor_contacts", "investor_invites"],
} as const;
