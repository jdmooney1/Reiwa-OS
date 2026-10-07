"use server";

// ============================================================================
// Take a deal off the pipeline (sold / withdrawn / lost / passed) and restore it.
// ----------------------------------------------------------------------------
// The browser sends the deal id, the reason's NAME and an optional note. The status each reason
// writes is decided on the server from the table in lib/pipeline/removal.ts, never from the request;
// who may write is the database's row policy.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireDbSession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { runAction } from "@/lib/actions/run-action";
import type { ActionResult } from "@/lib/actions/result";
import { isUuid } from "@/lib/data/portal-feed";
import { removeFromPipeline, restoreToPipeline } from "@/lib/data/removal";
import type { RemovedStatus } from "@/lib/pipeline/removal";

export type RemoveResult = ActionResult & { status?: RemovedStatus };

export async function removeDealAction(opportunityId: string, reason: string, note: string): Promise<RemoveResult> {
  const session = await requireDbSession();
  let status: RemovedStatus | undefined;
  const result = await runAction("pipeline.deal.remove", { opportunityId, reason }, async () => {
    if (!session.canWrite) throw new AppError("You do not have permission to change deals.");
    if (!isUuid(opportunityId)) throw new AppError("That deal could not be found.");
    status = (await removeFromPipeline(session, opportunityId, reason, note)).status;
    revalidatePath("/pipeline");
    revalidatePath(`/opportunities/${opportunityId}`);
  }, { ruleMessage: "This deal could not be taken off the pipeline." });
  return status ? { ...result, status } : result;
}

export async function restoreDealAction(opportunityId: string): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("pipeline.deal.restore", { opportunityId }, async () => {
    if (!session.canWrite) throw new AppError("You do not have permission to change deals.");
    if (!isUuid(opportunityId)) throw new AppError("That deal could not be found.");
    await restoreToPipeline(session, opportunityId);
    revalidatePath("/pipeline");
    revalidatePath(`/opportunities/${opportunityId}`);
  }, { ruleMessage: "This deal could not be restored." });
}
