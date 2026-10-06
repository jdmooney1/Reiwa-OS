// ============================================================================
// Saving a translated section, and taking one back out - the ACCEPT side.
// ----------------------------------------------------------------------------
// The ONLY code that writes memos.ja_overrides, and it runs only from an administrator
// pressing Accept (or Remove) on one section. Generation cannot reach it: the generate
// action imports neither this file nor anything that does.
//
// ACCEPT, in one transaction, for one section:
//   1. the draft exists, belongs to THIS memo, and actually contained that section;
//   2. the text is non-empty and within the limit (it may be the draft as drafted or as
//      the person edited it - what is saved is what they submit, not what was generated);
//   3. its figures match the English the draft was made from, or the person has said, in
//      so many words, to save it anyway;
//   4. the memo is still a DRAFT (the database also refuses a final memo: guard_memo);
//   5. only then memos.ja_overrides gains the section, and the draft's accepted_sections
//      gains the key. A section merely generated is never in accepted_sections.
//
// REMOVE clears a saved section from the draft memo. accepted_sections is NOT edited: it
// is the record of what was ever kept, and "kept, then taken back" is a fact worth having.
// ============================================================================
import { withSession, type Session } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { isTeaserKey, MAX_JA_CHARS } from "@/lib/memo-translation/sections";
import { checkFigures, figureProblem } from "@/lib/memo-translation/numbers";

export interface AcceptInput {
  memoId: string;
  draftId: string;
  key: string;
  text: string;
  /** The person has seen that the figures differ and chose to save the text anyway. */
  acknowledgeFigures?: boolean;
}

export async function acceptTranslatedSection(session: Session, input: AcceptInput): Promise<void> {
  if (!isTeaserKey(input.key)) throw new AppError("That is not a section of the Investor Teaser.");
  const text = input.text.replace(/\r\n/g, "\n").trim();
  if (!text) throw new AppError("There is no text to save. Discard the draft instead, or write the Japanese first.");
  if (text.length > MAX_JA_CHARS) throw new AppError(`That text is longer than ${MAX_JA_CHARS.toLocaleString("en-GB")} characters.`);

  await withSession(session, async (tx) => {
    const found = await tx.query<{ sections: Record<string, { source?: string }> }>(
      "select sections from memo_translation_drafts where draft_id = $1 and memo_id = $2",
      [input.draftId, input.memoId]);
    const source = found.rows[0]?.sections?.[input.key]?.source;
    if (typeof source !== "string") throw new AppError("That draft does not contain this section.");

    const problem = figureProblem(checkFigures(source, text));
    if (problem && !input.acknowledgeFigures) {
      throw new AppError(`${problem} Edit the Japanese so the figures match the English, or save it as it stands.`);
    }

    const written = await tx.query(
      `update memos set ja_overrides = jsonb_set(ja_overrides, array[$2::text], to_jsonb($3::text), true)
        where memo_id = $1 and status = 'draft' returning memo_id`,
      [input.memoId, input.key, text]);
    if (written.rows.length === 0) {
      throw new AppError("Only a draft memo can take a translation. A final memo is permanent: create a new version.");
    }

    await tx.query(
      `update memo_translation_drafts
          set accepted_sections = case when accepted_sections ? $2 then accepted_sections
                                       else accepted_sections || to_jsonb($2::text) end
        where draft_id = $1`,
      [input.draftId, input.key]);
  });
}

/** Take one saved Japanese section back out of a draft memo. */
export async function removeTranslatedSection(session: Session, memoId: string, key: string): Promise<void> {
  if (!isTeaserKey(key)) throw new AppError("That is not a section of the Investor Teaser.");
  await withSession(session, async (tx) => {
    const { rows } = await tx.query(
      "update memos set ja_overrides = ja_overrides - $2::text where memo_id = $1 and status = 'draft' returning memo_id",
      [memoId, key]);
    if (rows.length === 0) throw new AppError("Only a draft memo can be edited. A final memo is permanent: create a new version.");
  });
}
