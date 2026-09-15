// ============================================================================
// Phase 1A — the pre-acquisition truth layer.
// ----------------------------------------------------------------------------
// These tests exist to prove the INVARIANTS, not the CRUD. Anything that can be
// enforced by the database is asserted against the database: a rule that only
// the data layer enforces is a rule the next caller can skip.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { adminQuery, type Session } from "@/lib/db/client";
import { createOpportunity, updateOpportunity, getOpportunity } from "@/lib/data/opportunities";
import {
  createVersion, updateVersion, currentVersion, approvedVersion,
  listVersions, getVersion, makeCurrent,
} from "@/lib/data/underwriting";
import {
  applyDdTemplate, listDdItems, updateDdItem, addDdItem, appliedTemplates,
} from "@/lib/data/due-diligence";
import {
  promoteFindingToRisk, listRisks, updateRisk, carryForwardRisks, createRisk,
} from "@/lib/data/opportunity-risks";
import {
  recordDecision, listDecisions, approvingDecision,
  amendDecision, listAmendments, effectiveDecision,
} from "@/lib/data/ic-decisions";
import { recordDocument, listDocuments } from "@/lib/data/opportunity-documents";
import { computeProgress, criticalOpenItems } from "@/lib/dd/progress";
import { orgIdByName, orgUserSession, viewerSession, profileIdByEmail } from "./helpers";

let meiji: string;
let aoyama: string;
let analyst: string;
let viewerId: string;
let aoyamaUserId: string;
let session: Session;

// Real seeded profiles, not the synthetic ids other suites use: every record
// here carries a creator, and a creator that does not exist is not a creator.
beforeAll(async () => {
  meiji = await orgIdByName("Meiji Shipping");
  aoyama = await orgIdByName("Aoyama Holdings");
  analyst = await profileIdByEmail("analyst@meiji.com");
  viewerId = await profileIdByEmail("viewer@meiji.com");
  aoyamaUserId = await profileIdByEmail("user@aoyama.com");
  session = orgUserSession([meiji], analyst);
});

/**
 * An opportunity logged but not yet underwritten — no economics, so no
 * investment case. That is the honest starting state, and it keeps version
 * numbering in these tests meaningful: version 1 is whatever the test creates.
 */
async function newOpportunity(name: string): Promise<string> {
  return createOpportunity(session, {
    orgId: meiji, name, city: "London", country: "United Kingdom",
    market: "London", assetType: "office", strategy: "value_add",
    currency: "GBP",
  });
}

// ---------------------------------------------------------------------------
describe("Underwriting versions", () => {
  it("creates an investment case for an opportunity and computes total cost", async () => {
    const opp = await newOpportunity("UW Create");
    const caseId = await createVersion(session, opp, {
      strategy: "value_add", thesis: "Reversionary Mayfair office.",
      acquisitionPrice: 20_000_000, acquisitionCosts: 1_200_000, capex: 3_000_000,
      noi: 900_000, debt: 12_000_000, ltvPct: 60, debtCostPct: 5.25,
      holdPeriodYears: 5, entryYieldPct: 4.5, exitYieldPct: 4.25,
      exitValue: 32_000_000, targetIrr: 14.5, targetEquityMultiple: 1.8,
      assumptions: { rentFreeMonths: 9, exitCostsPct: 1.5 },
    });

    const v = await getVersion(session, caseId);
    expect(v).not.toBeNull();
    expect(v!.version).toBe(1);
    expect(v!.status).toBe("current");
    // Generated in Postgres: 20.0m + 1.2m + 3.0m
    expect(v!.totalCost).toBe(24_200_000);
    expect(v!.assumptions).toEqual({ rentFreeMonths: 9, exitCostsPct: 1.5 });
    expect(v!.createdBy).toBe(session.userId);
  });

  it("identifies the current working version, and only one can exist", async () => {
    const opp = await newOpportunity("UW Current");
    const v1 = await createVersion(session, opp, { acquisitionPrice: 10_000_000 });
    const v2 = await createVersion(session, opp, { acquisitionPrice: 11_000_000 });

    const current = await currentVersion(session, opp);
    expect(current!.caseId).toBe(v2);
    expect(current!.version).toBe(2);

    // v1 was demoted, not deleted — the history is intact.
    const all = await listVersions(session, opp);
    expect(all).toHaveLength(2);
    expect(all.find((x) => x.caseId === v1)!.status).toBe("draft");

    // The database refuses a second `current`, not just the data layer.
    await expect(adminQuery(
      `update investment_cases set status = 'current' where case_id = $1`, [v1],
    )).rejects.toThrow(/investment_cases_single_current/);
  });

  it("supersedes a version by promoting another to current", async () => {
    const opp = await newOpportunity("UW Supersede");
    const v1 = await createVersion(session, opp, { acquisitionPrice: 5_000_000 });
    const v2 = await createVersion(session, opp, { acquisitionPrice: 6_000_000, changeRationale: "Repriced after survey." });
    expect((await currentVersion(session, opp))!.caseId).toBe(v2);

    await makeCurrent(session, v1);
    expect((await currentVersion(session, opp))!.caseId).toBe(v1);
    expect((await getVersion(session, v2))!.status).toBe("draft");
  });

  it("edits a draft but refuses to alter an approved version", async () => {
    const opp = await newOpportunity("UW Immutable");
    const caseId = await createVersion(session, opp, { acquisitionPrice: 8_000_000 });

    await updateVersion(session, caseId, { acquisitionPrice: 8_500_000 });
    expect((await getVersion(session, caseId))!.acquisitionPrice).toBe(8_500_000);

    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved" });

    // Through the data layer...
    await expect(updateVersion(session, caseId, { acquisitionPrice: 1 }))
      .rejects.toThrow(/immutable/i);
    // ...and directly, bypassing it entirely.
    await expect(adminQuery(
      "update investment_cases set noi = 1 where case_id = $1", [caseId],
    )).rejects.toThrow(/immutable/i);
    await expect(adminQuery(
      "delete from investment_cases where case_id = $1", [caseId],
    )).rejects.toThrow(/immutable/i);

    expect((await getVersion(session, caseId))!.acquisitionPrice).toBe(8_500_000);
  });

  it("refuses to reopen an approved version as the working version", async () => {
    const opp = await newOpportunity("UW Reopen");
    const caseId = await createVersion(session, opp, { acquisitionPrice: 9_000_000 });
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved" });
    await expect(makeCurrent(session, caseId)).rejects.toThrow(/cannot be reopened/i);
  });
});

// ---------------------------------------------------------------------------
describe("Investment committee decisions", () => {
  it("identifies the IC-approved version, and approval stamps the case", async () => {
    const opp = await newOpportunity("IC Approve");
    const caseId = await createVersion(session, opp, { acquisitionPrice: 15_000_000, targetIrr: 13 });

    expect(await approvedVersion(session, opp)).toBeNull();

    await recordDecision(session, opp, {
      investmentCaseId: caseId, outcome: "approved",
      recommendation: "proceed", rationale: "Basis supports the business plan.",
      decisionMakers: ["J Mooney", "External adviser"],
    });

    const approved = await approvedVersion(session, opp);
    expect(approved!.caseId).toBe(caseId);
    expect(approved!.approvedAt).not.toBeNull();
    expect(approved!.approvedBy).toBe(session.userId);

    const decision = await approvingDecision(session, opp);
    expect(decision!.investmentCaseId).toBe(caseId);
    expect(decision!.decisionMakers).toEqual(["J Mooney", "External adviser"]);
  });

  it("does not approve anything on a deferral or a rejection", async () => {
    const opp = await newOpportunity("IC Defer");
    const caseId = await createVersion(session, opp, { acquisitionPrice: 7_000_000 });

    await recordDecision(session, opp, {
      investmentCaseId: caseId, outcome: "deferred", rationale: "Return with the structural survey.",
    });
    expect(await approvedVersion(session, opp)).toBeNull();
    expect((await getVersion(session, caseId))!.status).toBe("current");

    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "rejected" });
    expect(await approvedVersion(session, opp)).toBeNull();
    expect((await getVersion(session, caseId))!.approvedAt).toBeNull();

    // Both minutes survive. A rejection is part of the record, not an absence.
    const decisions = await listDecisions(session, opp);
    expect(decisions.map((d) => d.outcome).sort()).toEqual(["deferred", "rejected"]);
  });

  it("cannot be edited into an approval after the fact", async () => {
    const opp = await newOpportunity("IC Tamper");
    const caseId = await createVersion(session, opp, { acquisitionPrice: 4_000_000 });
    const decisionId = await recordDecision(session, opp, {
      investmentCaseId: caseId, outcome: "rejected", rationale: "Price.",
    });

    await expect(adminQuery(
      "update ic_decisions set outcome = 'approved' where decision_id = $1", [decisionId],
    )).rejects.toThrow(/cannot be altered/i);
    await expect(adminQuery(
      "delete from ic_decisions where decision_id = $1", [decisionId],
    )).rejects.toThrow(/permanent record/i);

    expect(await approvedVersion(session, opp)).toBeNull();
  });

  it("refuses a decision on another opportunity's underwriting", async () => {
    const a = await newOpportunity("IC Cross A");
    const b = await newOpportunity("IC Cross B");
    const caseA = await createVersion(session, a, { acquisitionPrice: 1_000_000 });

    await expect(recordDecision(session, b, { investmentCaseId: caseA, outcome: "approved" }))
      .rejects.toThrow(/ic_decisions_case_fkey|foreign key/i);
  });

  it("supersedes the previous approval when a re-underwrite is approved", async () => {
    const opp = await newOpportunity("IC Reapprove");
    const v1 = await createVersion(session, opp, { acquisitionPrice: 20_000_000 });
    await recordDecision(session, opp, { investmentCaseId: v1, outcome: "approved" });

    const v2 = await createVersion(session, opp, {
      acquisitionPrice: 18_500_000, changeRationale: "Repriced after diligence.",
    });
    await recordDecision(session, opp, {
      investmentCaseId: v2, outcome: "approved_with_conditions",
      conditions: "Subject to the roof warranty being assigned.",
    });

    expect((await getVersion(session, v1))!.status).toBe("superseded");
    expect((await getVersion(session, v1))!.supersededAt).not.toBeNull();
    const approved = await approvedVersion(session, opp);
    expect(approved!.caseId).toBe(v2);
    // One live approved version, always.
    const live = await listVersions(session, opp);
    expect(live.filter((v) => v.status === "approved")).toHaveLength(1);
  });

  it("requires conditions to be stated when approving with conditions", async () => {
    const opp = await newOpportunity("IC Conditions");
    const caseId = await createVersion(session, opp, {});
    await expect(recordDecision(session, opp, {
      investmentCaseId: caseId, outcome: "approved_with_conditions",
    })).rejects.toThrow(/conditions/i);
  });
});

// ---------------------------------------------------------------------------
describe("Due diligence", () => {
  it("instantiates the framework against the opportunity, not a deal", async () => {
    const opp = await newOpportunity("DD Apply");
    const n = await applyDdTemplate(session, opp);
    expect(n).toBeGreaterThan(20);

    const items = await listDdItems(session, opp);
    expect(items).toHaveLength(n);
    expect(items.every((i) => i.opportunity_id === opp)).toBe(true);
    expect(items.every((i) => i.status === "not_started")).toBe(true);
    // London market → the UK framework.
    expect(items.some((i) => i.jurisdiction === "UK")).toBe(true);
    expect(items.some((i) => i.section === "Tenure and Ownership")).toBe(true);

    // The preserved progress model reads the persisted rows unchanged.
    const progress = computeProgress(items);
    expect(progress.total).toBe(n);
    expect(progress.cleared).toBe(0);
    expect(progress.pct).toBe(0);
  });

  it("refuses to apply the same framework over itself", async () => {
    const opp = await newOpportunity("DD Double");
    await applyDdTemplate(session, opp);
    await expect(applyDdTemplate(session, opp)).rejects.toThrow(/already been applied/i);
  });

  it("stamps completion from the status rather than trusting the caller", async () => {
    const opp = await newOpportunity("DD Complete");
    const id = await addDdItem(session, opp, { section: "Planning and Heritage", item: "Listed consent" });

    await updateDdItem(session, id, { status: "in_progress" });
    expect((await listDdItems(session, opp))[0].completedAt).toBeNull();

    await updateDdItem(session, id, { status: "reviewed", finding: "Consent granted 2019." });
    expect((await listDdItems(session, opp))[0].completedAt).not.toBeNull();

    // Reopening clears it: a completion date must never outlive its status.
    await updateDdItem(session, id, { status: "issue_identified" });
    expect((await listDdItems(session, opp))[0].completedAt).toBeNull();
  });

  it("cannot belong to an opportunity that does not exist", async () => {
    await expect(adminQuery(
      `insert into opportunity_dd_items(org_id, opportunity_id, section, item)
       values ($1, '00000000-0000-0000-0000-0000000000ff', 'X', 'Y')`, [meiji],
    )).rejects.toThrow(/foreign key/i);
  });

  it("disappears with its opportunity rather than dangling", async () => {
    const opp = await newOpportunity("DD Cascade");
    await addDdItem(session, opp, { section: "SWOT", item: "Weaknesses" });
    await adminQuery("delete from opportunities where opportunity_id = $1", [opp]);
    const rows = await adminQuery(
      "select 1 from opportunity_dd_items where opportunity_id = $1", [opp]);
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("Risks", () => {
  it("promotes a diligence finding into a persistent risk that keeps its source", async () => {
    const opp = await newOpportunity("Risk Promote");
    const ddId = await addDdItem(session, opp, {
      section: "Planning and Heritage", item: "Listed building consent",
      question: "Is consent required for the proposed works?", riskLevel: "high",
    });
    await updateDdItem(session, ddId, {
      status: "issue_identified", finding: "Consent required; 16-week determination.",
    });

    const riskId = await promoteFindingToRisk(session, ddId);
    const risks = await listRisks(session, opp);
    expect(risks).toHaveLength(1);
    expect(risks[0].riskId).toBe(riskId);
    expect(risks[0].sourceDdItemId).toBe(ddId);
    expect(risks[0].severity).toBe("high");
    expect(risks[0].description).toContain("16-week");

    // The finding is not moved or copied away — the workstream still holds it.
    const items = await listDdItems(session, opp);
    expect(items.find((i) => i.ddItemId === ddId)!.finding).toContain("16-week");
  });

  it("refuses to promote the same finding twice", async () => {
    const opp = await newOpportunity("Risk Once");
    const ddId = await addDdItem(session, opp, { section: "ESG and Compliance", item: "EPC" });
    await promoteFindingToRisk(session, ddId);
    await expect(promoteFindingToRisk(session, ddId)).rejects.toThrow(/already been promoted/i);
    expect(await listRisks(session, opp)).toHaveLength(1);
  });

  it("carries forward only unresolved, unmigrated risks", async () => {
    const opp = await newOpportunity("Risk Carry");
    const open = await createRisk(session, opp, { title: "Roof condition", severity: "high" });
    const accepted = await createRisk(session, opp, { title: "Minor arrears" });
    const closed = await createRisk(session, opp, { title: "Title defect" });
    await updateRisk(session, accepted, { status: "accepted" });
    await updateRisk(session, closed, { status: "closed" });

    const carry = await carryForwardRisks(session, opp);
    expect(carry.map((r) => r.riskId).sort()).toEqual([open, accepted].sort());
  });

  it("cannot be migrated to the same asset risk twice", async () => {
    const opp = await newOpportunity("Risk Migrate");
    const r1 = await createRisk(session, opp, { title: "A" });
    const r2 = await createRisk(session, opp, { title: "B" });
    const assetRisk = (await adminQuery<{ risk_id: string }>(
      "select risk_id from asset_risks limit 1"))[0];
    if (!assetRisk) return; // seeded demo assets always provide one

    await adminQuery(
      "update opportunity_risks set migrated_to_asset_risk_id = $1 where risk_id = $2",
      [assetRisk.risk_id, r1]);
    await expect(adminQuery(
      "update opportunity_risks set migrated_to_asset_risk_id = $1 where risk_id = $2",
      [assetRisk.risk_id, r2],
    )).rejects.toThrow(/opportunity_risks_single_migration/);
  });
});

// ---------------------------------------------------------------------------
describe("Documents", () => {
  it("attaches an internal document to the opportunity and defaults to internal", async () => {
    const opp = await newOpportunity("Doc Attach");
    const docId = await recordDocument(session, opp, {
      title: "Structural survey", storagePath: `opportunities/${opp}/survey.pdf`,
      category: "Technical DD", mimeType: "application/pdf", sizeBytes: 1024,
    });
    const docs = await listDocuments(session, opp);
    expect(docs).toHaveLength(1);
    expect(docs[0].documentId).toBe(docId);
    expect(docs[0].accessLevel).toBe("internal");
  });

  it("links a diligence finding to the document it came from", async () => {
    const opp = await newOpportunity("Doc Link");
    const docId = await recordDocument(session, opp, {
      title: "Rent roll", storagePath: `opportunities/${opp}/rent-roll.xlsx`, category: "Rent Roll",
    });
    const ddId = await addDdItem(session, opp, {
      section: "Income Profile and Tenancy", item: "Tenancy schedule",
    });
    await updateDdItem(session, ddId, {
      status: "received", sourceDocumentId: docId, finding: "Five tenancies; one in arrears.",
    });
    const item = (await listDdItems(session, opp)).find((i) => i.ddItemId === ddId)!;
    expect(item.sourceDocumentId).toBe(docId);
  });
});

// ---------------------------------------------------------------------------
describe("Publication source relationship", () => {
  it("records the underwriting and decision a draft was taken from, without live-linking it", async () => {
    const opp = await newOpportunity("Pub Source");
    const caseId = await createVersion(session, opp, {
      acquisitionPrice: 25_000_000, targetIrr: 12.5,
    });
    const decisionId = await recordDecision(session, opp, {
      investmentCaseId: caseId, outcome: "approved", rationale: "Approved for release.",
    });

    // Drafting a publication is an admin action; exercise the same path the
    // admin screen uses rather than writing the provenance row by hand.
    const { createPublicationFromOpportunity } = await import("@/lib/data/investor-portal");
    const admin: Session = { ...session, role: "reiwa_admin", orgIds: [] };
    const adminUserId = await profileIdByEmail("admin@reiwa.com");
    const { publicationId } = await createPublicationFromOpportunity(admin, opp, adminUserId);

    const [prov] = await adminQuery<{
      source_investment_case_id: string | null;
      source_ic_decision_id: string | null;
      source_fingerprint: string;
    }>(`select vs.* from publication_version_sources vs
          join publication_versions v on v.version_id = vs.version_id
         where v.publication_id = $1`, [publicationId]);

    expect(prov.source_investment_case_id).toBe(caseId);
    expect(prov.source_ic_decision_id).toBe(decisionId);

    // The version is a SNAPSHOT: moving the opportunity on does not reach it.
    const before = await adminQuery<{ headline_price: string | null }>(
      `select headline_price from publication_versions where publication_id = $1`, [publicationId]);
    await adminQuery(
      "update opportunities set target_price = 99000000 where opportunity_id = $1", [opp]);
    const after = await adminQuery<{ headline_price: string | null }>(
      `select headline_price from publication_versions where publication_id = $1`, [publicationId]);
    expect(after[0].headline_price).toBe(before[0].headline_price);
  });
});

// ---------------------------------------------------------------------------
describe("Tenant isolation", () => {
  it("hides every new table from another organisation", async () => {
    const opp = await newOpportunity("Isolation");
    await createVersion(session, opp, { acquisitionPrice: 1_000_000 });
    await addDdItem(session, opp, { section: "SWOT", item: "Threats" });
    await createRisk(session, opp, { title: "Isolation risk" });
    await recordDocument(session, opp, { title: "Doc", storagePath: "x/y.pdf" });

    const other = orgUserSession([aoyama], aoyamaUserId);
    expect(await listVersions(other, opp)).toHaveLength(0);
    expect(await listDdItems(other, opp)).toHaveLength(0);
    expect(await listRisks(other, opp)).toHaveLength(0);
    expect(await listDocuments(other, opp)).toHaveLength(0);
    expect(await listDecisions(other, opp)).toHaveLength(0);
  });

  it("lets a viewer read but not write", async () => {
    const opp = await newOpportunity("Viewer");
    await createVersion(session, opp, { acquisitionPrice: 2_000_000 });

    const viewer = viewerSession([meiji], viewerId);
    expect(await listVersions(viewer, opp)).toHaveLength(1);
    await expect(createVersion(viewer, opp, { acquisitionPrice: 3_000_000 }))
      .rejects.toThrow();
    await expect(addDdItem(viewer, opp, { section: "SWOT", item: "No" }))
      .rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("Conversion readiness", () => {
  it("assembles everything Phase 2 needs from ids alone", async () => {
    const opp = await newOpportunity("Convert Ready");
    const caseId = await createVersion(session, opp, {
      acquisitionPrice: 40_000_000, acquisitionCosts: 2_000_000, capex: 5_000_000,
      noi: 1_800_000, debt: 24_000_000, ltvPct: 60, targetIrr: 14,
      targetEquityMultiple: 1.7, occupancyPct: 92, valuation: 40_000_000,
    });
    await applyDdTemplate(session, opp);
    const items = await listDdItems(session, opp);
    const critical = items.filter((i) => i.priority === "critical" || i.priority === "high")[0];
    await updateDdItem(session, critical.ddItemId, {
      status: "issue_identified", finding: "Unresolved at approval.",
    });
    await promoteFindingToRisk(session, critical.ddItemId);
    const decisionId = await recordDecision(session, opp, {
      investmentCaseId: caseId, outcome: "approved_with_conditions",
      conditions: "Retention against the outstanding item.",
    });

    // Everything the asset record needs, reachable by id — no re-entry.
    const approved = await approvedVersion(session, opp);
    expect(approved!.caseId).toBe(caseId);
    expect(approved!.totalCost).toBe(47_000_000);

    const decision = await approvingDecision(session, opp);
    expect(decision!.decisionId).toBe(decisionId);
    expect(decision!.conditions).toContain("Retention");

    const carry = await carryForwardRisks(session, opp);
    expect(carry).toHaveLength(1);
    expect(carry[0].migratedToAssetRiskId).toBeNull();

    const open = criticalOpenItems(items.map((i) =>
      i.ddItemId === critical.ddItemId ? { ...i, status: "issue_identified" as const } : i));
    expect(open.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Review items (Phase 1A, second pass)
// ---------------------------------------------------------------------------
describe("One source of financial truth", () => {
  it("projects the authoritative case onto the opportunity's headline columns", async () => {
    const opp = await createOpportunity(session, {
      orgId: meiji, name: "Truth Projection", market: "London",
      assetType: "office", currency: "GBP", targetPrice: 42_500_000, targetIrr: 14.5,
    });
    // Origination economics opened version 1 rather than a second writable copy.
    const v1 = await currentVersion(session, opp);
    expect(v1!.version).toBe(1);
    expect(v1!.acquisitionPrice).toBe(42_500_000);

    const projected = await getOpportunity(session, opp);
    expect(projected!.targetPrice).toBe(42_500_000);
    expect(projected!.targetIrr).toBe(14.5);

    // Re-underwriting moves the projection with it.
    await createVersion(session, opp, {
      acquisitionPrice: 38_000_000, targetIrr: 16, changeRationale: "Repriced.",
    });
    const after = await getOpportunity(session, opp);
    expect(after!.targetPrice).toBe(38_000_000);
    expect(after!.targetIrr).toBe(16);
  });

  it("refuses to write a financial field onto the opportunity", async () => {
    const opp = await newOpportunity("Truth Refuse");
    await expect(updateOpportunity(session, opp, { targetPrice: 1 }))
      .rejects.toThrow(/belong to the investment case/i);
    await expect(updateOpportunity(session, opp, { niy: 9, targetIrr: 9 }))
      .rejects.toThrow(/belong to the investment case/i);
    // Non-financial edits still work.
    await updateOpportunity(session, opp, { priority: "high", nextMilestone: "IC papers" });
    expect((await getOpportunity(session, opp))!.priority).toBe("high");
  });
});

describe("Material-update semantics", () => {
  it("moves for material events and stays put for ordinary edits", async () => {
    const opp = await newOpportunity("Material");
    const stamp = async () => (await getOpportunity(session, opp))!.lastMaterialUpdateAt;

    await updateOpportunity(session, opp, { summary: "typo fix" });
    expect(await stamp()).toBeNull();

    const caseId = await createVersion(session, opp, { acquisitionPrice: 1_000_000 });
    const afterCase = await stamp();
    expect(afterCase).not.toBeNull();

    await adminQuery("update opportunities set last_material_update_at = null where opportunity_id = $1", [opp]);
    const ddId = await addDdItem(session, opp, { section: "SWOT", item: "Threats" });
    await updateDdItem(session, ddId, { status: "in_progress" });
    expect(await stamp()).toBeNull(); // progress is not news

    await updateDdItem(session, ddId, { status: "issue_identified", finding: "Material." });
    expect(await stamp()).not.toBeNull(); // an issue is

    await adminQuery("update opportunities set last_material_update_at = null where opportunity_id = $1", [opp]);
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "deferred" });
    expect(await stamp()).not.toBeNull();
  });
});

describe("Supplemental due diligence frameworks", () => {
  it("refuses the same framework twice but accepts a supplemental one", async () => {
    const opp = await newOpportunity("DD Supplemental");
    const first = await applyDdTemplate(session, opp, "london");
    expect(first).toBeGreaterThan(20);

    await expect(applyDdTemplate(session, opp, "london"))
      .rejects.toThrow(/already been applied/i);

    const second = await applyDdTemplate(session, opp, "amsterdam");
    expect(second).toBeGreaterThan(0);
    expect(await appliedTemplates(session, opp)).toEqual(["amsterdam", "london"]);

    // Completion maths still reads plain rows, and every templated line is keyed.
    const items = await listDdItems(session, opp);
    expect(items).toHaveLength(first + second);
    expect(items.every((i) => i.templateItemKey !== null)).toBe(true);
    expect(computeProgress(items).total).toBe(first + second);

    // The database is the backstop, not the data layer.
    const sample = items[0];
    await expect(adminQuery(
      `insert into opportunity_dd_items(org_id, opportunity_id, section, item, template_item_key)
       values ($1,$2,$3,$4,$5)`,
      [meiji, opp, sample.section, sample.item, sample.templateItemKey],
    )).rejects.toThrow(/opportunity_dd_items_template_item/);
  });
});

describe("IC decision amendments", () => {
  it("keeps the original readable and attributes every correction", async () => {
    const opp = await newOpportunity("IC Amend");
    const caseId = await createVersion(session, opp, { acquisitionPrice: 6_000_000 });
    const decisionId = await recordDecision(session, opp, {
      investmentCaseId: caseId, outcome: "approved_with_conditions",
      conditions: "Subject to the rent deposit being assigned.",
      rationale: "Basis supports the plan.",
    });

    // In-place rewriting is refused outright, at the database.
    await expect(adminQuery(
      "update ic_decisions set rationale = 'rewritten' where decision_id = $1", [decisionId],
    )).rejects.toThrow(/cannot be altered/i);

    const amendmentId = await amendDecision(session, decisionId, {
      reason: "Condition mis-transcribed from the minutes.",
      conditions: "Subject to the rent deposit AND the roof warranty being assigned.",
    });

    const eff = await effectiveDecision(session, decisionId);
    // What the committee originally approved is still there...
    expect(eff!.original.conditions).toBe("Subject to the rent deposit being assigned.");
    expect(eff!.original.rationale).toBe("Basis supports the plan.");
    // ...alongside what now stands, and who changed it and why.
    expect(eff!.effectiveConditions).toContain("roof warranty");
    expect(eff!.amendments).toHaveLength(1);
    expect(eff!.amendments[0].amendmentId).toBe(amendmentId);
    expect(eff!.amendments[0].reason).toContain("mis-transcribed");
    expect(eff!.amendments[0].amendedBy).toBe(analyst);
    expect(eff!.amendments[0].createdAt).toBeTruthy();
    // An amendment that did not mention the rationale must not blank it.
    expect(eff!.effectiveRationale).toBe("Basis supports the plan.");
  });

  it("requires a reason, requires a change, and is itself permanent", async () => {
    const opp = await newOpportunity("IC Amend Guard");
    const caseId = await createVersion(session, opp, {});
    const decisionId = await recordDecision(session, opp, {
      investmentCaseId: caseId, outcome: "rejected", rationale: "Price.",
    });

    await expect(amendDecision(session, decisionId, { reason: "   ", rationale: "x" }))
      .rejects.toThrow(/why the decision record is being amended/i);
    await expect(amendDecision(session, decisionId, { reason: "No fields given" }))
      .rejects.toThrow(/must change something/i);

    const id = await amendDecision(session, decisionId, { reason: "Clarify.", rationale: "Price too high." });
    await expect(adminQuery(
      "update ic_decision_amendments set reason = 'x' where amendment_id = $1", [id],
    )).rejects.toThrow(/permanent record/i);
    await expect(adminQuery(
      "delete from ic_decision_amendments where amendment_id = $1", [id],
    )).rejects.toThrow(/permanent record/i);

    expect(await listAmendments(session, decisionId)).toHaveLength(1);
  });
});

describe("Publication provenance is durable", () => {
  it("refuses to destroy an underwriting version cited by a publication", async () => {
    const opp = await newOpportunity("Prov Durable");
    const caseId = await createVersion(session, opp, { acquisitionPrice: 12_000_000 });

    const { createPublicationFromOpportunity } = await import("@/lib/data/investor-portal");
    const admin: Session = { ...session, role: "reiwa_admin", orgIds: [] };
    const adminUserId = await profileIdByEmail("admin@reiwa.com");
    await createPublicationFromOpportunity(admin, opp, adminUserId);

    // The draft cited this version; the audit link cannot now be erased.
    await expect(adminQuery(
      "delete from investment_cases where case_id = $1", [caseId],
    )).rejects.toThrow(/publication_version_sources_source_investment_case_id_fkey|violates foreign key/i);

    // And the opportunity cannot be deleted out from under it either.
    await expect(adminQuery(
      "delete from opportunities where opportunity_id = $1", [opp],
    )).rejects.toThrow(/violates foreign key|permanent|immutable/i);
  });
});
