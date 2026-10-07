"use server";

// ============================================================================
// Deal document system actions: the deal readiness checklist, the investor
// tracker, and the override flow. Same discipline as workspace.ts — thin,
// because the rules live in the database (migrations 0033-0048) and in the
// gate evaluator (src/lib/deal-gates/evaluate.ts). A refusal comes back as
// an ActionResult the screen can show beside the control that caused it.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireDbSession } from "@/lib/auth/session";
import { runAction } from "@/lib/actions/run-action";
import type { ActionResult } from "@/lib/actions/result";
import { updateDealDocument, type DealDocumentPatch } from "@/lib/data/deal-documents";
import { createDealInvestor, updateDealInvestorStatus } from "@/lib/data/deal-investors";
import { transitionDocumentStage, recordActionGateOverride } from "@/lib/data/deal-gates";

function refresh(opportunityId: string) {
  revalidatePath(`/opportunities/${opportunityId}`, "layout");
}

const text = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

export async function updateDealDocumentAction(
  opportunityId: string, dealDocumentId: string, _prev: ActionResult, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();
  const patch: DealDocumentPatch = {};
  const status = text(formData.get("status"));
  if (status !== null) patch.status = status;
  if (formData.has("ownerUserId")) patch.ownerUserId = text(formData.get("ownerUserId"));
  if (formData.has("dueDate")) patch.dueDate = text(formData.get("dueDate"));
  if (formData.has("provider")) patch.provider = text(formData.get("provider"));
  if (formData.has("notes")) patch.notes = text(formData.get("notes"));

  return runAction("deal-gates.document.update", { opportunityId, dealDocumentId }, async () => {
    await updateDealDocument(session, dealDocumentId, patch);
    refresh(opportunityId);
  }, { ruleMessage: "This document could not be updated — it may be locked, or outside your access." });
}

export async function transitionDocumentStageAction(
  opportunityId: string, direction: "forward" | "backward", _prev: ActionResult, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();
  const overrideReason = text(formData.get("overrideReason"));

  return runAction("deal-gates.stage.transition", { opportunityId, direction }, async () => {
    await transitionDocumentStage(session, opportunityId, direction, overrideReason);
    refresh(opportunityId);
  }, { ruleMessage: "This stage change could not be recorded — check your role and try again." });
}

export async function recordActionGateOverrideAction(
  opportunityId: string, action: string, _prev: ActionResult, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();
  const reason = text(formData.get("reason"));
  if (!reason) return { error: "An override needs a reason." };
  const dealInvestorId = text(formData.get("dealInvestorId"));
  const gateDocTypeKey = text(formData.get("gateDocTypeKey"));

  return runAction("deal-gates.action.override", { opportunityId, action }, async () => {
    await recordActionGateOverride(session, opportunityId, action, reason, {
      dealInvestorId, gateDocTypeKey,
    });
    refresh(opportunityId);
  }, { ruleMessage: "Only an admin or IC member may record a gate override." });
}

export async function createDealInvestorAction(
  opportunityId: string, _prev: ActionResult, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();
  const investorOrgId = text(formData.get("investorOrgId"));
  if (!investorOrgId) return { error: "Choose an investor organisation." };
  const investorType = text(formData.get("investorType"));

  return runAction("deal-gates.investor.create", { opportunityId }, async () => {
    await createDealInvestor(session, opportunityId, investorOrgId, { investorType });
    refresh(opportunityId);
  });
}

export async function updateDealInvestorStatusAction(
  opportunityId: string, dealInvestorId: string, _prev: ActionResult, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();
  const status = text(formData.get("status"));
  if (!status) return { error: "Choose a status." };

  return runAction("deal-gates.investor.status", { opportunityId, dealInvestorId }, async () => {
    await updateDealInvestorStatus(session, dealInvestorId, status);
    refresh(opportunityId);
  });
}
