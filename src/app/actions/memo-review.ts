"use server";

// ============================================================================
// The pre-finalisation review action.
// ----------------------------------------------------------------------------
// ADMIN ONLY, DRAFT ONLY, AND IT WRITES NOTHING BUT ITS OWN AUDIT ROW.
//
// Read the imports as the specification. This module can: resolve an admin
// session, READ one memo, build prompt text from it, call the reviewer, and
// insert a row in memo_ai_reviews. It imports no function that writes to a
// memo - not setOverride, not recomposeDraft, not createMemoDraft, not
// finalizeMemo - so there is no code path from a model response to the document
// it reviewed. tests/unit/memo-review-boundaries.test.ts asserts that list.
//
// NOT A GATE. This action is never called by finalizeMemoAction and never calls
// it. A memo with twenty open findings finalises exactly as one with none: the
// findings are advice, and a model's false positive must not be able to hold up
// a deal. Nothing in here, and nothing in the panel it feeds, can refuse a
// finalisation.
//
// Deliberately no revalidatePath: a review changes nothing on the page. The
// findings go back to the caller and live in the panel's own state, so running
// one cannot flicker or reset the memo the person is reading.
// ============================================================================
import { requireStaffSession } from "@/lib/auth/admin";
import { AppError } from "@/lib/errors";
import { runAction } from "@/lib/actions/run-action";
import type { ActionResult } from "@/lib/actions/result";
import { isUuid } from "@/lib/data/portal-feed";
import { getMemo } from "@/lib/data/memos";
import { recordReview, type StoredReview } from "@/lib/data/memo-reviews";
import { buildReviewPrompt, REVIEW_SYSTEM_PROMPT } from "@/lib/memo-review/prompt";
import { runReview } from "@/lib/memo-review/review";
import { reviewRefusalReason } from "@/lib/memo-review/eligibility";
import { FORMAT_BY_KEY, type OutputFormat } from "@/lib/memo/sections";

export interface ReviewActionResult extends ActionResult {
  /** Present exactly when a review ran and was recorded. */
  review?: StoredReview;
}

/**
 * Review one DRAFT memo and record what came back.
 *
 * One call, one row, one list of findings handed back to the panel. Refuses on
 * a final memo for the same reason every other memo write does: a final memo is
 * the document a decision was made on, and attaching a fresh opinion to it after
 * the fact would make the record of "what was reviewed before it went out"
 * ambiguous. Review the next version instead.
 */
export async function reviewMemoAction(
  opportunityId: string, memoId: string, format: string,
): Promise<ReviewActionResult> {
  const { db } = await requireStaffSession();

  let review: StoredReview | undefined;
  const result = await runAction("workspace.memo.review", { opportunityId, memoId, format }, async () => {
    if (!isUuid(opportunityId)) throw new AppError("That opportunity could not be found.");
    if (!isUuid(memoId)) throw new AppError("That memo could not be found.");
    if (!(format in FORMAT_BY_KEY)) throw new AppError("That is not a format of the memo.");

    const memo = await getMemo(db, memoId);
    if (!memo || memo.opportunityId !== opportunityId) {
      throw new AppError("That memo could not be found.");
    }
    const refusal = reviewRefusalReason(memo.status);
    if (refusal) throw new AppError(refusal);

    // The composed memo object, overrides applied. Not a fresh query against
    // opportunities, properties or investment_cases.
    const memoText = buildReviewPrompt(memo.content, memo.overrides, format as OutputFormat);
    const outcome = await runReview(REVIEW_SYSTEM_PROMPT, memoText);

    review = await recordReview(db, memoId, outcome.model, outcome.findings);
  }, { ruleMessage: "This review could not be recorded." });

  return review ? { ...result, review } : result;
}
