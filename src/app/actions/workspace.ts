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
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireDbSession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { createVersion, makeCurrent, type UnderwritingInput } from "@/lib/data/underwriting";
import { applyDdTemplate, updateDdItem, addDdItem, type DdItemPatch } from "@/lib/data/due-diligence";
import { createRisk, promoteFindingToRisk, updateRisk, type RiskPatch } from "@/lib/data/opportunity-risks";
import { recordDecision, amendDecision, type IcOutcome } from "@/lib/data/ic-decisions";
import { recordDocument } from "@/lib/data/opportunity-documents";
import type { DdStatus, Recommendation } from "@/types/database";

const num = (v: FormDataEntryValue | null): number | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : Number(s);
};
const text = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

function refresh(opportunityId: string) {
  revalidatePath(`/opportunities/${opportunityId}`, "layout");
  revalidatePath("/pipeline");
}

// ---- Underwriting ---------------------------------------------------------
const UNDERWRITING_NUMERIC: (keyof UnderwritingInput)[] = [
  "acquisitionPrice", "acquisitionCosts", "capex", "equity", "grossRentalIncome",
  "noi", "erv", "occupancyPct", "debt", "ltvPct", "debtCostPct", "valuation",
  "exitValue", "entryYieldPct", "exitYieldPct", "holdPeriodYears", "targetIrr",
  "targetEquityMultiple",
];

export async function createVersionAction(
  opportunityId: string, formData: FormData,
): Promise<void> {
  const session = await requireDbSession();
  const input: UnderwritingInput = {
    strategy: text(formData.get("strategy")),
    thesis: text(formData.get("thesis")),
    businessPlanAssumptions: text(formData.get("businessPlanAssumptions")),
    changeRationale: text(formData.get("changeRationale")),
  };
  for (const key of UNDERWRITING_NUMERIC) {
    (input as Record<string, unknown>)[key] = num(formData.get(key));
  }
  await createVersion(session, opportunityId, input);
  refresh(opportunityId);
}

export async function makeCurrentVersionAction(
  opportunityId: string, caseId: string,
): Promise<void> {
  const session = await requireDbSession();
  await makeCurrent(session, caseId);
  refresh(opportunityId);
}

// ---- Due diligence --------------------------------------------------------
export async function applyDdTemplateAction(
  opportunityId: string, templateId: "london" | "amsterdam",
): Promise<void> {
  const session = await requireDbSession();
  await applyDdTemplate(session, opportunityId, templateId);
  refresh(opportunityId);
}

export async function updateDdItemAction(
  opportunityId: string, ddItemId: string, formData: FormData,
): Promise<void> {
  const session = await requireDbSession();
  const patch: DdItemPatch = {
    status: String(formData.get("status") || "not_started") as DdStatus,
    dueDate: text(formData.get("dueDate")),
    finding: text(formData.get("finding")),
    resolution: text(formData.get("resolution")),
  };
  const owner = text(formData.get("ownerUserId"));
  if (owner !== null) patch.ownerUserId = owner;
  await updateDdItem(session, ddItemId, patch);
  refresh(opportunityId);
}

export async function addDdItemAction(
  opportunityId: string, formData: FormData,
): Promise<void> {
  const session = await requireDbSession();
  const section = text(formData.get("section"));
  const item = text(formData.get("item"));
  if (!section || !item) throw new AppError("A workstream needs a section and a title.");
  await addDdItem(session, opportunityId, {
    section, item,
    question: text(formData.get("question")),
    priority: String(formData.get("priority") || "medium"),
  });
  refresh(opportunityId);
}

// ---- Risks ----------------------------------------------------------------
export async function promoteFindingAction(
  opportunityId: string, ddItemId: string,
): Promise<void> {
  const session = await requireDbSession();
  await promoteFindingToRisk(session, ddItemId);
  refresh(opportunityId);
}

export async function createRiskAction(
  opportunityId: string, formData: FormData,
): Promise<void> {
  const session = await requireDbSession();
  const title = text(formData.get("title"));
  if (!title) throw new AppError("A risk needs a title.");
  await createRisk(session, opportunityId, {
    title,
    category: String(formData.get("category") || "other"),
    description: text(formData.get("description")),
    severity: String(formData.get("severity") || "medium") as RiskPatch["severity"],
    mitigation: text(formData.get("mitigation")),
    financialImpact: num(formData.get("financialImpact")),
  });
  refresh(opportunityId);
}

export async function updateRiskAction(
  opportunityId: string, riskId: string, formData: FormData,
): Promise<void> {
  const session = await requireDbSession();
  await updateRisk(session, riskId, {
    status: String(formData.get("status") || "open") as RiskPatch["status"],
    severity: String(formData.get("severity") || "medium") as RiskPatch["severity"],
    mitigation: text(formData.get("mitigation")),
  });
  refresh(opportunityId);
}

// ---- Investment committee -------------------------------------------------
export async function recordDecisionAction(
  opportunityId: string, formData: FormData,
): Promise<void> {
  const session = await requireDbSession();
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
}

export async function amendDecisionAction(
  opportunityId: string, decisionId: string, formData: FormData,
): Promise<void> {
  const session = await requireDbSession();
  const reason = text(formData.get("reason"));
  if (!reason) throw new AppError("State why the decision record is being amended.");
  const patch: Parameters<typeof amendDecision>[2] = { reason };
  // Only fields the author actually filled in are amended: a blank box means
  // "not amending this", not "blank it out".
  const conditions = text(formData.get("conditions"));
  const rationale = text(formData.get("rationale"));
  const followUp = text(formData.get("followUp"));
  if (conditions) patch.conditions = conditions;
  if (rationale) patch.rationale = rationale;
  if (followUp) patch.followUp = followUp;
  await amendDecision(session, decisionId, patch);
  refresh(opportunityId);
}

// ---- Documents ------------------------------------------------------------
export async function recordDocumentAction(
  opportunityId: string, formData: FormData,
): Promise<void> {
  const session = await requireDbSession();
  const title = text(formData.get("title"));
  const storagePath = text(formData.get("storagePath"));
  if (!title || !storagePath) throw new AppError("A document needs a title and a stored file.");
  await recordDocument(session, opportunityId, {
    title, storagePath,
    category: String(formData.get("category") || "Other"),
    fileName: text(formData.get("fileName")),
    mimeType: text(formData.get("mimeType")),
    sizeBytes: num(formData.get("sizeBytes")),
  });
  refresh(opportunityId);
}
