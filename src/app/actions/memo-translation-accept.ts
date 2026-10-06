"use server";

// ============================================================================
// Save a translated section, or take one back. The only actions that write ja_overrides.
// ----------------------------------------------------------------------------
// ADMIN ONLY. One section per call, always an explicit act by a person: there is no
// "accept all", no auto-acceptance, and nothing here is reachable from the generate
// action. What is saved is the text the person submits (as drafted, or after they edited
// it), never a value read back from the model.
//
// This module imports no model: it cannot generate, so a save can never trigger a call.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireAdminSession } from "@/lib/auth/admin";
import { AppError } from "@/lib/errors";
import { runAction } from "@/lib/actions/run-action";
import type { ActionResult } from "@/lib/actions/result";
import { isUuid } from "@/lib/data/portal-feed";
import { acceptTranslatedSection, removeTranslatedSection } from "@/lib/data/memo-translation-accept";

function ids(opportunityId: string, memoId: string) {
  if (!isUuid(opportunityId)) throw new AppError("That opportunity could not be found.");
  if (!isUuid(memoId)) throw new AppError("That memo could not be found.");
}

export async function acceptTranslationAction(
  opportunityId: string, memoId: string, draftId: string, key: string, text: string, acknowledgeFigures = false,
): Promise<ActionResult> {
  const { db } = await requireAdminSession();
  return runAction("workspace.memo.translation.accept", { opportunityId, memoId, draftId, key }, async () => {
    ids(opportunityId, memoId);
    if (!isUuid(draftId)) throw new AppError("That draft could not be found.");
    await acceptTranslatedSection(db, { memoId, draftId, key, text, acknowledgeFigures });
    revalidatePath(`/opportunities/${opportunityId}/memo`);
  }, { ruleMessage: "This translation could not be saved." });
}

export async function removeTranslationAction(
  opportunityId: string, memoId: string, key: string,
): Promise<ActionResult> {
  const { db } = await requireAdminSession();
  return runAction("workspace.memo.translation.remove", { opportunityId, memoId, key }, async () => {
    ids(opportunityId, memoId);
    await removeTranslatedSection(db, memoId, key);
    revalidatePath(`/opportunities/${opportunityId}/memo`);
  }, { ruleMessage: "This translation could not be removed." });
}
