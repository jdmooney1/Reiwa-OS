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
import {
  checkUpload, newOpportunityObjectPath, putDocumentObject, deleteDocumentObject, safeFileName,
} from "@/lib/documents/storage";
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
  opportunityId: string, formData: FormData,
): Promise<void> {
  const session = await requireDbSession();

  const title = text(formData.get("title"));
  if (!title) throw new AppError("A document needs a title.");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new AppError("Choose a file to upload.");
  }

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
    // The row did not land, so the object must not survive it: an object with no
    // row is unreachable and unaccounted for. Same rule as the portal's upload.
    await deleteDocumentObject(storagePath);
    throw e;
  }

  refresh(opportunityId);
}
