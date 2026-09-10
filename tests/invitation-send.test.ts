// ============================================================================
// Sending an invitation, against the real database.
// ----------------------------------------------------------------------------
// The admin workflow changed from "mint a link and post it somewhere yourself"
// to "send the invitation". That moves a bearer credential out of an admin's
// clipboard and into one email — which is better, but only if two things hold
// absolutely:
//
//   * the raw token never escapes the send, and
//   * a minted invitation is never left live when the email did not go.
//
// The second is the one that bites. A naive implementation mints, fails to
// send, reports an error, and leaves a working invitation in the database that
// nobody knows exists and nobody will revoke. Both are asserted below against
// real rows, with a transport that can be failed on demand.
//
// Self-contained fixture; nothing seeded is touched.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminQuery, type Session } from "@/lib/db/client";
import { createSupabaseAdminClient, ensureAuthUser } from "@/lib/supabase/admin";
import { DEMO_PASSWORD } from "@/lib/db/seed";
import { createOpportunity } from "@/lib/data/opportunities";
import {
  createInvestorOrganization, createInvestorContact, updateInvestorContact,
  updateInvestorOrganization, createPublicationFromOpportunity, updateDraftVersion,
  publishVersion, grantEntitlement, listEntitlements, updateEntitlement,
} from "@/lib/data/investor-portal";
import { listInvitesForContact, validateInviteToken } from "@/lib/data/investor-invites";
import { deliverInvitation, assertSendable } from "@/lib/invitations/send";
import { investorPortalUrl } from "@/lib/email/portal-url";
import type { OutboundEmail, SendResult } from "@/lib/email/send";
import {
  INVITATION_SUBJECT, invitationEmailHtml, invitationEmailText,
} from "@/lib/email/invitation-email";
import { adminSession, orgIdByName, orgUserSession, profileIdByEmail } from "./helpers";

const ORIGIN = "https://portal.reiwa-capital.com";

const READY = "ready@p7-invite.example";        // active, provisioned, entitled
const UNPROVISIONED = "raw@p7-invite.example";  // no Auth identity
const DORMANT = "dormant@p7-invite.example";    // deactivated
const SUSPENDED = "suspended@p7-invite.example"; // organisation suspended
const UNENTITLED = "empty@p7-invite.example";   // no visible entitlement

let staff: Session;
let adminUserId: string;
let readyId: string;
let unprovisionedId: string;
let dormantId: string;
let suspendedId: string;
let unentitledId: string;
let unentitledOrgId: string;

/** A transport that records what it was asked to send, and can be failed. */
function recordingTransport(outcome: SendResult = { ok: true, id: "test-message" }) {
  const sent: OutboundEmail[] = [];
  return {
    sent,
    transport: {
      async send(message: OutboundEmail): Promise<SendResult> {
        sent.push(message);
        return outcome;
      },
    },
  };
}

async function contactFor(email: string, orgId: string, name: string): Promise<string> {
  const supabase = createSupabaseAdminClient();
  const authUserId = await ensureAuthUser(supabase,
    { email, password: DEMO_PASSWORD, name });
  return createInvestorContact(adminSession, {
    investorOrgId: orgId, email, name, authUserId,
  });
}

/** An organisation with one published, visible publication. */
async function entitledOrg(name: string, publication: string): Promise<string> {
  const orgId = await createInvestorOrganization(adminSession, {
    name, notes: "Created by tests/invitation-send.test.ts.",
  });
  const opportunityId = await createOpportunity(staff, {
    orgId: await orgIdByName("Meiji Shipping"),
    name: publication, city: "London", country: "United Kingdom", market: "London",
    assetType: "office", strategy: "core", currency: "GBP",
    targetPrice: 10_000_000, niy: 4, targetIrr: 10,
    summary: `${publication} — internal summary.`,
  });
  const created = await createPublicationFromOpportunity(adminSession, opportunityId, adminUserId);
  await updateDraftVersion(adminSession, created.versionId, {
    headline: `${publication} headline`, highlights: ["A point"],
  });
  await publishVersion(adminSession, created.versionId, adminUserId);
  await grantEntitlement(adminSession, {
    investorOrgId: orgId, publicationId: created.publicationId, isVisible: true,
    placement: "featured", documentAccessLevel: "standard",
  }, adminUserId);
  return orgId;
}

beforeAll(async () => {
  staff = orgUserSession([await orgIdByName("Meiji Shipping")]);
  adminUserId = await profileIdByEmail("admin@reiwa.com");

  const readyOrg = await entitledOrg("P7 Ready Partners", "P7 Ready Tower");
  readyId = await contactFor(READY, readyOrg, "R. Ready");
  unprovisionedId = await createInvestorContact(adminSession, {
    investorOrgId: readyOrg, email: UNPROVISIONED, name: "U. Unprovisioned",
  });
  dormantId = await contactFor(DORMANT, readyOrg, "D. Dormant");
  await updateInvestorContact(adminSession, dormantId, { isActive: false });

  const suspendedOrg = await entitledOrg("P7 Suspended Trust", "P7 Suspended Tower");
  suspendedId = await contactFor(SUSPENDED, suspendedOrg, "S. Suspended");
  await updateInvestorOrganization(adminSession, suspendedOrg, { status: "suspended" });

  // Entitled, then hidden — so the row exists but nothing is visible.
  unentitledOrgId = await entitledOrg("P7 Empty House", "P7 Empty Tower");
  unentitledId = await contactFor(UNENTITLED, unentitledOrgId, "E. Empty");
  const [entitlement] = await listEntitlements(adminSession, unentitledOrgId);
  await updateEntitlement(adminSession, entitlement.entitlementId, { isVisible: false });
});

// ============================================================================
describe("A successful send", () => {
  it("emails the contact's own stored address, once", async () => {
    const { sent, transport } = recordingTransport();
    const result = await deliverInvitation(adminSession, readyId, ORIGIN, adminUserId, transport);

    expect(sent.length).toBe(1);
    expect(sent[0].to).toBe(READY);
    expect(result.sentTo).toBe(READY);
    expect(sent[0].subject).toBe(INVITATION_SUBJECT);
  });

  it("leaves exactly one live invitation behind", async () => {
    const { transport } = recordingTransport();
    await deliverInvitation(adminSession, readyId, ORIGIN, adminUserId, transport);

    const invites = await listInvitesForContact(adminSession, readyId);
    expect(invites.filter((i) => i.state === "active").length).toBe(1);
  });

  it("carries a working invitation link that the investor can still use", async () => {
    const { sent, transport } = recordingTransport();
    await deliverInvitation(adminSession, readyId, ORIGIN, adminUserId, transport);

    const url = sent[0].html.match(/https:\/\/portal\.reiwa-capital\.com\/access\/([A-Za-z0-9_-]+)/);
    expect(url, "no /access link in the email").not.toBeNull();

    // The link identifies context and nothing more — validating it yields the
    // invitation, and no session of any kind.
    const validation = await validateInviteToken(url![1]);
    expect(validation.ok).toBe(true);
    expect(validation.ok && validation.contactEmail).toBe(READY);
  });

  it("returns the address and nothing that could be replayed", async () => {
    const { transport } = recordingTransport();
    const result = await deliverInvitation(adminSession, readyId, ORIGIN, adminUserId, transport);

    // The whole return value, serialised, contains no token and no link.
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("/access/");
    expect(Object.keys(result).sort()).toEqual(["expiresAt", "replacedPrevious", "sentTo"]);
  });
});

// ============================================================================
describe("Prerequisites", () => {
  const refuses = async (contactId: string, pattern: RegExp) => {
    const { sent, transport } = recordingTransport();
    await expect(deliverInvitation(adminSession, contactId, ORIGIN, adminUserId, transport))
      .rejects.toThrow(pattern);
    // Nothing was sent AND nothing was minted.
    expect(sent.length).toBe(0);
    const invites = await listInvitesForContact(adminSession, contactId);
    expect(invites.filter((i) => i.state === "active").length).toBe(0);
  };

  it("refuses a contact with no provisioned sign-in", async () => {
    await refuses(unprovisionedId, /provision/i);
  });

  it("refuses a deactivated contact", async () => {
    await refuses(dormantId, /deactivated/i);
  });

  it("refuses a contact of a suspended organisation", async () => {
    await refuses(suspendedId, /suspended/i);
  });

  it("refuses a contact with no visible opportunity", async () => {
    await refuses(unentitledId, /visible opportunity/i);
  });

  it("refuses a contact that does not exist", async () => {
    const { sent, transport } = recordingTransport();
    await expect(deliverInvitation(
      adminSession, "00000000-0000-4000-8000-000000000000", ORIGIN, adminUserId, transport))
      .rejects.toThrow(/not found/i);
    expect(sent.length).toBe(0);
  });

  it("accepts the contact once the missing entitlement is made visible", async () => {
    const [entitlement] = await listEntitlements(adminSession, unentitledOrgId);
    await updateEntitlement(adminSession, entitlement.entitlementId, { isVisible: true });
    await expect(assertSendable(adminSession, unentitledId)).resolves.toBeTruthy();
    await updateEntitlement(adminSession, entitlement.entitlementId, { isVisible: false });
  });
});

// ============================================================================
describe("Resending", () => {
  it("invalidates the previous invitation", async () => {
    const first = recordingTransport();
    await deliverInvitation(adminSession, readyId, ORIGIN, adminUserId, first.transport);
    const firstToken = first.sent[0].html
      .match(/\/access\/([A-Za-z0-9_-]+)/)![1];
    expect((await validateInviteToken(firstToken)).ok).toBe(true);

    const second = recordingTransport();
    const result = await deliverInvitation(adminSession, readyId, ORIGIN, adminUserId, second.transport);
    const secondToken = second.sent[0].html
      .match(/\/access\/([A-Za-z0-9_-]+)/)![1];

    // The admin is told the previous one is dead...
    expect(result.replacedPrevious).toBe(true);
    // ...and it actually is.
    const stale = await validateInviteToken(firstToken);
    expect(stale.ok).toBe(false);
    expect(stale.ok === false && stale.reason).toBe("revoked");
    // Only the new one works, and it is a different token.
    expect(secondToken).not.toBe(firstToken);
    expect((await validateInviteToken(secondToken)).ok).toBe(true);

    const invites = await listInvitesForContact(adminSession, readyId);
    expect(invites.filter((i) => i.state === "active").length).toBe(1);
  });

  it("reports replacedPrevious false when there was nothing live to replace", async () => {
    const orgId = await entitledOrg("P7 First Send House", "P7 First Send Tower");
    const contactId = await contactFor("first@p7-invite.example", orgId, "F. First");
    const { transport } = recordingTransport();
    const result = await deliverInvitation(adminSession, contactId, ORIGIN, adminUserId, transport);
    expect(result.replacedPrevious).toBe(false);
  });
});

// ============================================================================
describe("When the email cannot be sent", () => {
  it("cancels the invitation it just created", async () => {
    const orgId = await entitledOrg("P7 Bounce Partners", "P7 Bounce Tower");
    const contactId = await contactFor("bounce@p7-invite.example", orgId, "B. Bounce");

    const { sent, transport } = recordingTransport({ ok: false, reason: "HTTP 422 validation_error" });
    await expect(deliverInvitation(adminSession, contactId, ORIGIN, adminUserId, transport))
      .rejects.toThrow(/could not be emailed/i);

    // It tried...
    expect(sent.length).toBe(1);
    // ...and what it minted is not live. No working link exists that nobody
    // knows about.
    const invites = await listInvitesForContact(adminSession, contactId);
    expect(invites.length).toBe(1);
    expect(invites[0].state).toBe("revoked");

    const token = sent[0].html.match(/\/access\/([A-Za-z0-9_-]+)/)![1];
    const validation = await validateInviteToken(token);
    expect(validation.ok).toBe(false);
    expect(validation.ok === false && validation.reason).toBe("revoked");
  });

  it("leaves a retry able to send a fresh invitation", async () => {
    const orgId = await entitledOrg("P7 Retry Partners", "P7 Retry Tower");
    const contactId = await contactFor("retry@p7-invite.example", orgId, "R. Retry");

    const failing = recordingTransport({ ok: false, reason: "HTTP 500" });
    await expect(deliverInvitation(adminSession, contactId, ORIGIN, adminUserId, failing.transport))
      .rejects.toThrow();

    const succeeding = recordingTransport();
    const result = await deliverInvitation(
      adminSession, contactId, ORIGIN, adminUserId, succeeding.transport);
    expect(result.sentTo).toBe("retry@p7-invite.example");

    const invites = await listInvitesForContact(adminSession, contactId);
    expect(invites.filter((i) => i.state === "active").length).toBe(1);
    // The failed attempt's token is still dead.
    const deadToken = failing.sent[0].html.match(/\/access\/([A-Za-z0-9_-]+)/)![1];
    expect((await validateInviteToken(deadToken)).ok).toBe(false);
  });

  it("never puts the token or the link in the log line", async () => {
    const orgId = await entitledOrg("P7 Quiet Partners", "P7 Quiet Tower");
    const contactId = await contactFor("quiet@p7-invite.example", orgId, "Q. Quiet");

    const logged: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { logged.push(args); };
    let token = "";
    try {
      const { sent, transport } = recordingTransport({ ok: false, reason: "HTTP 403" });
      await expect(deliverInvitation(adminSession, contactId, ORIGIN, adminUserId, transport))
        .rejects.toThrow();
      token = sent[0].html.match(/\/access\/([A-Za-z0-9_-]+)/)![1];
    } finally {
      console.error = original;
    }

    const flat = JSON.stringify(logged);
    expect(flat.length, "the failure was not logged at all").toBeGreaterThan(0);
    expect(flat).toContain("invitation.send");   // the scope IS logged
    expect(flat).toContain("HTTP 403");          // and the reason
    expect(flat).not.toContain(token);           // the token is NOT
    expect(flat).not.toContain("/access/");      // nor the link
  });
});

// ============================================================================
describe("The raw token", () => {
  it("is never stored in the database", async () => {
    const { sent, transport } = recordingTransport();
    await deliverInvitation(adminSession, readyId, ORIGIN, adminUserId, transport);
    const token = sent[0].html.match(/\/access\/([A-Za-z0-9_-]+)/)![1];

    // Every column of every invitation row, as text.
    const rows = await adminQuery<Record<string, unknown>>("select * from investor_invites");
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(token);

    // It is findable only by hash.
    const { hashInviteToken } = await import("@/lib/data/investor-invites");
    const byHash = await adminQuery<{ n: string }>(
      "select count(*)::text as n from investor_invites where token_hash = $1",
      [hashInviteToken(token)]);
    expect(Number(byHash[0].n)).toBe(1);
  });

  it("appears in the email exactly once, in the link", async () => {
    const { sent, transport } = recordingTransport();
    await deliverInvitation(adminSession, readyId, ORIGIN, adminUserId, transport);
    const message = sent[0];
    const token = message.html.match(/\/access\/([A-Za-z0-9_-]+)/)![1];

    expect(message.subject).not.toContain(token);
    // Once in the HTML (the href), once in the text alternative (the same link).
    expect(message.html.split(token).length - 1).toBe(1);
    expect(message.text.split(token).length - 1).toBe(1);
  });

  it("is not recorded in the investor activity trail", async () => {
    const { sent, transport } = recordingTransport();
    await deliverInvitation(adminSession, readyId, ORIGIN, adminUserId, transport);
    const token = sent[0].html.match(/\/access\/([A-Za-z0-9_-]+)/)![1];

    const events = await adminQuery<Record<string, unknown>>(
      "select * from investor_activity_events");
    expect(JSON.stringify(events)).not.toContain(token);
  });
});

// ============================================================================
describe("The invitation email itself", () => {
  const content = {
    recipientName: "K. Arai",
    invitationUrl: `${ORIGIN}/access/sample-token`,
    origin: ORIGIN,
    expiresOn: "24 Sept 2026",
  };

  it("uses the requested subject and body", () => {
    expect(INVITATION_SUBJECT).toBe("Invitation | Reiwa Capital Investment Portal");
    const html = invitationEmailHtml(content);
    expect(html).toContain("You have been invited to access the Reiwa Capital Investment Portal.");
  });

  it("carries one call to action, pointing at the invitation link", () => {
    const html = invitationEmailHtml(content);
    expect(html).toContain("Access Investment Portal");
    // Exactly one anchor in the whole message.
    expect(html.match(/<a\s/g)?.length ?? 0).toBe(1);
    expect(html).toContain(`href="${content.invitationUrl}"`);
  });

  it("uses the Reiwa visual language", () => {
    const html = invitationEmailHtml(content);
    expect(html).toContain("#F3EFE7");        // cream ground
    expect(html).toContain("#271430");        // the one purple
    expect(html).toContain("'DM Sans'");      // the brand face
    expect(html).toContain(`${ORIGIN}/brand/reiwa-capital-logo.png`);
  });

  it("names the intended recipient", () => {
    expect(invitationEmailHtml(content))
      .toContain("This invitation is intended only for K. Arai");
    expect(invitationEmailText(content))
      .toContain("This invitation is intended only for K. Arai");
  });

  it("tells the investor a code is still required", () => {
    // The link is context, not authentication, and the email says so.
    expect(invitationEmailHtml(content)).toMatch(/one-time code/i);
    expect(invitationEmailText(content)).toMatch(/one-time code/i);
  });

  it("escapes a recipient name rather than interpolating markup", () => {
    const html = invitationEmailHtml({ ...content, recipientName: '<script>x</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ============================================================================
// The link's origin is configuration, never the request.
// ----------------------------------------------------------------------------
// A poisoned Host header would put a working invitation link to somebody
// else's domain into an investor's inbox, sent from Reiwa's own mail server
// and signed with Reiwa's name. One environment variable removes the whole
// class of problem, so the rules that keep it correct are pinned here.
// ============================================================================
describe("The canonical portal URL", () => {
  it("accepts the production value and strips a trailing slash", () => {
    expect(investorPortalUrl("https://portal.reiwa-capital.com"))
      .toBe("https://portal.reiwa-capital.com");
    expect(investorPortalUrl("https://portal.reiwa-capital.com/"))
      .toBe("https://portal.reiwa-capital.com");
    expect(investorPortalUrl("  https://portal.reiwa-capital.com/  "))
      .toBe("https://portal.reiwa-capital.com");
  });

  it("is send-required, not boot-required: absence fails only here, and clearly", () => {
    for (const missing of [undefined, "", "   "]) {
      expect(() => investorPortalUrl(missing)).toThrow(/INVESTOR_PORTAL_URL/);
      expect(() => investorPortalUrl(missing)).toThrow(/no invitation was sent/i);
    }
  });

  it("refuses plain http anywhere but a local host", () => {
    expect(() => investorPortalUrl("http://portal.reiwa-capital.com")).toThrow(/https/i);
    // Development and tests still work.
    expect(investorPortalUrl("http://localhost:3100")).toBe("http://localhost:3100");
    expect(investorPortalUrl("http://127.0.0.1:3100")).toBe("http://127.0.0.1:3100");
  });

  it("refuses an origin carrying a path, query or fragment", () => {
    // Silently truncating these would produce a link that 404s for the
    // investor and looks like Reiwa's mistake.
    expect(() => investorPortalUrl("https://portal.reiwa-capital.com/portal"))
      .toThrow(/no path/i);
    expect(() => investorPortalUrl("https://portal.reiwa-capital.com/?x=1"))
      .toThrow(/no path/i);
    expect(() => investorPortalUrl("https://portal.reiwa-capital.com/#top"))
      .toThrow(/no path/i);
  });

  it("refuses anything that is not a URL", () => {
    for (const bad of ["portal.reiwa-capital.com", "not a url", "://broken"]) {
      expect(() => investorPortalUrl(bad)).toThrow(/valid URL|https/i);
    }
  });

  it("keeps a non-default port", () => {
    expect(investorPortalUrl("https://portal.reiwa-capital.com:8443"))
      .toBe("https://portal.reiwa-capital.com:8443");
  });

  it("composes the invitation link onto the configured origin", async () => {
    const { sent, transport } = recordingTransport();
    const origin = investorPortalUrl("https://portal.reiwa-capital.com/");
    await deliverInvitation(adminSession, readyId, origin, adminUserId, transport);
    expect(sent[0].html).toContain("https://portal.reiwa-capital.com/access/");
    // No doubled slash from the trailing-slash form.
    expect(sent[0].html).not.toContain("com//access");
  });

  it("reads no request header anywhere in the invitation path", () => {
    // The rule is structural: if these modules cannot see a header, a header
    // cannot reach a link.
    const files = [
      "src/lib/email/portal-url.ts",
      "src/lib/email/invitation-email.ts",
      "src/lib/invitations/send.ts",
      "src/app/actions/admin-invites.ts",
    ];
    for (const file of files) {
      const code = readFileSync(join(process.cwd(), file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect({ file, readsHeaders: /next\/headers|x-forwarded-host|headers\(\)/i.test(code) })
        .toEqual({ file, readsHeaders: false });
    }
  });
});
