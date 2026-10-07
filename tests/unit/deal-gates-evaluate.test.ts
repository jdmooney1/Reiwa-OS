import { describe, it, expect } from "vitest";
import { evaluateStageExit, evaluateActionGate } from "@/lib/deal-gates/evaluate";
import { conditionHolds, investorStatusAtLeast, isClearedStatus, type DocTypeRow } from "@/lib/deal-gates/types";

function dt(partial: Partial<DocTypeRow> & { key: string }): DocTypeRow {
  return {
    stage: 1, scope: "deal", gateKind: "transition", gateAction: null, gateCondition: null, isActive: true,
    ...partial,
  };
}

describe("conditionHolds", () => {
  it("is true for no condition", () => expect(conditionHolds(null, {}, null)).toBe(true));
  it("checks geared", () => {
    expect(conditionHolds("geared", { geared: true }, null)).toBe(true);
    expect(conditionHolds("geared", { geared: false }, null)).toBe(false);
    expect(conditionHolds("geared", {}, null)).toBe(false);
  });
  it("checks hedged", () => {
    expect(conditionHolds("hedged", { hedged: true }, null)).toBe(true);
    expect(conditionHolds("hedged", {}, null)).toBe(false);
  });
  it("checks jurisdiction", () => {
    expect(conditionHolds("jurisdiction:UK", { jurisdiction: "UK" }, null)).toBe(true);
    expect(conditionHolds("jurisdiction:UK", { jurisdiction: "NL" }, null)).toBe(false);
  });
  it("checks investor_type", () => {
    expect(conditionHolds("investor_type:corporate", {}, "corporate")).toBe(true);
    expect(conditionHolds("investor_type:corporate", {}, "individual")).toBe(false);
    expect(conditionHolds("investor_type:corporate", {}, null)).toBe(false);
  });
  it("defaults regulated_disclosure to applicable (no platform setting exists yet)", () => {
    expect(conditionHolds("regulated_disclosure", {}, null)).toBe(true);
  });
});

describe("investorStatusAtLeast", () => {
  it("orders the funnel", () => {
    expect(investorStatusAtLeast("soft_circled", "soft_circled")).toBe(true);
    expect(investorStatusAtLeast("committed", "soft_circled")).toBe(true);
    expect(investorStatusAtLeast("ioi_received", "soft_circled")).toBe(false);
  });
  it("declined is never at or later than anything", () => {
    expect(investorStatusAtLeast("declined", "matched")).toBe(false);
  });
});

describe("isClearedStatus", () => {
  it("only final and signed count", () => {
    expect(isClearedStatus("final")).toBe(true);
    expect(isClearedStatus("signed")).toBe(true);
    expect(isClearedStatus("in_review")).toBe(false);
    expect(isClearedStatus(null)).toBe(false);
  });
});

describe("evaluateStageExit", () => {
  it("is satisfied when there are no gate doc types for the stage", () => {
    const r = evaluateStageExit(0, [], [], [], {});
    expect(r.satisfied).toBe(true);
  });

  it("blocks on an uncleared deal-scoped transition gate", () => {
    const docTypes = [dt({ key: "screening_memo", stage: 0 })];
    const r = evaluateStageExit(0, docTypes, [], [], {});
    expect(r.satisfied).toBe(false);
    expect(r.blockingDealDocs).toEqual(["screening_memo"]);
  });

  it("clears once the document is final", () => {
    const docTypes = [dt({ key: "screening_memo", stage: 0 })];
    const docs = [{ docTypeKey: "screening_memo", dealInvestorId: null, status: "final" as const }];
    const r = evaluateStageExit(0, docTypes, docs, [], {});
    expect(r.satisfied).toBe(true);
    expect(r.blockingDealDocs).toEqual([]);
  });

  it("signed also counts as cleared", () => {
    const docTypes = [dt({ key: "investor_nda", stage: 1 })];
    const docs = [{ docTypeKey: "investor_nda", dealInvestorId: null, status: "signed" as const }];
    expect(evaluateStageExit(1, docTypes, docs, [], {}).satisfied).toBe(true);
  });

  it("a conditional gate not applicable to this deal is not blocking", () => {
    const docTypes = [dt({ key: "financing_docs", stage: 3, gateCondition: "geared" })];
    const r = evaluateStageExit(3, docTypes, [], [], { geared: false });
    expect(r.satisfied).toBe(true); // not geared -> financing_docs doesn't apply -> not a gate at all
  });

  it("a conditional gate applicable to this deal IS blocking until cleared", () => {
    const docTypes = [dt({ key: "financing_docs", stage: 3, gateCondition: "geared" })];
    const r = evaluateStageExit(3, docTypes, [], [], { geared: true });
    expect(r.satisfied).toBe(false);
    expect(r.blockingDealDocs).toEqual(["financing_docs"]);
  });

  it("an inactive doc_type is never a gate", () => {
    const docTypes = [dt({ key: "retired_doc", stage: 0, isActive: false })];
    expect(evaluateStageExit(0, docTypes, [], [], {}).satisfied).toBe(true);
  });

  it("a non-transition gate_kind is not a transition gate", () => {
    const docTypes = [dt({ key: "abort_cost_agreement", stage: 2, gateKind: "action", gateAction: "x" })];
    expect(evaluateStageExit(2, docTypes, [], [], {}).satisfied).toBe(true);
  });

  // ---- Stage 2 investor-scoped exit rule ---------------------------------
  it("Stage 2: blocked when no investor at soft_circled+ has every investor-scoped doc cleared", () => {
    const docTypes = [dt({ key: "investor_kyc", stage: 2, scope: "investor" })];
    const investors = [{ dealInvestorId: "a", status: "ioi_received" as const, investorType: null }];
    const r = evaluateStageExit(2, docTypes, [], investors, {});
    expect(r.satisfied).toBe(false);
    expect(r.investorRequirement.applicable).toBe(true);
  });

  it("Stage 2: satisfied once at least one soft_circled+ investor clears every investor-scoped doc", () => {
    const docTypes = [dt({ key: "investor_kyc", stage: 2, scope: "investor" }), dt({ key: "investor_ioi", stage: 2, scope: "investor" })];
    const investors = [
      { dealInvestorId: "a", status: "soft_circled" as const, investorType: null },
      { dealInvestorId: "b", status: "matched" as const, investorType: null },
    ];
    const docs = [
      { docTypeKey: "investor_kyc", dealInvestorId: "a", status: "final" as const },
      { docTypeKey: "investor_ioi", dealInvestorId: "a", status: "final" as const },
    ];
    const r = evaluateStageExit(2, docTypes, docs, investors, {});
    expect(r.satisfied).toBe(true);
  });

  it("Stage 2: a declined investor never counts toward the qualifying set", () => {
    const docTypes = [dt({ key: "investor_kyc", stage: 2, scope: "investor" })];
    const investors = [{ dealInvestorId: "a", status: "declined" as const, investorType: null }];
    const docs = [{ docTypeKey: "investor_kyc", dealInvestorId: "a", status: "final" as const }];
    expect(evaluateStageExit(2, docTypes, docs, investors, {}).satisfied).toBe(false);
  });

  // ---- Stage 3 investor-scoped exit rule ---------------------------------
  it("Stage 3: satisfied when there are no committed investors at all (nothing to check)", () => {
    const docTypes = [dt({ key: "investor_kyc", stage: 3, scope: "investor" })];
    const investors = [{ dealInvestorId: "a", status: "soft_circled" as const, investorType: null }];
    expect(evaluateStageExit(3, docTypes, [], investors, {}).satisfied).toBe(true);
  });

  it("Stage 3: blocked when a committed investor is missing an investor-scoped document", () => {
    const docTypes = [dt({ key: "investor_kyc", stage: 3, scope: "investor" })];
    const investors = [{ dealInvestorId: "a", status: "committed" as const, investorType: null }];
    const r = evaluateStageExit(3, docTypes, [], investors, {});
    expect(r.satisfied).toBe(false);
    expect(r.investorRequirement.satisfied).toBe(false);
  });

  it("Stage 3: satisfied when every committed investor clears every investor-scoped document", () => {
    const docTypes = [dt({ key: "investor_kyc", stage: 3, scope: "investor" })];
    const investors = [
      { dealInvestorId: "a", status: "committed" as const, investorType: null },
      { dealInvestorId: "b", status: "committed" as const, investorType: null },
    ];
    const docs = [
      { docTypeKey: "investor_kyc", dealInvestorId: "a", status: "final" as const },
      { docTypeKey: "investor_kyc", dealInvestorId: "b", status: "signed" as const },
    ];
    expect(evaluateStageExit(3, docTypes, docs, investors, {}).satisfied).toBe(true);
  });

  it("Stage 3: a conditional investor-scoped gate only applies to the matching investor", () => {
    const docTypes = [dt({ key: "ringi_pack", stage: 3, scope: "investor", gateCondition: "investor_type:corporate" })];
    const investors = [
      { dealInvestorId: "a", status: "committed" as const, investorType: "corporate" },
      { dealInvestorId: "b", status: "committed" as const, investorType: "individual" },
    ];
    // "a" (corporate) must clear it; "b" (individual) is exempt by condition.
    const docsMissing = [] as { docTypeKey: string; dealInvestorId: string | null; status: "final" }[];
    expect(evaluateStageExit(3, docTypes, docsMissing, investors, {}).satisfied).toBe(false);

    const docsCleared = [{ docTypeKey: "ringi_pack", dealInvestorId: "a", status: "final" as const }];
    expect(evaluateStageExit(3, docTypes, docsCleared, investors, {}).satisfied).toBe(true);
  });
});

describe("evaluateActionGate", () => {
  const releaseGate = dt({ key: "investor_nda", stage: 1, scope: "investor", gateKind: "action", gateAction: "release_pitch_pack_and_portal_access" });
  const commissionGate = dt({ key: "abort_cost_agreement", stage: 2, scope: "investor", gateKind: "action", gateAction: "instruct_stage3_commission" });

  it("per-investor action: blocked until THAT investor's document clears", () => {
    const r1 = evaluateActionGate("release_pitch_pack_and_portal_access", [releaseGate], [], [], "inv-a");
    expect(r1.satisfied).toBe(false);

    const docs = [{ docTypeKey: "investor_nda", dealInvestorId: "inv-a", status: "signed" as const }];
    const r2 = evaluateActionGate("release_pitch_pack_and_portal_access", [releaseGate], docs, [], "inv-a");
    expect(r2.satisfied).toBe(true);
  });

  it("per-investor action: another investor's cleared document does not unblock THIS investor", () => {
    const docs = [{ docTypeKey: "investor_nda", dealInvestorId: "inv-b", status: "signed" as const }];
    const r = evaluateActionGate("release_pitch_pack_and_portal_access", [releaseGate], docs, [], "inv-a");
    expect(r.satisfied).toBe(false);
  });

  it("deal-wide action: unblocked once ANY investor clears the document", () => {
    const investors = [
      { dealInvestorId: "inv-a", status: "soft_circled" as const, investorType: null },
      { dealInvestorId: "inv-b", status: "matched" as const, investorType: null },
    ];
    const r1 = evaluateActionGate("instruct_stage3_commission", [commissionGate], [], investors, null);
    expect(r1.satisfied).toBe(false);

    const docs = [{ docTypeKey: "abort_cost_agreement", dealInvestorId: "inv-b", status: "final" as const }];
    const r2 = evaluateActionGate("instruct_stage3_commission", [commissionGate], docs, investors, null);
    expect(r2.satisfied).toBe(true);
  });

  it("a deal-scoped action gate checks the single deal-level document", () => {
    const gate = dt({ key: "vendor_nda", stage: 0, scope: "deal", gateKind: "action", gateAction: "share_data_room" });
    expect(evaluateActionGate("share_data_room", [gate], [], [], null).satisfied).toBe(false);
    const docs = [{ docTypeKey: "vendor_nda", dealInvestorId: null, status: "final" as const }];
    expect(evaluateActionGate("share_data_room", [gate], docs, [], null).satisfied).toBe(true);
  });

  it("no matching doc_type for the action means nothing blocks it", () => {
    expect(evaluateActionGate("some_unrelated_action", [releaseGate], [], [], null).satisfied).toBe(true);
  });
});
