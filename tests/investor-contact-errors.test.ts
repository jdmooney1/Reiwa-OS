// ============================================================================
// Adding or editing an investor contact with an email that is already taken.
// ----------------------------------------------------------------------------
// investor_contacts_email_key is a unique index on lower(email) across the WHOLE table (0005),
// not one per organisation. A duplicate used to throw the raw database error to the staff
// boundary, which replaced the investor page with "This screen could not be loaded". It must
// now come back as a sentence an admin can act on, naming no other organisation.
// Fixtures: two ZZTEST organisations created here and removed afterwards.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminQuery } from "@/lib/db/client";
import {
  createInvestorOrganization, createInvestorContact, updateInvestorContact,
  DUPLICATE_CONTACT_EMAIL_MESSAGE, isDuplicateContactEmail,
} from "@/lib/data/investor-portal";
import { AppError, looksInternal } from "@/lib/errors";
import { runAction } from "@/lib/actions/run-action";
import { adminSession } from "./helpers";

const EMAIL = "zztest.first@example.invalid";
let orgA = "", orgB = "", contactA = "", contactB = "";
const ORG_A_NAME = "ZZTEST Contact Errors Alpha", ORG_B_NAME = "ZZTEST Contact Errors Beta";

beforeAll(async () => {
  orgA = await createInvestorOrganization(adminSession, { name: ORG_A_NAME });
  orgB = await createInvestorOrganization(adminSession, { name: ORG_B_NAME });
  contactA = await createInvestorContact(adminSession, { investorOrgId: orgA, name: "ZZTEST First", email: EMAIL });
  contactB = await createInvestorContact(adminSession, { investorOrgId: orgB, name: "ZZTEST Second", email: "zztest.second@example.invalid" });
});

afterAll(async () => {
  await adminQuery("delete from investor_organizations where investor_org_id = any($1::uuid[])", [[orgA, orgB]]);
});

async function refusal(work: () => Promise<unknown>): Promise<unknown> {
  try { await work(); } catch (e) { return e; }
  return null;
}

describe("a duplicate contact email", () => {
  it("is refused as a plain sentence when the address is on ANOTHER organisation", async () => {
    const e = await refusal(() => createInvestorContact(adminSession, { investorOrgId: orgB, name: "ZZTEST Dup", email: EMAIL }));
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).message).toBe(DUPLICATE_CONTACT_EMAIL_MESSAGE);
  });

  it("is refused the same way for a different spelling of the same address", async () => {
    const e = await refusal(() => createInvestorContact(adminSession, { investorOrgId: orgB, name: "ZZTEST Dup", email: "  ZZTest.First@Example.INVALID " }));
    expect((e as AppError).message).toBe(DUPLICATE_CONTACT_EMAIL_MESSAGE);
  });

  it("is refused on the SAME organisation too", async () => {
    const e = await refusal(() => createInvestorContact(adminSession, { investorOrgId: orgA, name: "ZZTEST Dup", email: EMAIL }));
    expect((e as AppError).message).toBe(DUPLICATE_CONTACT_EMAIL_MESSAGE);
  });

  it("is refused when an EDIT moves a contact onto an address that is taken", async () => {
    const e = await refusal(() => updateInvestorContact(adminSession, contactB, { email: EMAIL }));
    expect((e as AppError).message).toBe(DUPLICATE_CONTACT_EMAIL_MESSAGE);
  });

  it("names no organisation, no identifier and nothing that looks like database output", () => {
    expect(DUPLICATE_CONTACT_EMAIL_MESSAGE).not.toContain(ORG_A_NAME);
    expect(DUPLICATE_CONTACT_EMAIL_MESSAGE).not.toContain(ORG_B_NAME);
    expect(DUPLICATE_CONTACT_EMAIL_MESSAGE).not.toContain(EMAIL);
    expect(looksInternal(DUPLICATE_CONTACT_EMAIL_MESSAGE)).toBe(false);
  });

  it("reaches the form as { error } through runAction, not as a throw", async () => {
    const result = await runAction("test.contact.create", { orgB }, async () => {
      await createInvestorContact(adminSession, { investorOrgId: orgB, name: "ZZTEST Dup", email: EMAIL });
    });
    expect(result).toEqual({ error: DUPLICATE_CONTACT_EMAIL_MESSAGE });
  });

  it("leaves no half-written contact behind", async () => {
    const rows = await adminQuery("select 1 from investor_contacts where investor_org_id = $1 and name = 'ZZTEST Dup'", [orgB]);
    expect(rows).toHaveLength(0);
  });
});

describe("everything else still behaves", () => {
  it("accepts a new address, and an edit that keeps the contact's own address", async () => {
    await updateInvestorContact(adminSession, contactA, { name: "ZZTEST First Renamed", email: EMAIL });
    const id = await createInvestorContact(adminSession, { investorOrgId: orgB, name: "ZZTEST Third", email: "zztest.third@example.invalid" });
    expect(id).toBeTruthy();
  });

  it("does NOT dress up other database failures as the duplicate message", async () => {
    // A foreign-key failure is a different refusal: it must still reach the boundary as a fault.
    const e = await refusal(() => createInvestorContact(adminSession, {
      investorOrgId: "00000000-0000-0000-0000-000000000000", name: "ZZTEST Orphan", email: "zztest.orphan@example.invalid" }));
    expect(e).not.toBeNull();
    expect(e).not.toBeInstanceOf(AppError);
    expect(isDuplicateContactEmail(e)).toBe(false);
  });

  it("recognises only that one constraint", () => {
    expect(isDuplicateContactEmail({ code: "23505", constraint: "investor_contacts_email_key" })).toBe(true);
    expect(isDuplicateContactEmail({ code: "23505", constraint: "investor_contacts_auth_user_id_key" })).toBe(false);
    expect(isDuplicateContactEmail({ code: "23503", constraint: "investor_contacts_email_key" })).toBe(false);
    expect(isDuplicateContactEmail(null)).toBe(false);
  });
});
