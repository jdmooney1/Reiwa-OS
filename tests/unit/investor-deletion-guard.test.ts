import { describe, it, expect } from "vitest";
import { evaluateGuard, blockedMessage, GUARD_COVERAGE, type GuardCounts } from "@/lib/investor/deletion-guard";

const ZERO: GuardCounts = {
  contacts: 0, provisioned: 0, events: 0, entitlements: 0, requests: 0,
  acceptedInvites: 0, saved: 0, unacceptedInvites: 0,
};
const BLOCKERS = ["provisioned", "events", "entitlements", "requests", "acceptedInvites", "saved"] as const;

describe("the deletion guard", () => {
  it("allows an organisation with nothing on it", () => {
    const g = evaluateGuard(ZERO);
    expect(g.allowed).toBe(true);
    expect(g.reasons).toEqual([]);
    expect(g.checks.map((c) => c.key)).toEqual([...BLOCKERS]);
    expect(g.checks.every((c) => !c.blocks)).toBe(true);
  });

  it.each(BLOCKERS)("is blocked by %s alone", (key) => {
    const g = evaluateGuard({ ...ZERO, [key]: 1 });
    expect(g.allowed).toBe(false);
    expect(g.reasons).toHaveLength(1);
    expect(g.checks.filter((c) => c.blocks).map((c) => c.key)).toEqual([key]);
  });

  it("is NOT blocked by contacts nobody signed in as, or by invitations nobody accepted", () => {
    const g = evaluateGuard({ ...ZERO, contacts: 4, unacceptedInvites: 2 });
    expect(g.allowed).toBe(true);
    expect(g.alsoDeleted).toEqual({ contacts: 4, unacceptedInvites: 2 });
  });

  it("lists every reason, in a fixed order, singular and plural", () => {
    const g = evaluateGuard({ ...ZERO, provisioned: 1, events: 14, entitlements: 1, requests: 2, acceptedInvites: 1, saved: 3 });
    expect(g.reasons).toEqual([
      "1 contact with a portal sign-in",
      "14 portal activity events",
      "1 publication entitlement (hidden or revoked ones count)",
      "2 investor requests",
      "1 accepted invitation",
      "3 saved opportunities",
    ]);
  });

  it("tells the admin what to do instead, in plain words", () => {
    const msg = blockedMessage(evaluateGuard({ ...ZERO, events: 3 }));
    expect(msg).toContain("3 portal activity events");
    expect(msg).toContain("Suspended or Closed");
    expect(msg).not.toMatch(/constraint|violates|investor_|public\./i);
  });

  it("covers the four dependent tables and two cascades it was written against", () => {
    expect([...GUARD_COVERAGE.blockers].sort()).toEqual(
      ["investor_activity_events", "investor_requests", "investor_saved", "publication_entitlements"]);
    expect([...GUARD_COVERAGE.cascades].sort()).toEqual(["investor_contacts", "investor_invites"]);
  });
});
