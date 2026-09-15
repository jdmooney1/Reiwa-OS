// ============================================================================
// Phase 1B — the opportunity workspace.
// ----------------------------------------------------------------------------
// Tests the data the workspace renders and the rules it must not be able to
// break. The screens themselves are covered by the Playwright suite; these
// assert that what a section is handed is correct at source.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { adminQuery, type Session } from "@/lib/db/client";
import { createOpportunity, updateOpportunity } from "@/lib/data/opportunities";
import { getOpportunityFile, listPipeline } from "@/lib/data/opportunity-file";
import { createVersion, listVersions, updateVersion } from "@/lib/data/underwriting";
import { compareVersions } from "@/lib/underwriting/compare";
import { applyDdTemplate, listDdItems, updateDdItem, appliedTemplates } from "@/lib/data/due-diligence";
import { listRisks, promoteFindingToRisk } from "@/lib/data/opportunity-risks";
import {
  recordDecision, listDecisions, amendDecision, listAmendments, effectiveDecision,
} from "@/lib/data/ic-decisions";
import { recordDocument, listDocuments } from "@/lib/data/opportunity-documents";
import { createPublicationFromOpportunity, getVersionProvenance, listPublicationVersions } from "@/lib/data/investor-portal";
import { getPublicationForOpportunity } from "@/lib/data/admin-portal";
import { orgIdByName, orgUserSession, viewerSession, profileIdByEmail, adminSession } from "./helpers";

let meiji: string;
let analyst: string;
let viewerId: string;
let session: Session;

beforeAll(async () => {
  meiji = await orgIdByName("Meiji Shipping");
  analyst = await profileIdByEmail("analyst@meiji.com");
  viewerId = await profileIdByEmail("viewer@meiji.com");
  session = orgUserSession([meiji], analyst);
});

async function newOpportunity(name: string, targetPrice?: number): Promise<string> {
  return createOpportunity(session, {
    orgId: meiji, name, city: "London", country: "United Kingdom",
    market: "London", assetType: "office", strategy: "value_add",
    currency: "GBP", ...(targetPrice ? { targetPrice } : {}),
  });
}

// ---------------------------------------------------------------------------
describe("Workspace loads the canonical opportunity", () => {
  it("assembles the file with its authoritative version and section counts", async () => {
    const opp = await newOpportunity("WS Canonical");
    const file = await getOpportunityFile(session, opp);

    expect(file).not.toBeNull();
    expect(file!.opportunity.opportunityId).toBe(opp);
    expect(file!.basis).toBe("none");
    expect(file!.authoritative).toBeNull();
    expect(file!.counts).toEqual({
      ddOpen: 0, ddIssues: 0, ddTotal: 0, risksOpen: 0, decisions: 0, documents: 0,
    });
  });

  it("returns null for an opportunity in another organisation", async () => {
    const opp = await newOpportunity("WS Isolation");
    const aoyama = await orgIdByName("Aoyama Holdings");
    const other = orgUserSession([aoyama], await profileIdByEmail("user@aoyama.com"));
    expect(await getOpportunityFile(other, opp)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("Summary metrics come from the investment case", () => {
  it("reads the working version, then the approved one once IC has sat", async () => {
    const opp = await newOpportunity("WS Metrics");
    await createVersion(session, opp, {
      acquisitionPrice: 20_000_000, acquisitionCosts: 1_000_000, capex: 2_000_000,
      targetIrr: 14, entryYieldPct: 4.5,
    });

    const working = await getOpportunityFile(session, opp);
    expect(working!.basis).toBe("working");
    expect(working!.authoritative!.acquisitionPrice).toBe(20_000_000);
    expect(working!.authoritative!.totalCost).toBe(23_000_000);

    const caseId = working!.authoritative!.caseId;
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved" });

    const approved = await getOpportunityFile(session, opp);
    expect(approved!.basis).toBe("approved");
    expect(approved!.authoritative!.caseId).toBe(caseId);
  });

  it("never sources a metric the opportunity row could disagree with", async () => {
    const opp = await newOpportunity("WS Provenance", 30_000_000);
    // The projected column and the case agree, because one derives from the other.
    const file = await getOpportunityFile(session, opp);
    const [row] = await adminQuery<{ target_price: string }>(
      "select target_price from opportunities where opportunity_id = $1", [opp]);
    expect(Number(row.target_price)).toBe(file!.authoritative!.acquisitionPrice);

    // And the opportunity row refuses to be edited independently of it.
    await expect(updateOpportunity(session, opp, { targetPrice: 1 }))
      .rejects.toThrow(/belong to the investment case/i);
  });
});

// ---------------------------------------------------------------------------
describe("Underwriting", () => {
  it("creates a new working version without touching the approved one", async () => {
    const opp = await newOpportunity("WS Revise");
    const v1 = await createVersion(session, opp, { acquisitionPrice: 10_000_000 });
    await recordDecision(session, opp, { investmentCaseId: v1, outcome: "approved" });

    const v2 = await createVersion(session, opp, {
      acquisitionPrice: 9_000_000, changeRationale: "Repriced after survey.",
    });

    const versions = await listVersions(session, opp);
    expect(versions.map((v) => v.status).sort()).toEqual(["approved", "current"]);
    expect(versions.find((v) => v.caseId === v1)!.status).toBe("approved");
    expect(versions.find((v) => v.caseId === v2)!.status).toBe("current");
    expect(versions.find((v) => v.caseId === v1)!.acquisitionPrice).toBe(10_000_000);
  });

  it("refuses to edit an approved version", async () => {
    const opp = await newOpportunity("WS Immutable");
    const caseId = await createVersion(session, opp, { acquisitionPrice: 5_000_000 });
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved" });
    await expect(updateVersion(session, caseId, { acquisitionPrice: 1 }))
      .rejects.toThrow(/immutable/i);
  });

  it("carries the author's name through for display", async () => {
    const opp = await newOpportunity("WS Author");
    await createVersion(session, opp, { acquisitionPrice: 1_000_000 });
    const [v] = await listVersions(session, opp);
    expect(v.createdBy).toBe(analyst);
    expect(v.createdByName).toBeTruthy();
  });

  it("compares two versions and reports only what moved", async () => {
    const opp = await newOpportunity("WS Compare");
    const aId = await createVersion(session, opp, {
      acquisitionPrice: 20_000_000, capex: 2_000_000, targetIrr: 14,
      noi: 900_000, assumptions: { rentFreeMonths: 6 },
    });
    const bId = await createVersion(session, opp, {
      acquisitionPrice: 18_000_000, capex: 2_000_000, targetIrr: 16,
      noi: 900_000, assumptions: { rentFreeMonths: 9 },
    });
    const versions = await listVersions(session, opp);
    const a = versions.find((v) => v.caseId === aId)!;
    const b = versions.find((v) => v.caseId === bId)!;

    const diff = compareVersions(a, b);
    const moved = diff.changes.map((c) => c.field.key).sort();
    // Price, total cost (generated) and IRR moved. Capex and NOI did not.
    expect(moved).toEqual(["acquisitionPrice", "targetIrr", "totalCost"]);
    expect(moved).not.toContain("capex");

    const price = diff.changes.find((c) => c.field.key === "acquisitionPrice")!;
    expect(price.delta).toBe(-2_000_000);
    expect(price.direction).toBe("better"); // a lower price is better
    const irr = diff.changes.find((c) => c.field.key === "targetIrr")!;
    expect(irr.direction).toBe("better");

    expect(diff.assumptionChanges).toEqual([
      { key: "rentFreeMonths", from: 6, to: 9 },
    ]);
    expect(diff.unchangedCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe("Due diligence", () => {
  it("renders the framework and records an update", async () => {
    const opp = await newOpportunity("WS Diligence");
    const n = await applyDdTemplate(session, opp, "london");
    expect(n).toBeGreaterThan(20);
    expect(await appliedTemplates(session, opp)).toEqual(["london"]);

    const items = await listDdItems(session, opp);
    const target = items[0];
    await updateDdItem(session, target.ddItemId, {
      status: "issue_identified", finding: "Boundary not registered.",
    });

    const after = await listDdItems(session, opp);
    const updated = after.find((i) => i.ddItemId === target.ddItemId)!;
    expect(updated.status).toBe("issue_identified");
    expect(updated.finding).toBe("Boundary not registered.");

    const file = await getOpportunityFile(session, opp);
    expect(file!.counts.ddTotal).toBe(n);
    expect(file!.counts.ddIssues).toBe(1);
    expect(file!.counts.ddOpen).toBe(n);
  });

  it("accepts a supplemental framework", async () => {
    const opp = await newOpportunity("WS Supplemental");
    await applyDdTemplate(session, opp, "london");
    await applyDdTemplate(session, opp, "amsterdam");
    expect((await appliedTemplates(session, opp)).sort()).toEqual(["amsterdam", "london"]);
  });
});

// ---------------------------------------------------------------------------
describe("Promotion of a finding into a risk", () => {
  it("creates the risk once and keeps the link back to the finding", async () => {
    const opp = await newOpportunity("WS Promote");
    await applyDdTemplate(session, opp, "london");
    const item = (await listDdItems(session, opp))[0];
    await updateDdItem(session, item.ddItemId, {
      status: "issue_identified", finding: "Unregistered strip along the boundary.",
    });

    await promoteFindingToRisk(session, item.ddItemId);
    const risks = await listRisks(session, opp);
    expect(risks).toHaveLength(1);
    expect(risks[0].sourceDdItemId).toBe(item.ddItemId);

    // The workspace offers promotion only where it would succeed.
    await expect(promoteFindingToRisk(session, item.ddItemId)).rejects.toThrow(/already/i);
    expect(await listRisks(session, opp)).toHaveLength(1);

    const file = await getOpportunityFile(session, opp);
    expect(file!.counts.risksOpen).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("Committee record", () => {
  it("renders the original and its amendments separately", async () => {
    const opp = await newOpportunity("WS Decision");
    const caseId = await createVersion(session, opp, { acquisitionPrice: 8_000_000 });
    const decisionId = await recordDecision(session, opp, {
      investmentCaseId: caseId, outcome: "approved_with_conditions",
      conditions: "Subject to the rent deposit.", rationale: "Basis supports the plan.",
      decisionMakers: ["J Mooney", "External adviser"],
    });

    await amendDecision(session, decisionId, {
      reason: "Condition mis-transcribed.",
      conditions: "Subject to the rent deposit and the roof warranty.",
    });

    const eff = await effectiveDecision(session, decisionId);
    expect(eff!.original.conditions).toBe("Subject to the rent deposit.");
    expect(eff!.effectiveConditions).toContain("roof warranty");
    expect(eff!.effectiveRationale).toBe("Basis supports the plan.");
    expect(eff!.amendments).toHaveLength(1);
    expect(eff!.amendments[0].amendedByName).toBeTruthy();

    const [decision] = await listDecisions(session, opp);
    expect(decision.recordedByName).toBeTruthy();
    expect(decision.decisionMakers).toEqual(["J Mooney", "External adviser"]);
    expect(await listAmendments(session, decisionId)).toHaveLength(1);
  });

  it("shows no decision rather than inventing one", async () => {
    const opp = await newOpportunity("WS Undecided");
    await createVersion(session, opp, { acquisitionPrice: 3_000_000 });
    expect(await listDecisions(session, opp)).toHaveLength(0);
    expect((await getOpportunityFile(session, opp))!.counts.decisions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("Documents", () => {
  it("records an internal document as internal by default", async () => {
    const opp = await newOpportunity("WS Docs");
    await recordDocument(session, opp, {
      title: "Structural survey", storagePath: `opportunities/${opp}/survey.pdf`,
      category: "Technical DD", fileName: "survey.pdf",
    });
    const docs = await listDocuments(session, opp);
    expect(docs).toHaveLength(1);
    expect(docs[0].accessLevel).toBe("internal");
    expect(docs[0].uploadedByName).toBeTruthy();
    expect((await getOpportunityFile(session, opp))!.counts.documents).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("Publication relationship", () => {
  it("surfaces the publication with its underwriting and decision provenance", async () => {
    const opp = await newOpportunity("WS Publication");
    const caseId = await createVersion(session, opp, {
      acquisitionPrice: 25_000_000, targetIrr: 12,
    });
    const decisionId = await recordDecision(session, opp, {
      investmentCaseId: caseId, outcome: "approved", rationale: "Cleared for release.",
    });

    const adminUserId = await profileIdByEmail("admin@reiwa.com");
    const { publicationId } = await createPublicationFromOpportunity(adminSession, opp, adminUserId);

    expect(await getPublicationForOpportunity(adminSession, opp)).toBe(publicationId);

    const [version] = await listPublicationVersions(adminSession, publicationId);
    const prov = await getVersionProvenance(adminSession, version.versionId);
    expect(prov!.sourceInvestmentCaseId).toBe(caseId);
    expect(prov!.sourceCaseVersion).toBe(1);
    expect(prov!.sourceCaseStatus).toBe("approved");
    expect(prov!.sourceIcDecisionId).toBe(decisionId);
    expect(prov!.sourceDecisionOutcome).toBe("approved");
  });

  it("does not let new underwriting reach a published version", async () => {
    const opp = await newOpportunity("WS Snapshot");
    const caseId = await createVersion(session, opp, { acquisitionPrice: 40_000_000 });
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved" });

    const adminUserId = await profileIdByEmail("admin@reiwa.com");
    const { publicationId } = await createPublicationFromOpportunity(adminSession, opp, adminUserId);
    const before = (await listPublicationVersions(adminSession, publicationId))[0].headlinePrice;

    await createVersion(session, opp, {
      acquisitionPrice: 31_000_000, changeRationale: "Repriced after diligence.",
    });

    const after = (await listPublicationVersions(adminSession, publicationId))[0].headlinePrice;
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
describe("Pipeline", () => {
  it("carries each row's figures from its own investment case", async () => {
    const opp = await newOpportunity("WS Pipeline Row");
    await createVersion(session, opp, {
      acquisitionPrice: 12_000_000, acquisitionCosts: 500_000, capex: 500_000,
      entryYieldPct: 5.1, targetIrr: 11, targetEquityMultiple: 1.6,
    });

    const rows = await listPipeline(session);
    const row = rows.find((r) => r.opportunityId === opp)!;
    expect(row.caseBasis).toBe("working");
    expect(row.caseVersion).toBe(1);
    expect(row.caseAcquisitionPrice).toBe(12_000_000);
    expect(row.caseTotalCost).toBe(13_000_000);
    expect(row.caseTargetIrr).toBe(11);

    // A row with no underwriting says so rather than showing a blank figure.
    const bare = await newOpportunity("WS Pipeline Bare");
    const bareRow = (await listPipeline(session)).find((r) => r.opportunityId === bare)!;
    expect(bareRow.caseBasis).toBe("none");
    expect(bareRow.caseAcquisitionPrice).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("Read-only staff", () => {
  it("can read the file but cannot change anything in it", async () => {
    const opp = await newOpportunity("WS Viewer");
    await createVersion(session, opp, { acquisitionPrice: 2_000_000 });
    await applyDdTemplate(session, opp, "london");

    const viewer = viewerSession([meiji], viewerId);
    const file = await getOpportunityFile(viewer, opp);
    expect(file).not.toBeNull();
    expect(file!.authoritative).not.toBeNull();
    expect((await listDdItems(viewer, opp)).length).toBeGreaterThan(0);

    await expect(createVersion(viewer, opp, { acquisitionPrice: 1 })).rejects.toThrow();
    await expect(recordDocument(viewer, opp, { title: "x", storagePath: "a/b" })).rejects.toThrow();
  });
});
