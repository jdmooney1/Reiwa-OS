// ============================================================================
// The Assessment tab renders a stored run, engine-only or with the written
// assessment, and shows every figure from the stored report. No database.
// ============================================================================
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

vi.mock("@/app/actions/deal-assessment", () => ({ runDealAssessmentAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, refresh: () => {} }) }));

import { AssessmentView } from "@/components/assessment/assessment-view";
import { buildReport, fromStorable, toStorable, withTerms } from "@/lib/underwrite/report";
import { resolveInputs } from "@/lib/underwrite/inputs";
import type { StoredAssessment } from "@/lib/data/deal-assessments";
import type { Assessment } from "@/lib/underwrite/assessment";
import { MH_LEASES, MH_PARAMS } from "./deal-engine.fixture";

const lines = (() => {
  const r = resolveInputs({
    name: "X", market: "London", assetType: "retail", currency: "GBP", sizeSqft: 26854,
    opportunity: { targetPrice: 62675000, niy: 6.25, passingRent: null, erv: null, capexBudget: null },
    property: { tenure: "long_leasehold", unexpiredTermYears: 90.5, groundRentPa: 340000, groundRentNote: "12.5% of rents", waultToExpiryYears: 4.75, waultToBreaksYears: null, rentReviewMechanism: null, epcRating: null },
    case: null, fx: { yenPerUnit: 209.5, asOf: "2026-10-09", source: "ECB" },
  }, "2026-10-10");
  if (!r.ok) throw new Error("expected inputs");
  return r.lines;
})();

const ASSESSMENT: Assessment = {
  verdict: "proceed_at_price",
  headline: "A scarce building priced for an outcome the buyer has not yet secured.",
  rationale: "The hedged yen return at the asking price is thin for the risks carried.",
  strengths: ["Prada-guaranteed income to 2034"],
  concerns: [{ severity: "high", text: "Three office floors expire within a year." }],
  mostExposedTo: "exit_yield", exposureReason: "Each quarter point moves the yen IRR by about a point.",
  evidence: [{ key: "exit_yield", confidence: "medium", evidence: "Two Regent Street leasehold sales.", howToConfirm: "RICS valuation." }],
  proposedTerms: {
    priceFactor: 0.917, deferredShare: 0.032, extraGuaranteeMonths: 12, topUpMonths: 12, acqFeePct: 0.005,
    rationale: [{ term: "deferred", why: "Pay for the Hackett uplift only if it happens." }, { term: "price", why: "Calibrated to a 7% hedged yen return." }],
    otherTerms: ["W&I insurance on the SPV."],
  },
  icQuestions: ["What happens if Hackett leaves in 2031?"],
  dataGaps: ["EPC ratings by unit."],
};

function stored(withAssessment: boolean): StoredAssessment {
  let report = buildReport("GBP", "lease", MH_LEASES, MH_PARAMS, lines, ["A gap worth knowing."]);
  if (withAssessment) report = withTerms(report, MH_LEASES, MH_PARAMS, { priceFactor: 0.917, deferredShare: 0.032, extraGuaranteeMonths: 12, topUpMonths: 12, acqFeePct: 0.005 });
  return {
    assessmentId: "a1", opportunityId: "o1", caseId: "c1", caseVersion: 4, tier: "lease", engineVersion: 1,
    inputs: lines, report: fromStorable(toStorable(report)),
    assessment: withAssessment ? ASSESSMENT : null, model: withAssessment ? "claude-opus-5" : null,
    verdict: withAssessment ? "proceed_at_price" : null, createdByName: "JD", createdAt: "2026-10-10T09:00:00.000Z",
  };
}

const render = (run: StoredAssessment | null) => renderToStaticMarkup(React.createElement(AssessmentView, {
  opportunityId: "o1", run, canRun: true, modelConfigured: true,
  history: run ? [{ assessmentId: run.assessmentId, createdAt: run.createdAt, createdByName: "JD", tier: run.tier, verdict: run.verdict, caseVersion: 4, hasAssessment: !!run.assessment }] : [],
}));

describe("the Assessment tab", () => {
  it("explains what is needed when there is no run", () => {
    expect(render(null)).toMatch(/has not been assessed/);
  });

  it("renders an engine-only run with no written parts", () => {
    const html = render(stored(false));
    expect(html).toMatch(/Engine only/);
    expect(html).toMatch(/Scenarios and stress/);
    expect(html).toMatch(/Cash flow/);
    expect(html).not.toMatch(/Proposed terms/);
    expect(html).not.toMatch(/Confidence/);
    expect(html).toMatch(/A gap worth knowing/);
  });

  it("renders the verdict, the priced terms and the evidence register", () => {
    const html = render(stored(true));
    expect(html).toMatch(/Proceed only on amended terms/);
    expect(html).toMatch(/Proposed terms/);
    expect(html).toMatch(/Pay for the Hackett uplift/);
    expect(html).toMatch(/RICS valuation/);
    expect(html).toMatch(/every number on this page is the engine/);
  });
});
