// ============================================================================
// Translation drafts - the data layer over `memo_translation_drafts` (0031), the
// GENERATION side.
// ----------------------------------------------------------------------------
// Insert and read, and that is all this file does. It has no statement that touches
// `memos` and no way to update a draft, so generating a translation cannot write
// memos.ja_overrides or anything else about the document: the only thing a generation
// leaves behind is its own audit row. Saving a section is the other file,
// memo-translation-accept.ts, reached only from an explicit Accept.
// ============================================================================
import { withSession, type Session } from "@/lib/db/client";
import { staffNamesOn, nameOf } from "@/lib/data/directory";

/** Record one generation. Returns what was stored, so the caller shows what was written. */
export async function recordTranslationDraft(
  session: Session, memoId: string, model: string,
  sections: Record<string, { source: string; draft: string }>,
): Promise<{ draftId: string; createdAt: string; createdByName: string | null }> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, any>>(
      `insert into memo_translation_drafts (memo_id, model, sections, created_by)
       values ($1, $2, $3::jsonb, $4)
       returning draft_id, created_by, created_at`,
      [memoId, model, JSON.stringify(sections), session.userId]);
    const r = rows[0];
    const directory = await staffNamesOn(tx, [r.created_by]);
    return {
      draftId: r.draft_id,
      createdAt: new Date(r.created_at).toISOString(),
      createdByName: nameOf(directory, r.created_by ?? null),
    };
  });
}

export interface StoredTranslationDraft {
  draftId: string;
  memoId: string;
  model: string;
  sections: Record<string, { source: string; draft: string }>;
  acceptedSections: string[];
  createdAt: string;
}

/** Every generation for one memo, newest first. */
export async function listTranslationDrafts(session: Session, memoId: string): Promise<StoredTranslationDraft[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, any>>(
      "select * from memo_translation_drafts where memo_id = $1 order by created_at desc", [memoId]);
    return rows.map((r) => ({
      draftId: r.draft_id, memoId: r.memo_id, model: r.model,
      sections: r.sections ?? {}, acceptedSections: Array.isArray(r.accepted_sections) ? r.accepted_sections : [],
      createdAt: new Date(r.created_at).toISOString(),
    }));
  });
}
