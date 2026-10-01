"use server";

// ============================================================================
// Memo server actions.
// ----------------------------------------------------------------------------
// Thin, like the workspace actions: resolve the session, compose from rows, let
// the database refuse what it must. The rule that a FINAL memo cannot change is
// the database's (app.guard_memo, migration 0023); the checks here only turn a
// refusal into a sentence the person can read.
//
// There is no action that writes composed text. Composition is a pure function of
// rows (lib/memo/compose.ts); the only free text a person adds is an override.
// ============================================================================
import { revalidatePath } from "next/cache";
import { requireDbSession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { runAction } from "@/lib/actions/run-action";
import type { ActionResult } from "@/lib/actions/result";
import { isUuid } from "@/lib/data/portal-feed";
import {
  loadMemoSource, latestMemo, createMemoDraft, recomposeDraft, setOverride, finalizeMemo,
} from "@/lib/data/memos";
import { composeMemo, isOverrideKey } from "@/lib/memo/compose";
import type { Session } from "@/lib/db/client";

function refresh(opportunityId: string) {
  revalidatePath(`/opportunities/${opportunityId}/memo`);
}

function writable(session: Session, opportunityId: string) {
  if (!session.canWrite) throw new AppError("You do not have permission to change memos.");
  if (!isUuid(opportunityId)) throw new AppError("That opportunity could not be found.");
}

async function composeNow(session: Session, opportunityId: string) {
  const src = await loadMemoSource(session, opportunityId);
  if (!src) throw new AppError("That opportunity could not be found.");
  return composeMemo(src);
}

/** First memo, or the next version after a final one. */
export async function startMemoAction(opportunityId: string): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.memo.start", { opportunityId }, async () => {
    writable(session, opportunityId);
    await createMemoDraft(session, opportunityId, await composeNow(session, opportunityId));
    refresh(opportunityId);
  }, { ruleMessage: "This memo could not be started." });
}

/** Recompose a DRAFT from today's rows. The human overrides are kept. */
export async function recomposeMemoAction(opportunityId: string, memoId: string): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.memo.recompose", { opportunityId, memoId }, async () => {
    writable(session, opportunityId);
    if (!isUuid(memoId)) throw new AppError("That memo could not be found.");
    await recomposeDraft(session, memoId, await composeNow(session, opportunityId));
    refresh(opportunityId);
  }, { ruleMessage: "This memo could not be recomposed. A final memo is permanent." });
}

export async function saveMemoOverrideAction(
  opportunityId: string, memoId: string, key: string, _prev: ActionResult, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.memo.override", { opportunityId, memoId, key }, async () => {
    writable(session, opportunityId);
    if (!isUuid(memoId)) throw new AppError("That memo could not be found.");
    if (!isOverrideKey(key)) throw new AppError("That is not a section of the memo.");
    const text = formData.get("text");
    await setOverride(session, memoId, key, typeof text === "string" ? text : "");
    refresh(opportunityId);
  }, { ruleMessage: "This memo is final and cannot be edited." });
}

/**
 * Finalise a draft. Irreversible. The browser asks the person to confirm; the
 * server requires that confirmation too, so a request that skipped the screen
 * cannot finalise by accident.
 */
export async function finalizeMemoAction(
  opportunityId: string, memoId: string, _prev: ActionResult, formData: FormData,
): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("workspace.memo.finalize", { opportunityId, memoId }, async () => {
    writable(session, opportunityId);
    if (!isUuid(memoId)) throw new AppError("That memo could not be found.");
    if (formData.get("confirm") !== "yes") throw new AppError("Confirm that you want to finalise this memo. It cannot be undone.");
    const latest = await latestMemo(session, opportunityId);
    if (!latest || latest.memoId !== memoId) throw new AppError("That is not the current memo for this opportunity.");
    await finalizeMemo(session, memoId);
    refresh(opportunityId);
  }, { ruleMessage: "This memo could not be finalised." });
}
