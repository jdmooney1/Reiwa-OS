"use server";

// ============================================================================
// Triage mode server actions. Pursue / Watch / Pass on an untriaged deal, and Undo.
// ----------------------------------------------------------------------------
// The browser sends the deal id, the decision's NAME and an optional reason. What that decision
// writes (status, priority, the note's wording) is decided on the server from the table in
// lib/pipeline/triage.ts, never taken from the request. Who may write is the database's row
// policy, not this file.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireDbSession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { runAction } from "@/lib/actions/run-action";
import type { ActionResult } from "@/lib/actions/result";
import { isUuid } from "@/lib/data/portal-feed";
import { recordTriage, undoTriage, type TriageResult } from "@/lib/data/triage";

export type TriageActionResult = ActionResult & { triage?: TriageResult };

export async function triageDealAction(opportunityId: string, decision: string, reason: string): Promise<TriageActionResult> {
  const session = await requireDbSession();
  let triage: TriageResult | undefined;
  const result = await runAction("pipeline.triage.record", { opportunityId, decision }, async () => {
    if (!session.canWrite) throw new AppError("You do not have permission to triage deals.");
    if (!isUuid(opportunityId)) throw new AppError("That deal could not be found.");
    triage = await recordTriage(session, opportunityId, decision, reason);
    revalidatePath("/pipeline");
  }, { ruleMessage: "That decision could not be recorded." });
  return triage ? { ...result, triage } : result;
}

export async function undoTriageAction(opportunityId: string): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("pipeline.triage.undo", { opportunityId }, async () => {
    if (!session.canWrite) throw new AppError("You do not have permission to triage deals.");
    if (!isUuid(opportunityId)) throw new AppError("That deal could not be found.");
    await undoTriage(session, opportunityId);
    revalidatePath("/pipeline");
  }, { ruleMessage: "That decision could not be undone." });
}
