"use server";

// ============================================================================
// Investor mandate actions. Reiwa administrators only: requireAdminSession() at the
// application layer, and investor_mandates' own policy (app.is_admin()) in the database.
// A refusal (an unknown option, a minimum above the maximum) comes back as { error } for the
// form to show; it does not throw to the staff boundary.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/auth/admin";
import { AppError } from "@/lib/errors";
import { runAction } from "@/lib/actions/run-action";
import type { ActionResult } from "@/lib/actions/result";
import { saveInvestorMandate, clearInvestorMandate } from "@/lib/data/investor-mandates";
import { parseMandateInput, hasCriteria, type MandateInput } from "@/lib/mandate/mandate";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveInvestorMandateAction(
  investorOrgId: string, input: MandateInput,
): Promise<ActionResult> {
  const { auth, db } = await requireAdminSession();
  const result = await runAction("admin.investor-mandate.save", { investorOrgId }, async () => {
    if (!UUID.test(investorOrgId)) throw new AppError("That organisation could not be found.");
    const parsed = parseMandateInput(input);
    if (!parsed.ok) throw new AppError(parsed.error);
    if (!hasCriteria(parsed.mandate)) {
      throw new AppError("Choose at least one preference, or use Clear to remove the mandate.");
    }
    await saveInvestorMandate(db, investorOrgId, parsed.mandate, auth.userId);
  });
  if (!result.error) revalidatePath(`/admin/investors/${investorOrgId}`);
  return result;
}

export async function clearInvestorMandateAction(investorOrgId: string): Promise<ActionResult> {
  const { db } = await requireAdminSession();
  const result = await runAction("admin.investor-mandate.clear", { investorOrgId }, async () => {
    if (!UUID.test(investorOrgId)) throw new AppError("That organisation could not be found.");
    await clearInvestorMandate(db, investorOrgId);
  });
  if (!result.error) revalidatePath(`/admin/investors/${investorOrgId}`);
  return result;
}
