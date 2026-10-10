"use server";

// ============================================================================
// Run the deal assessment for one opportunity.
// ----------------------------------------------------------------------------
// STAFF ONLY, ON DEMAND ONLY. Never on save, never on a timer: a run reads the
// current underwriting version as it stands and records what it found.
//
// Read the imports as the specification. This module can: resolve a staff
// session, READ the deal, run the pure engine, optionally call the assessment
// model, and insert one row in deal_assessments. It imports nothing that writes
// to investment_cases, opportunities or properties, so no result and no model
// response can change the underwriting it assessed.
//
// The engine runs whether or not the model does. "Engine only" is a complete,
// useful run (every figure is the engine's); the model adds judgement on top.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireStaffSession } from "@/lib/auth/admin";
import { AppError } from "@/lib/errors";
import { runAction } from "@/lib/actions/run-action";
import type { ActionResult } from "@/lib/actions/result";
import { isUuid } from "@/lib/data/portal-feed";
import { todayUtc } from "@/lib/data/fx-rates";
import { loadDealContext, recordAssessment } from "@/lib/data/deal-assessments";
import { resolveInputs } from "@/lib/underwrite/inputs";
import { buildReport, toStorable, withTerms, ENGINE_VERSION } from "@/lib/underwrite/report";
import { ASSESSMENT_SYSTEM_PROMPT, buildAssessmentPrompt } from "@/lib/underwrite/prompt";
import { runAssessment } from "@/lib/underwrite/assess";
import { boundTerms } from "@/lib/underwrite/assessment";
import { unsourcedFigures } from "@/lib/underwrite/figures";

export async function runDealAssessmentAction(
  opportunityId: string, withModel: boolean,
): Promise<ActionResult> {
  const { db } = await requireStaffSession();
  return runAction("workspace.assessment.run", { opportunityId, withModel }, async () => {
    if (!isUuid(opportunityId)) throw new AppError("That opportunity could not be found.");
    const ctx = await loadDealContext(db, opportunityId);
    if (!ctx) throw new AppError("That opportunity could not be found.");

    const resolved = resolveInputs(ctx.facts, todayUtc());
    if (!resolved.ok) {
      throw new AppError(`The engine cannot run yet. It needs ${resolved.missing.join(" and ")}.`);
    }

    let report = buildReport(ctx.facts.currency, resolved.tier, resolved.leases, resolved.params, resolved.lines, resolved.gaps);
    let assessment = null;
    let model: string | null = null;
    if (withModel) {
      const text = buildAssessmentPrompt({
        facts: ctx.facts, sourceFacts: ctx.sourceFacts, dataCompleteness: ctx.dataCompleteness,
        thesis: ctx.thesis, businessPlan: ctx.businessPlan,
      }, report);
      const out = await runAssessment(ASSESSMENT_SYSTEM_PROMPT, text);
      assessment = out.assessment;
      model = out.model;
      // The proposed levers are inputs; the engine prices them before anything is stored.
      report = withTerms(report, resolved.leases, resolved.params, boundTerms(out.assessment.proposedTerms));
      // Prose can still carry a figure the schema cannot; any that match nothing it was shown are flagged.
      report = { ...report, unsourcedFigures: unsourcedFigures(out.assessment, text) };
    }

    await recordAssessment(db, {
      orgId: ctx.orgId, opportunityId, caseId: ctx.facts.case?.caseId ?? null,
      tier: resolved.tier, engineVersion: ENGINE_VERSION, inputs: resolved.lines,
      results: toStorable(report), assessment, model,
    });
    revalidatePath(`/opportunities/${opportunityId}/assessment`);
  }, { ruleMessage: "This assessment could not be recorded." });
}
