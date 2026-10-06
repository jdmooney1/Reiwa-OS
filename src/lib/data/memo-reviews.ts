// ============================================================================
// Pre-finalisation reviews - the data layer over `memo_ai_reviews` (0030).
// ----------------------------------------------------------------------------
// APPEND AND READ, and that is the whole surface. There is no update function
// and no delete function in this file, because the table grants neither: a
// review is the record of what was said before a memo went out, and a record
// that can be tidied afterwards is not worth keeping.
//
// Note what is NOT imported here: nothing from lib/data/memos.ts that writes.
// This module can insert a review row and read review rows. It has no statement
// that touches `memos` at all, so no review can alter the document it reviewed.
// ============================================================================
import { withSession, type Session } from "@/lib/db/client";
import { staffNamesOn, nameOf } from "@/lib/data/directory";
import { parseFindings, type Finding } from "@/lib/memo-review/findings";

export interface StoredReview {
  reviewId: string;
  memoId: string;
  model: string;
  findings: Finding[];
  createdByName: string | null;
  createdAt: string;
}

/**
 * Record one review run. Returns the stored row, so the caller shows exactly
 * what was written rather than what it hoped was written.
 */
export async function recordReview(
  session: Session, memoId: string, model: string, findings: Finding[],
): Promise<StoredReview> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, any>>(
      `insert into memo_ai_reviews (memo_id, model, findings, created_by)
       values ($1, $2, $3::jsonb, $4)
       returning review_id, memo_id, model, findings, created_by, created_at`,
      [memoId, model, JSON.stringify(findings), session.userId],
    );
    const r = rows[0];
    const directory = await staffNamesOn(tx, [r.created_by]);
    return {
      reviewId: r.review_id,
      memoId: r.memo_id,
      model: r.model,
      findings: parseFindings(r.findings),
      createdByName: nameOf(directory, r.created_by ?? null),
      createdAt: new Date(r.created_at).toISOString(),
    };
  });
}

/** Every review of one memo, newest first. */
export async function listReviews(session: Session, memoId: string): Promise<StoredReview[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, any>>(
      "select * from memo_ai_reviews where memo_id = $1 order by created_at desc", [memoId]);
    const directory = await staffNamesOn(tx, rows.map((r) => r.created_by));
    return rows.map((r) => ({
      reviewId: r.review_id,
      memoId: r.memo_id,
      model: r.model,
      findings: parseFindings(r.findings),
      createdByName: nameOf(directory, r.created_by ?? null),
      createdAt: new Date(r.created_at).toISOString(),
    }));
  });
}
