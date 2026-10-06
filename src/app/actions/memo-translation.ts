"use server";

// ============================================================================
// The "draft a Japanese translation" action.
// ----------------------------------------------------------------------------
// ADMIN ONLY, DRAFT ONLY, AND IT WRITES NOTHING BUT ITS OWN AUDIT ROW.
//
// Read the imports as the specification. This module can: resolve an admin session,
// READ one memo, build the English source from it, call the translator, and insert a row
// in memo_translation_drafts. It does NOT import the accept module, setOverride,
// recomposeDraft, createMemoDraft or finalizeMemo, so there is no path from a model
// response to memos.ja_overrides, to memos.overrides, or to the document at all. Saving a
// section is a different action in a different file (memo-translation-accept.ts), and
// tests/unit/memo-translation-boundaries.test.ts asserts both lists.
//
// Deliberately no revalidatePath: generating changes nothing on the page. The draft goes
// back to the caller and lives in the panel's own state.
// ============================================================================
import { requireAdminSession } from "@/lib/auth/admin";
import { AppError } from "@/lib/errors";
import { runAction } from "@/lib/actions/run-action";
import type { ActionResult } from "@/lib/actions/result";
import { isUuid } from "@/lib/data/portal-feed";
import { getMemo } from "@/lib/data/memos";
import { recordTranslationDraft } from "@/lib/data/memo-translation-drafts";
import { generateTranslationDraft, type GeneratedDraft } from "@/lib/memo-translation/generate";
import { runTranslation } from "@/lib/memo-translation/translate";

export interface TranslateActionResult extends ActionResult {
  /** Present exactly when a translation ran and its draft was recorded. */
  draft?: GeneratedDraft;
}

/**
 * Draft a Japanese version of one DRAFT memo's Investor Teaser: one call, one audit row,
 * one set of per-section drafts handed back. Nothing is saved to the memo.
 */
export async function translateMemoAction(opportunityId: string, memoId: string): Promise<TranslateActionResult> {
  const { db } = await requireAdminSession();

  let draft: GeneratedDraft | undefined;
  const result = await runAction("workspace.memo.translate", { opportunityId, memoId }, async () => {
    if (!isUuid(opportunityId)) throw new AppError("That opportunity could not be found.");
    if (!isUuid(memoId)) throw new AppError("That memo could not be found.");

    const memo = await getMemo(db, memoId);
    if (!memo || memo.opportunityId !== opportunityId) throw new AppError("That memo could not be found.");

    draft = await generateTranslationDraft(memo, {
      translate: runTranslation,
      record: (model, sections) => recordTranslationDraft(db, memoId, model, sections),
    });
  }, { ruleMessage: "This translation could not be recorded." });

  return draft ? { ...result, draft } : result;
}
