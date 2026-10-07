"use server";

// ============================================================================
// Saved pipeline view server actions. Save the current filters under a name, rename,
// replace the stored filters, delete. Each returns an ActionResult.
// ----------------------------------------------------------------------------
// The browser sends a name and a view; the view is re-validated on the server before it is
// stored (a request body is a hint, not a control), and the row is the caller's own by row
// level security.
// ============================================================================
import { requireDbSession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { runAction } from "@/lib/actions/run-action";
import type { ActionResult } from "@/lib/actions/result";
import { isUuid } from "@/lib/data/portal-feed";
import { createSavedView, updateSavedView, deleteSavedView, type SavedView } from "@/lib/data/pipeline-views";

export type SavedViewResult = ActionResult & { view?: SavedView };

export async function saveViewAction(name: string, state: unknown): Promise<SavedViewResult> {
  const session = await requireDbSession();
  let view: SavedView | undefined;
  const result = await runAction("pipeline.view.save", {}, async () => {
    if (!session.canWrite) throw new AppError("You do not have permission to save views.");
    view = await createSavedView(session, name, state);
  }, { ruleMessage: "This view could not be saved." });
  return view ? { ...result, view } : result;
}

export async function updateViewAction(viewId: string, patch: { name?: string; state?: unknown }): Promise<SavedViewResult> {
  const session = await requireDbSession();
  let view: SavedView | undefined;
  const result = await runAction("pipeline.view.update", { viewId }, async () => {
    if (!session.canWrite) throw new AppError("You do not have permission to change views.");
    if (!isUuid(viewId)) throw new AppError("That view could not be found.");
    view = await updateSavedView(session, viewId, { name: patch?.name, state: patch?.state });
  }, { ruleMessage: "This view could not be changed." });
  return view ? { ...result, view } : result;
}

export async function deleteViewAction(viewId: string): Promise<ActionResult> {
  const session = await requireDbSession();
  return runAction("pipeline.view.delete", { viewId }, async () => {
    if (!session.canWrite) throw new AppError("You do not have permission to delete views.");
    if (!isUuid(viewId)) throw new AppError("That view could not be found.");
    await deleteSavedView(session, viewId);
  }, { ruleMessage: "This view could not be deleted." });
}
