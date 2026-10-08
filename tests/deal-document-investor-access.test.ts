// ============================================================================
// docs/24 Session 4a — investor visibility of deal_document/document_version,
// through real Postgres RLS.
// ----------------------------------------------------------------------------
// Same discipline as investor-rls.test.ts: every assertion here runs inside
// withInvestorSession() (or a direct, deliberately adversarial SQL statement
// under it), presenting nothing but a Supabase Auth user id and letting the
// database derive the rest. No permission function is mocked.
//
// NOT covered here (by design, not oversight):
//   * The actual signed-URL/watermark delivery path (secure-delivery.ts's
//     issueDocumentDownload for a deal_document) needs a real Storage object
//     to sign — that is an E2E/manual concern. What IS proven here is the
//     RLS layer underneath it (app.investor_may_read_document_version) and
//     the document_view_log write path itself, which is what that function
//     relies on and nothing it adds on top of.
//   * Watermark stamping, download-disable and expiry (Session 4b) and the
//     staff engagement view / deal_shares linkage (Session 4c) — not built
//     in this round.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { adminQuery, withSession, withInvestorSession, type Session } from "@/lib/db/client";
import { createInvestorContact, orgIdByName, orgUserSession, profileIdByEmail } from "./helpers";
import { seedDocTypes } from "@/lib/db/seed-doc-types";

let org: string;
let analyst: string;
let session: Session;
let icMemberSession: Session;

let oppId: string;
let investorOrgA: string;
let investorOrgB: string;
let dealInvestorA: string;
let dealInvestorB: string;
let contactA: { authUserId: string; investorContactId: string };
let contactB: { authUserId: string; investorContactId: string };

let teaserDocId: string;        // scope=deal, investor_teaser — exempt
let underwritingDocId: string;  // scope=deal, underwriting_model — hard-blocked
let tenancyDocId: string;       // scope=deal, tenancy_schedule — ordinary, entitlement-gated
let pitchPackDocId: string;     // scope=deal, pitch_pack — memo_backed, for the F override test
let offerLetterDocId: string;   // scope=deal, offer_letter — audience=vendor only, for the F rejection test
let ndaDocIdA: string;          // scope=investor, investor_nda, dealInvestorA — exempt, own-row-only
let ndaDocIdB: string;          // scope=investor, investor_nda, dealInvestorB
let ioiDocIdA: string;          // scope=investor, investor_ioi, dealInvestorA

/** Flip the kill switch for the duration of one test, always restoring it after. */
async function withDealRoomEnabled<T>(fn: () => Promise<T>): Promise<T> {
  await adminQuery("update platform_settings set value = 'true'::jsonb where key = 'deal_room_enabled'");
  try {
    return await fn();
  } finally {
    await adminQuery("update platform_settings set value = 'false'::jsonb where key = 'deal_room_enabled'");
  }
}

async function insertDealDocument(docTypeKey: string, dealInvestorId?: string): Promise<string> {
  const rows = dealInvestorId
    ? await withSession(session, (tx) =>
        tx.query<{ deal_document_id: string }>(
          "insert into deal_document(org_id, opportunity_id, deal_investor_id, doc_type_key) values ($1,$2,$3,$4) returning deal_document_id",
          [org, oppId, dealInvestorId, docTypeKey]))
    : await withSession(session, (tx) =>
        tx.query<{ deal_document_id: string }>(
          "insert into deal_document(org_id, opportunity_id, doc_type_key) values ($1,$2,$3) returning deal_document_id",
          [org, oppId, docTypeKey]));
  return rows.rows[0].deal_document_id;
}

async function insertDocumentVersion(opts: {
  dealDocumentId: string; language: "EN" | "JA"; isGoverning: boolean;
  translationStatus?: "convenience_translation" | "reviewed"; isManualOverride?: boolean;
}): Promise<string> {
  const rows = await withSession(session, (tx) =>
    tx.query<{ version_id: string }>(
      `insert into document_version(
         deal_document_id, version_no, language, is_governing, translation_status,
         file_url, sha256, is_manual_override, created_by)
       select $1,
              coalesce((select max(version_no) from document_version where deal_document_id = $1), 0) + 1,
              $2, $3, $4,
              'deal-documents/fixture/' || gen_random_uuid() || '.pdf',
              encode(sha256(gen_random_uuid()::text::bytea), 'hex'),
              $5, $6
       returning version_id`,
      [opts.dealDocumentId, opts.language, opts.isGoverning, opts.translationStatus ?? null,
       opts.isManualOverride ?? false, analyst]));
  return rows.rows[0].version_id;
}

async function setDealDocumentStatus(dealDocumentId: string, status: string): Promise<void> {
  await withSession(session, (tx) =>
    tx.query("update deal_document set status = $1 where deal_document_id = $2", [status, dealDocumentId]));
}

async function canReadDealDocument(authUserId: string, dealDocumentId: string): Promise<boolean> {
  const { rows } = await withInvestorSession(authUserId, (tx) =>
    tx.query<{ n: number }>(
      "select count(*)::int as n from deal_document where deal_document_id = $1", [dealDocumentId]));
  return rows[0].n > 0;
}

async function canReadVersion(authUserId: string, versionId: string): Promise<boolean> {
  const { rows } = await withInvestorSession(authUserId, (tx) =>
    tx.query<{ n: number }>(
      "select count(*)::int as n from document_version where version_id = $1", [versionId]));
  return rows[0].n > 0;
}

beforeAll(async () => {
  org = await orgIdByName("Meiji Shipping");
  analyst = await profileIdByEmail("analyst@meiji.com");
  session = orgUserSession([org], analyst);
  icMemberSession = { userId: analyst, orgIds: [org], role: "ic_member", canWrite: true };
  await seedDocTypes();

  const opp = await withSession(session, (tx) =>
    tx.query<{ opportunity_id: string }>(
      `insert into opportunities (org_id, name, market, asset_type, strategy, currency, created_by)
       values ($1,$2,'London','office','value_add','GBP',$3) returning opportunity_id`,
      [org, "90 Deal Room Fixture " + randomUUID(), analyst]));
  oppId = opp.rows[0].opportunity_id;

  const orgA = await adminQuery<{ investor_org_id: string }>(
    "insert into investor_organizations(name) values ($1) returning investor_org_id",
    ["Deal Room Investor A " + randomUUID()]);
  investorOrgA = orgA[0].investor_org_id;
  const orgB = await adminQuery<{ investor_org_id: string }>(
    "insert into investor_organizations(name) values ($1) returning investor_org_id",
    ["Deal Room Investor B " + randomUUID()]);
  investorOrgB = orgB[0].investor_org_id;

  const diA = await withSession(session, (tx) =>
    tx.query<{ deal_investor_id: string }>(
      "insert into deal_investor(org_id, opportunity_id, investor_org_id, introduced_by) values ($1,$2,$3,$4) returning deal_investor_id",
      [org, oppId, investorOrgA, analyst]));
  dealInvestorA = diA.rows[0].deal_investor_id;
  const diB = await withSession(session, (tx) =>
    tx.query<{ deal_investor_id: string }>(
      "insert into deal_investor(org_id, opportunity_id, investor_org_id, introduced_by) values ($1,$2,$3,$4) returning deal_investor_id",
      [org, oppId, investorOrgB, analyst]));
  dealInvestorB = diB.rows[0].deal_investor_id;

  contactA = await createInvestorContact(investorOrgA, `deal-room-a-${randomUUID()}@example.com`, "Deal Room Contact A");
  contactB = await createInvestorContact(investorOrgB, `deal-room-b-${randomUUID()}@example.com`, "Deal Room Contact B");

  // document_stage stays at its default (0) for this opportunity throughout
  // this file, so 0047's stage-driven auto-create never fires for any of
  // these Stage-1 types — every deal_document row below is inserted
  // directly, with no risk of colliding with an auto-created one.
  teaserDocId = await insertDealDocument("investor_teaser");
  underwritingDocId = await insertDealDocument("underwriting_model");
  tenancyDocId = await insertDealDocument("tenancy_schedule");
  pitchPackDocId = await insertDealDocument("pitch_pack");
  offerLetterDocId = await insertDealDocument("offer_letter");
  ndaDocIdA = await insertDealDocument("investor_nda", dealInvestorA);
  ndaDocIdB = await insertDealDocument("investor_nda", dealInvestorB);
  ioiDocIdA = await insertDealDocument("investor_ioi", dealInvestorA);
});

afterAll(async () => {
  await adminQuery("delete from opportunities where opportunity_id = $1", [oppId]);
  await adminQuery("delete from investor_organizations where investor_org_id = any($1::uuid[])", [[investorOrgA, investorOrgB]]);
  await adminQuery("update platform_settings set value = 'false'::jsonb where key = 'deal_room_enabled'");
});

// ---------------------------------------------------------------------------
describe("deal_room_enabled is the outer gate (0055)", () => {
  it("defaults to false, and nothing is visible while it is off — not even the NDA/teaser exemption", async () => {
    const rows = await adminQuery<{ value: unknown }>(
      "select value from platform_settings where key = 'deal_room_enabled'");
    expect(rows[0].value).toBe(false);

    await expect(canReadDealDocument(contactA.authUserId, teaserDocId)).resolves.toBe(false);
    await expect(canReadDealDocument(contactA.authUserId, ndaDocIdA)).resolves.toBe(false);
    await expect(canReadDealDocument(contactA.authUserId, tenancyDocId)).resolves.toBe(false);
  });

  it("turning it on alone is not enough — audience, exemption and entitlement rules still apply", async () => {
    await withDealRoomEnabled(async () => {
      await expect(canReadDealDocument(contactA.authUserId, underwritingDocId)).resolves.toBe(false);
      await expect(canReadDealDocument(contactA.authUserId, tenancyDocId)).resolves.toBe(false); // no entitlement yet
    });
  });
});

// ---------------------------------------------------------------------------
describe("underwriting_model is unreachable under any condition", () => {
  it("stays unreachable even against an adversarial, explicitly-visible entitlement row", async () => {
    await withSession(session, (tx) =>
      tx.query(
        "insert into deal_document_entitlements(org_id, deal_investor_id, deal_document_id, is_visible) values ($1,$2,$3,true)",
        [org, dealInvestorA, underwritingDocId]));

    await withDealRoomEnabled(async () => {
      await expect(canReadDealDocument(contactA.authUserId, underwritingDocId)).resolves.toBe(false);
    });

    await withSession(session, (tx) =>
      tx.query("delete from deal_document_entitlements where deal_document_id = $1", [underwritingDocId]));
  });
});

// ---------------------------------------------------------------------------
describe("investor_nda and investor_teaser are exempt from the entitlement gate (missing rule, added on review)", () => {
  it("both investors can read the shared teaser once matched, with no entitlement row at all", async () => {
    await withDealRoomEnabled(async () => {
      await expect(canReadDealDocument(contactA.authUserId, teaserDocId)).resolves.toBe(true);
      await expect(canReadDealDocument(contactB.authUserId, teaserDocId)).resolves.toBe(true);
    });
  });

  it("an investor can read their own NDA row before it is signed, with no entitlement row at all", async () => {
    await withDealRoomEnabled(async () => {
      await expect(canReadDealDocument(contactA.authUserId, ndaDocIdA)).resolves.toBe(true);
    });
  });

  it("investor A cannot read investor B's NDA — the exemption is own-row-only, not doc_type-wide", async () => {
    await withDealRoomEnabled(async () => {
      await expect(canReadDealDocument(contactA.authUserId, ndaDocIdB)).resolves.toBe(false);
      await expect(canReadDealDocument(contactB.authUserId, ndaDocIdA)).resolves.toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
describe("ordinary investor-audience documents are default-deny via deal_document_entitlements", () => {
  it("invisible to both investors until an entitlement row names them, visible only to the one named", async () => {
    await withDealRoomEnabled(async () => {
      await expect(canReadDealDocument(contactA.authUserId, tenancyDocId)).resolves.toBe(false);
      await expect(canReadDealDocument(contactB.authUserId, tenancyDocId)).resolves.toBe(false);

      await withSession(session, (tx) =>
        tx.query(
          "insert into deal_document_entitlements(org_id, deal_investor_id, deal_document_id, is_visible) values ($1,$2,$3,true)",
          [org, dealInvestorA, tenancyDocId]));

      await expect(canReadDealDocument(contactA.authUserId, tenancyDocId)).resolves.toBe(true);
      await expect(canReadDealDocument(contactB.authUserId, tenancyDocId)).resolves.toBe(false);

      // is_visible = false is still default-deny, not merely "no row".
      await withSession(session, (tx) =>
        tx.query("update deal_document_entitlements set is_visible = false where deal_document_id = $1", [tenancyDocId]));
      await expect(canReadDealDocument(contactA.authUserId, tenancyDocId)).resolves.toBe(false);

      await withSession(session, (tx) =>
        tx.query("delete from deal_document_entitlements where deal_document_id = $1", [tenancyDocId]));
    });
  });
});

// ---------------------------------------------------------------------------
describe("document_version: governing Final/Signed, then JA needs its own review (decision C)", () => {
  it("no version is visible until the document itself reaches Final or Signed", async () => {
    const versionId = await insertDocumentVersion({ dealDocumentId: tenancyDocId, language: "EN", isGoverning: true });
    await withSession(session, (tx) =>
      tx.query(
        "insert into deal_document_entitlements(org_id, deal_investor_id, deal_document_id, is_visible) values ($1,$2,$3,true)",
        [org, dealInvestorA, tenancyDocId]));

    await withDealRoomEnabled(async () => {
      await expect(canReadVersion(contactA.authUserId, versionId)).resolves.toBe(false); // status still 'not_started'

      await setDealDocumentStatus(tenancyDocId, "final");
      await expect(canReadVersion(contactA.authUserId, versionId)).resolves.toBe(true);
    });

    await withSession(session, (tx) =>
      tx.query("delete from deal_document_entitlements where deal_document_id = $1", [tenancyDocId]));
  });

  it("a JA version needs translation_status = reviewed, on top of the governing version being Final/Signed", async () => {
    await withSession(session, (tx) =>
      tx.query(
        "insert into deal_document_entitlements(org_id, deal_investor_id, deal_document_id, is_visible) values ($1,$2,$3,true)",
        [org, dealInvestorA, tenancyDocId]));
    await setDealDocumentStatus(tenancyDocId, "final");

    const convenience = await insertDocumentVersion({
      dealDocumentId: tenancyDocId, language: "JA", isGoverning: false, translationStatus: "convenience_translation",
    });
    const reviewed = await insertDocumentVersion({
      dealDocumentId: tenancyDocId, language: "JA", isGoverning: false, translationStatus: "reviewed",
    });

    await withDealRoomEnabled(async () => {
      await expect(canReadVersion(contactA.authUserId, convenience)).resolves.toBe(false);
      await expect(canReadVersion(contactA.authUserId, reviewed)).resolves.toBe(true);
    });

    await withSession(session, (tx) =>
      tx.query("delete from deal_document_entitlements where deal_document_id = $1", [tenancyDocId]));
    await setDealDocumentStatus(tenancyDocId, "not_started");
  });
});

// ---------------------------------------------------------------------------
describe("document_view_log: the investor-session write path (0057)", () => {
  it("an investor may log their own view of a version they may read", async () => {
    await withSession(session, (tx) =>
      tx.query(
        "insert into deal_document_entitlements(org_id, deal_investor_id, deal_document_id, is_visible) values ($1,$2,$3,true)",
        [org, dealInvestorA, tenancyDocId]));
    await setDealDocumentStatus(tenancyDocId, "signed");
    const versionId = await insertDocumentVersion({ dealDocumentId: tenancyDocId, language: "EN", isGoverning: true });

    await withDealRoomEnabled(async () => {
      await withInvestorSession(contactA.authUserId, (tx) =>
        tx.query(
          `insert into document_view_log(org_id, deal_document_id, document_version_id, investor_contact_id, action)
           values ($1,$2,$3, app.current_investor_contact_id(), 'download')`,
          [org, tenancyDocId, versionId]));

      const logged = await adminQuery<{ n: number }>(
        "select count(*)::int as n from document_view_log where document_version_id = $1 and investor_contact_id = $2",
        [versionId, contactA.investorContactId]);
      expect(logged[0].n).toBe(1);
    });

    await withSession(session, (tx) =>
      tx.query("delete from deal_document_entitlements where deal_document_id = $1", [tenancyDocId]));
    await setDealDocumentStatus(tenancyDocId, "not_started");
  });

  it("an investor cannot log a view under another contact's identity", async () => {
    await withSession(session, (tx) =>
      tx.query(
        "insert into deal_document_entitlements(org_id, deal_investor_id, deal_document_id, is_visible) values ($1,$2,$3,true)",
        [org, dealInvestorA, tenancyDocId]));
    await setDealDocumentStatus(tenancyDocId, "signed");
    const versionId = await insertDocumentVersion({ dealDocumentId: tenancyDocId, language: "EN", isGoverning: true });

    await withDealRoomEnabled(async () => {
      await expect(withInvestorSession(contactA.authUserId, (tx) =>
        tx.query(
          `insert into document_view_log(org_id, deal_document_id, document_version_id, investor_contact_id, action)
           values ($1,$2,$3,$4,'download')`,
          [org, tenancyDocId, versionId, contactB.investorContactId]),
      )).rejects.toThrow();
    });

    await withSession(session, (tx) =>
      tx.query("delete from deal_document_entitlements where deal_document_id = $1", [tenancyDocId]));
    await setDealDocumentStatus(tenancyDocId, "not_started");
  });

  it("an investor cannot log a view of a document they may not read", async () => {
    const versionId = await insertDocumentVersion({ dealDocumentId: underwritingDocId, language: "EN", isGoverning: true });
    await setDealDocumentStatus(underwritingDocId, "final");

    await withDealRoomEnabled(async () => {
      await expect(withInvestorSession(contactA.authUserId, (tx) =>
        tx.query(
          `insert into document_view_log(org_id, deal_document_id, document_version_id, investor_contact_id, action)
           values ($1,$2,$3, app.current_investor_contact_id(), 'download')`,
          [org, underwritingDocId, versionId]),
      )).rejects.toThrow();
    });

    await setDealDocumentStatus(underwritingDocId, "not_started");
  });
});

// ---------------------------------------------------------------------------
describe("deal_investor.status: nda_signed/ioi_received require the fact, or a logged override (decision B)", () => {
  it("refuses nda_signed while investor_nda is not Signed", async () => {
    await expect(withSession(session, (tx) =>
      tx.query("update deal_investor set status = 'nda_signed' where deal_investor_id = $1", [dealInvestorA]),
    )).rejects.toThrow(/investor_nda is not Signed/);
  });

  it("allows nda_signed once investor_nda is Signed", async () => {
    await setDealDocumentStatus(ndaDocIdA, "signed");
    await withSession(session, (tx) =>
      tx.query("update deal_investor set status = 'nda_signed' where deal_investor_id = $1", [dealInvestorA]));
    const after = await adminQuery<{ status: string }>(
      "select status from deal_investor where deal_investor_id = $1", [dealInvestorA]);
    expect(after[0].status).toBe("nda_signed");
  });

  it("refuses ioi_received while investor_ioi is not Final, even once past nda_signed", async () => {
    await expect(withSession(session, (tx) =>
      tx.query("update deal_investor set status = 'ioi_received' where deal_investor_id = $1", [dealInvestorA]),
    )).rejects.toThrow(/investor_ioi is not Final/);
  });

  it("a same-transaction deal_investor_status_override, by ic_member, allows the move without the fact", async () => {
    // dealInvestorB has no investor_nda at status 'signed' — the override authorises the move anyway.
    await expect(withSession(session, (tx) =>
      tx.query("update deal_investor set status = 'nda_signed' where deal_investor_id = $1", [dealInvestorB]),
    )).rejects.toThrow(/investor_nda is not Signed/);

    await withSession(icMemberSession, async (tx) => {
      await tx.query(
        "insert into gate_override(org_id, opportunity_id, deal_investor_id, gate_doc_type_key, action, reason, recorded_by) values ($1,$2,$3,'investor_nda','deal_investor_status_override','director approved by phone',$4)",
        [org, oppId, dealInvestorB, analyst]);
      return tx.query("update deal_investor set status = 'nda_signed' where deal_investor_id = $1", [dealInvestorB]);
    });

    const after = await adminQuery<{ status: string }>(
      "select status from deal_investor where deal_investor_id = $1", [dealInvestorB]);
    expect(after[0].status).toBe("nda_signed");
  });

  it("an override logged in an earlier, separate transaction does not satisfy a later move", async () => {
    await withSession(icMemberSession, (tx) =>
      tx.query(
        "insert into gate_override(org_id, opportunity_id, deal_investor_id, gate_doc_type_key, action, reason, recorded_by) values ($1,$2,$3,'investor_ioi','deal_investor_status_override','logged ahead of time',$4)",
        [org, oppId, dealInvestorA, analyst]));

    await expect(withSession(session, (tx) =>
      tx.query("update deal_investor set status = 'ioi_received' where deal_investor_id = $1", [dealInvestorA]),
    )).rejects.toThrow(/investor_ioi is not Final/);
  });

  it("allows ioi_received once investor_ioi is Final", async () => {
    await setDealDocumentStatus(ioiDocIdA, "final");
    await withSession(session, (tx) =>
      tx.query("update deal_investor set status = 'ioi_received' where deal_investor_id = $1", [dealInvestorA]));
    const after = await adminQuery<{ status: string }>(
      "select status from deal_investor where deal_investor_id = $1", [dealInvestorA]);
    expect(after[0].status).toBe("ioi_received");
  });
});

// ---------------------------------------------------------------------------
describe("document_version.is_manual_override (decision F)", () => {
  it("allows a manual override for an investor-facing Produce type whose catalogue mode is not manual_upload", async () => {
    const versionId = await insertDocumentVersion({
      dealDocumentId: pitchPackDocId, language: "EN", isGoverning: true, isManualOverride: true,
    });
    const rows = await adminQuery<{ is_manual_override: boolean }>(
      "select is_manual_override from document_version where version_id = $1", [versionId]);
    expect(rows[0].is_manual_override).toBe(true);
  });

  it("refuses a manual override for a doc_type already manual_upload in the catalogue", async () => {
    await expect(insertDocumentVersion({
      dealDocumentId: ndaDocIdA, language: "EN", isGoverning: true, isManualOverride: true,
    })).rejects.toThrow(/already manual_upload/);
  });

  it("refuses a manual override for a Produce type with no investor audience", async () => {
    await expect(insertDocumentVersion({
      dealDocumentId: offerLetterDocId, language: "EN", isGoverning: true, isManualOverride: true,
    })).rejects.toThrow(/investor-facing Produce doc_types/);
  });
});
