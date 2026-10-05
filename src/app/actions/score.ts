"use server";

// ============================================================================
// Investment Score server action.
// ----------------------------------------------------------------------------
// Same shape as createVersionAction: resolve the session, validate what the
// browser sent (a form is a hint, not a control), write through the data layer
// under RLS, and return an ActionResult rather than throwing for anything the
// person can fix. The overall and the recommendation are never taken from the
// browser: they are computed on the server from the scores, through the model.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireDbSession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { runAction } from "@/lib/actions/run-action";
import type { ActionResult } from "@/lib/actions/result";
import { isUuid } from "@/lib/data/portal-feed";
import { saveScore } from "@/lib/data/scores";
import { validateScoreSubmission } from "@/lib/scoring/score";

export async function saveScoreAction(
  opportunityId: string, categories: unknown,
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.score.save", { opportunityId }, async () => {
    if (!session.canWrite) throw new AppError("You do not have permission to record a score.");
    if (!isUuid(opportunityId)) throw new AppError("That opportunity could not be found.");
    const parsed = validateScoreSubmission(categories);
    if (!parsed.ok) throw new AppError(parsed.error);
    await saveScore(session, opportunityId, parsed.categories);
    revalidatePath(`/opportunities/${opportunityId}/score`);
    revalidatePath(`/opportunities/${opportunityId}/memo`);
  }, { ruleMessage: "This score could not be recorded." });
}
