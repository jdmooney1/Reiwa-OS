"use server";

// ============================================================================
// Opportunity workspace server actions.
// ----------------------------------------------------------------------------
// Thin by design. Every rule these touch — approved underwriting is immutable,
// a decision names its own opportunity's version, a finding promotes once, an
// author is required — lives in the database (migrations 0008-0010). These
// functions resolve the session, pass the form through, and let the rules
// refuse. A guard written here as well would be a second, weaker copy of one
// that already holds, and the copy is what gets forgotten.
//
// Every one of them returns an ActionResult rather than throwing, so a refusal
// the person can act on — a file too large, a framework applied twice, an
// approved version that cannot be edited — comes back to the screen they are
// on instead of replacing it with the route error boundary. Faults still throw.
// The classification is in one place: see @/lib/actions/result.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireDbSession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { runAction } from "@/lib/actions/run-action";
import type { ActionResult } from "@/lib/actions/result";
import { createVersion, makeCurrent, type UnderwritingInput } from "@/lib/data/underwriting";
import { applyDdTemplate, updateDdItem, addDdItem, type DdItemPatch } from "@/lib/data/due-diligence";
import { createRisk, promoteFindingToRisk, updateRisk, type RiskPatch } from "@/lib/data/opportunity-risks";
import { recordDecision, amendDecision, type IcOutcome } from "@/lib/data/ic-decisions";
import { recordDocument } from "@/lib/data/opportunity-documents";
import { setThreadConfirmed } from "@/lib/data/email-threads";
import {
  checkUpload, newOpportunityObjectPath, putDocumentObject, deleteDocumentObject, safeFileName,
} from "@/lib/documents/storage";
import type { DdStatus, Recommendation } from "@/types/database";
import { parseNumber, PERCENT, NON_NEGATIVE, ANY_AMOUNT, type Bounds } from "@/lib/validation/numeric";
import { resolveAllocation } from "@/lib/underwriting/allocation";

const text = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

function refresh(opportunityId: string) {
  revalidatePath(`/opportunities/${opportunityId}`, "layout");
  revalidatePath("/pipeline");
}

// ---- Underwriting ---------------------------------------------------------
// Every numeric field with what it may hold. Percentages are 0-100 as stored;
// money cannot be negative except NOI, which genuinely can be on a vacant
// building. Checked here because the form's own attributes are only a hint: a
// browser lets "12e3" through a number input and a request need not come from one.
const UNDERWRITING_NUMERIC: Partial<Record<keyof UnderwritingInput, { label: string; bounds: Bounds }>> = {
  acquisitionPrice: { label: "Acquisition price", bounds: NON_NEGATIVE },
  acquisitionCosts: { label: "Acquisition costs", bounds: NON_NEGATIVE },
  capex: { label: "Capital expenditure", bounds: NON_NEGATIVE },
  equity: { label: "Equity", bounds: NON_NEGATIVE },
  grossRentalIncome: { label: "Gross rental income", bounds: NON_NEGATIVE },
  noi: { label: "Net operating income", bounds: ANY_AMOUNT },
  erv: { label: "ERV", bounds: NON_NEGATIVE },
  occupancyPct: { label: "Occupancy", bounds: PERCENT },
  debt: { label: "Debt", bounds: NON_NEGATIVE },
  ltvPct: { label: "Leverage (LTV)", bounds: PERCENT },
  debtCostPct: { label: "Debt cost", bounds: PERCENT },
  valuation: { label: "Entry valuation", bounds: NON_NEGATIVE },
  exitValue: { label: "Exit value", bounds: NON_NEGATIVE },
  entryYieldPct: { label: "Entry yield", bounds: PERCENT },
  exitYieldPct: { label: "Exit yield", bounds: PERCENT },
  holdPeriodYears: { label: "Hold period", bounds: { min: 0, max: 100 } },
  targetIrr: { label: "Target IRR", bounds: PERCENT },
  targetEquityMultiple: { label: "Equity multiple", bounds: { min: 0, max: 100 } },
  landValue: { label: "Land value", bounds: NON_NEGATIVE },
  buildingValue: { label: "Building value", bounds: NON_NEGATIVE },
};

export async function createVersionAction(
  opportunityId: string, _prev: ActionResult, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.underwriting.create", { opportunityId }, async () => {
    const input: UnderwritingInput = {
      strategy: text(formData.get("strategy")),
      thesis: text(formData.get("thesis")),
      businessPlanAssumptions: text(formData.get("businessPlanAssumptions")),
      changeRationale: text(formData.get("changeRationale")),
    };
    for (const [key, spec] of Object.entries(UNDERWRITING_NUMERIC)) {
      (input as Record<string, unknown>)[key] = parseNumber(formData.get(key), spec.label, spec.bounds);
    }
    // Value allocation: a whole-year life (the method follows from it; there is only
    // one) and a land/building split that adds up to the price.
    const years = parseNumber(formData.get("depreciationYears"), "Depreciation life", { min: 1, max: 100 });
    const alloc = resolveAllocation(
      { price: input.acquisitionPrice ?? null, land: input.landValue ?? null, building: input.buildingValue ?? null, years },
      (n) => Math.round(n).toLocaleString("en-GB"));
    if (!alloc.ok) throw new AppError(alloc.error);
    input.depreciationYears = alloc.depreciationYears;
    input.depreciationMethod = alloc.depreciationMethod;
    await createVersion(session, opportunityId, input);
    refresh(opportunityId);
  }, {
    ruleMessage:
      "This underwriting version could not be created. An approved or superseded " +
      "version cannot be altered — revise by creating the next version.",
  });
}

export async function makeCurrentVersionAction(
  opportunityId: string, caseId: string,
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.underwriting.makeCurrent", { opportunityId, caseId }, async () => {
    await makeCurrent(session, caseId);
    refresh(opportunityId);
  }, {
    ruleMessage: "That version cannot become the working version. Approved and " +
      "superseded underwriting is immutable.",
  });
}

// ---- Due diligence --------------------------------------------------------
export async function applyDdTemplateAction(
  opportunityId: string, templateId: "london" | "amsterdam",
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.dd.applyTemplate", { opportunityId, templateId }, async () => {
    await applyDdTemplate(session, opportunityId, templateId);
    refresh(opportunityId);
  });
}

export async function updateDdItemAction(
  opportunityId: string, ddItemId: string, _prev: ActionResult, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();
  const patch: DdItemPatch = {
    status: String(formData.get("status") || "not_started") as DdStatus,
    dueDate: text(formData.get("dueDate")),
    finding: text(formData.get("finding")),
    resolution: text(formData.get("resolution")),
  };
  const owner = text(formData.get("ownerUserId"));
  if (owner !== null) patch.ownerUserId = owner;
  return runAction("workspace.dd.update", { opportunityId, ddItemId }, async () => {
    await updateDdItem(session, ddItemId, patch);
    refresh(opportunityId);
  });
}

export async function addDdItemAction(
  opportunityId: string, _prev: ActionResult, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.dd.add", { opportunityId }, async () => {
    const section = text(formData.get("section"));
    const item = text(formData.get("item"));
    if (!section || !item) throw new AppError("A workstream needs a section and a title.");
    await addDdItem(session, opportunityId, {
      section, item,
      question: text(formData.get("question")),
      priority: String(formData.get("priority") || "medium"),
    });
    refresh(opportunityId);
  });
}

// ---- Risks ----------------------------------------------------------------
export async function promoteFindingAction(
  opportunityId: string, ddItemId: string,
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.risk.promote", { opportunityId, ddItemId }, async () => {
    await promoteFindingToRisk(session, ddItemId);
    refresh(opportunityId);
  });
}

export async function createRiskAction(
  opportunityId: string, _prev: ActionResult, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.risk.create", { opportunityId }, async () => {
    const title = text(formData.get("title"));
    if (!title) throw new AppError("A risk needs a title.");
    await createRisk(session, opportunityId, {
      title,
      category: String(formData.get("category") || "other"),
      description: text(formData.get("description")),
      severity: String(formData.get("severity") || "medium") as RiskPatch["severity"],
      mitigation: text(formData.get("mitigation")),
      financialImpact: parseNumber(formData.get("financialImpact"), "Financial impact", NON_NEGATIVE),
    });
    refresh(opportunityId);
  });
}

export async function updateRiskAction(
  opportunityId: string, riskId: string, _prev: ActionResult, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.risk.update", { opportunityId, riskId }, async () => {
    await updateRisk(session, riskId, {
      status: String(formData.get("status") || "open") as RiskPatch["status"],
      severity: String(formData.get("severity") || "medium") as RiskPatch["severity"],
      mitigation: text(formData.get("mitigation")),
    });
    refresh(opportunityId);
  });
}

// ---- Investment committee -------------------------------------------------
export async function recordDecisionAction(
  opportunityId: string, _prev: ActionResult, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.decision.record", { opportunityId }, async () => {
    const investmentCaseId = String(formData.get("investmentCaseId") || "");
    if (!investmentCaseId) throw new AppError("Choose the underwriting version the committee considered.");
    const makers = String(formData.get("decisionMakers") || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    await recordDecision(session, opportunityId, {
      investmentCaseId,
      outcome: String(formData.get("outcome") || "deferred") as IcOutcome,
      decisionDate: text(formData.get("decisionDate")) ?? undefined,
      recommendation: (text(formData.get("recommendation")) as Recommendation | null) ?? null,
      conditions: text(formData.get("conditions")),
      rationale: text(formData.get("rationale")),
      followUp: text(formData.get("followUp")),
      decisionMakers: makers,
    });
    refresh(opportunityId);
  }, {
    ruleMessage:
      "The committee decision could not be recorded against that underwriting " +
      "version. A superseded version cannot be taken to committee.",
  });
}

export async function amendDecisionAction(
  opportunityId: string, decisionId: string, _prev: ActionResult, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();
  const reason = text(formData.get("reason"));
  const patch: Parameters<typeof amendDecision>[2] = { reason: reason ?? "" };
  // Only fields the author actually filled in are amended: a blank box means
  // "not amending this", not "blank it out".
  const conditions = text(formData.get("conditions"));
  const rationale = text(formData.get("rationale"));
  const followUp = text(formData.get("followUp"));
  if (conditions) patch.conditions = conditions;
  if (rationale) patch.rationale = rationale;
  if (followUp) patch.followUp = followUp;
  return runAction("workspace.decision.amend", { opportunityId, decisionId }, async () => {
    if (!reason) throw new AppError("State why the decision record is being amended.");
    await amendDecision(session, decisionId, patch);
    refresh(opportunityId);
  }, {
    ruleMessage: "This amendment could not be recorded. An amendment is itself a " +
      "permanent record — add another rather than altering one.",
  });
}

// ---- Documents ------------------------------------------------------------
/**
 * Upload an internal document through the existing secure path.
 *
 * This deliberately takes a FILE and never a storage path. The earlier version
 * of this screen asked the user to type one, which was the one thing
 * documents/storage.ts states it never accepts: a browser-supplied path lets a
 * row point at an object the uploader never had, and the rows it produced could
 * not be opened at all, because the bucket is private and nothing had put a file
 * there. Every rule that governs a publication document governs this one — the
 * same allow-listed MIME types, the same size ceiling, both checked against what
 * the server sees, and a random server-generated path.
 */
export async function uploadDocumentAction(
  opportunityId: string, _prev: ActionResult, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();

  return runAction("workspace.document.upload", { opportunityId }, async () => {
    const title = text(formData.get("title"));
    if (!title) throw new AppError("A document needs a title.");

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError("Choose a file to upload.");
    }

    // Validated before a byte is stored, so a refusal leaves nothing behind.
    const check = checkUpload(file.type, file.size);
    if (!check.ok) throw new AppError(check.reason);

    const storagePath = newOpportunityObjectPath(opportunityId, check.mimeType);
    await putDocumentObject(storagePath, await file.arrayBuffer(), check.mimeType);

    try {
      await recordDocument(session, opportunityId, {
        title, storagePath,
        category: String(formData.get("category") || "Other"),
        fileName: safeFileName(file.name),
        mimeType: check.mimeType,
        sizeBytes: check.sizeBytes,
      });
    } catch (e) {
      // The row did not land, so the object must not survive it: an object with
      // no row is unreachable and unaccounted for. Same rule as the portal's
      // upload. Cleanup first, then let runAction classify the original failure.
      await deleteDocumentObject(storagePath);
      throw e;
    }

    refresh(opportunityId);
  });
}

// ---- Broker email threads --------------------------------------------------
/**
 * Confirm, or withdraw confirmation of, a thread link.
 *
 * A `review` link is a match the matcher was unsure of — it once paired
 * "16 Conduit Street" with "9 Conduit Street" on a shared street name alone.
 * Confirming is therefore a person's act and is recorded as one; the loader
 * never confirms on their behalf, and re-running it never un-confirms what
 * somebody has already agreed.
 */
export async function confirmThreadLinkAction(
  opportunityId: string, emailThreadId: string, confirmed: boolean,
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction(
    "workspace.emailThread.confirm",
    { opportunityId, emailThreadId, confirmed },
    async () => {
      await setThreadConfirmed(session, opportunityId, emailThreadId, confirmed);
      refresh(opportunityId);
    });
}
