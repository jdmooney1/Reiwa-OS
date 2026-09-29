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
import { runAction } from "@/lib/actions/run-action";
import type { ActionResult } from "@/lib/actions/result";
import { parseNumber, PERCENT, NON_NEGATIVE } from "@/lib/validation/numeric";
import { currencyMismatch } from "@/lib/market-currency";

const CURRENCIES = ["GBP", "EUR", "USD", "JPY"];

/**
 * Create an opportunity.
 *
 * Returns an ActionResult instead of throwing, so a refusal - a percentage of
 * 150, "12e3" in the price, a currency that does not fit the market - comes
 * back beside the form with what was typed still in it, rather than replacing
 * the screen with the route error boundary.
 *
 * The number and currency rules are enforced HERE, on the server. The form's
 * own attributes are a convenience: a browser lets "e" through a number input
 * and a request need not come from a browser at all.
 */
export async function createOpportunityAction(
  _prev: ActionResult, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();
  let id = "";
  const result = await runAction("opportunity.create", {}, async () => {
    const orgId = String(formData.get("orgId") || "");
    if (!orgId) throw new AppError("Organisation is required");
    const currency = String(formData.get("currency") || "GBP");
    if (!CURRENCIES.includes(currency)) throw new AppError(`Currency must be one of ${CURRENCIES.join(", ")}.`);
    const market = String(formData.get("market") || "").trim() || null;
    const country = String(formData.get("country") || "").trim() || null;
    const mismatch = currencyMismatch(currency, market, country);
    if (mismatch && formData.get("confirmCurrency") !== "on") {
      throw new AppError(`${mismatch} Confirm the currency to continue, or change it.`);
    }
    const input = {
      orgId,
      name: String(formData.get("name") || "").trim(),
      address: String(formData.get("address") || "").trim() || null,
      postcode: String(formData.get("postcode") || "").trim() || null,
      city: String(formData.get("city") || "").trim() || null,
      market,
      country,
      assetType: String(formData.get("assetType") || "other"),
      strategy: String(formData.get("strategy") || "").trim() || null,
      currency,
      targetPrice: parseNumber(formData.get("targetPrice"), "Target price", NON_NEGATIVE),
      niy: parseNumber(formData.get("niy"), "NIY", PERCENT),
      targetIrr: parseNumber(formData.get("targetIrr"), "Target IRR", PERCENT),
      capexBudget: parseNumber(formData.get("capexBudget"), "Capex budget", NON_NEGATIVE),
      source: String(formData.get("source") || "").trim() || null,
      brokerName: String(formData.get("brokerName") || "").trim() || null,
      summary: String(formData.get("summary") || "").trim() || null,
    };
    id = await createOpportunity(session, input);
  });
  if (result.error) return result;
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
    patch.probability = parseNumber(formData.get("probability"), "Probability", PERCENT);
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
