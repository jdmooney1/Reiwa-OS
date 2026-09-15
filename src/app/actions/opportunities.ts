"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireDbSession } from "@/lib/auth/session";
import {
  createOpportunity, updateOpportunity, setStage, setOutcome, reactivate,
  type OppStage, type OppStatus,
} from "@/lib/data/opportunities";
import { convertToAsset } from "@/lib/data/conversion";
import { AppError } from "@/lib/errors";

const numOrNull = (v: FormDataEntryValue | null): number | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : Number(s);
};

export async function createOpportunityAction(formData: FormData): Promise<void> {
  const session = await requireDbSession();
  const orgId = String(formData.get("orgId") || "");
  if (!orgId) throw new AppError("Organisation is required");
  const id = await createOpportunity(session, {
    orgId,
    name: String(formData.get("name") || "").trim(),
    city: String(formData.get("city") || "").trim() || null,
    market: String(formData.get("market") || "").trim() || null,
    country: String(formData.get("country") || "").trim() || null,
    assetType: String(formData.get("assetType") || "other"),
    strategy: String(formData.get("strategy") || "").trim() || null,
    currency: String(formData.get("currency") || "GBP"),
    targetPrice: numOrNull(formData.get("targetPrice")),
    niy: numOrNull(formData.get("niy")),
    targetIrr: numOrNull(formData.get("targetIrr")),
    capexBudget: numOrNull(formData.get("capexBudget")),
    source: String(formData.get("source") || "").trim() || null,
    brokerName: String(formData.get("brokerName") || "").trim() || null,
    summary: String(formData.get("summary") || "").trim() || null,
  });
  revalidatePath("/pipeline");
  redirect(`/opportunities/${id}`);
}

/**
 * Edit the opportunity's identity, origination and workflow.
 *
 * No financial fields. They were here until Phase 1A made the investment case
 * the only writable source of them — at which point this action sent four keys
 * that updateOpportunity refuses, and every save on this screen threw. The fix
 * is not to filter them out quietly: it is that money is edited by creating an
 * underwriting version, which is a different action on a different screen.
 */
export async function updateOpportunityAction(id: string, formData: FormData): Promise<void> {
  const session = await requireDbSession();
  const optional = (key: string) => {
    const v = formData.get(key);
    return v === null ? undefined : (String(v).trim() || null);
  };
  const patch: Record<string, unknown> = {};
  for (const key of [
    "name", "strategy", "summary", "market", "submarket", "source", "brokerName",
    "vendorName", "sourceType", "sourceContactName", "sourceContactEmail",
    "sourcedAt", "referralNote", "priority", "nextMilestone", "nextMilestoneDate",
  ]) {
    const v = optional(key);
    if (v !== undefined) patch[key] = v;
  }
  if (formData.get("probability") !== null) {
    patch.probability = numOrNull(formData.get("probability"));
  }
  await updateOpportunity(session, id, patch);
  revalidatePath(`/opportunities/${id}`, "layout");
  revalidatePath("/pipeline");
}

export async function setStageAction(id: string, stage: OppStage): Promise<void> {
  const session = await requireDbSession();
  await setStage(session, id, stage);
  revalidatePath(`/opportunities/${id}`);
  revalidatePath("/pipeline");
}

export async function setOutcomeAction(id: string, status: OppStatus): Promise<void> {
  const session = await requireDbSession();
  await setOutcome(session, id, status);
  revalidatePath(`/opportunities/${id}`);
  revalidatePath("/pipeline");
}

export async function reactivateAction(id: string): Promise<void> {
  const session = await requireDbSession();
  await reactivate(session, id);
  revalidatePath(`/opportunities/${id}`);
  revalidatePath("/pipeline");
}

export async function convertToAssetAction(id: string): Promise<void> {
  const session = await requireDbSession();
  const { assetId } = await convertToAsset(session, id);
  revalidatePath("/portfolio");
  revalidatePath("/pipeline");
  redirect(`/assets/${assetId}`);
}
