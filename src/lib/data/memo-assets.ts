// ============================================================================
// Freezing a Snapshot's pictures at finalisation, and serving the copies.
// ----------------------------------------------------------------------------
// A draft keeps LIVE references to the photograph and map (so staff see current
// pictures while they iterate). The moment a memo is finalised, each picture is
// copied into the private `memo-assets` bucket under the memo's own id and the
// memo's content is rewritten to point at the copy, in the same transaction that
// flips the memo to final. After that nothing in the memo refers to property_photos.
//
// WHY THE CONTENT IS REWRITTEN FIRST, THEN THE MEMO IS FINALISED. app.guard_memo
// (migration 0023) lets a draft become final only by an update that changes the
// stamp and nothing else, so the content has to be settled while it is still a draft.
// Both statements run in ONE transaction; a failure leaves the draft exactly as it was
// (a copy already written to storage is an orphan keyed by this memo, harmless, and the
// same bytes land on the same path next time).
//
// WHAT IS REFUSED. A draft whose picture is no longer there, or is no longer cleared for
// investors, is not finalised: the document would print something staff did not review, or
// a picture they have since withdrawn. The message says to recompose the draft.
//
// SERVER-ONLY.
// ============================================================================
import { createHash } from "node:crypto";
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/data/portal-feed";
import { getPhotoObjectBytes } from "@/lib/photos/storage";
import { mayReadPhoto } from "@/lib/photos/access";
import {
  frozenAssetPath, freezeSnapshotContent, isFrozenPathOf, liveRefsIn, type FrozenSlot, type LiveRef,
} from "@/lib/memo/assets";
import { ensureMemoAssetBucket, putMemoAsset, signMemoAsset } from "@/lib/memo/assets-store";
import type { SnapshotSlot } from "@/lib/memo/snapshot-images";

const GONE =
  "A picture in this draft's Asset Snapshot is no longer available or is no longer cleared for investors. " +
  "Recompose the draft to pick up the current pictures, then finalise.";

const KIND_FOR: Record<FrozenSlot, "building" | "map"> = { photo: "building", map: "map" };

interface DraftRow { content: Record<string, unknown>; opportunity_id: string }

/**
 * Copy one live picture into the memo's own folder. Checks, as the caller, that the
 * photograph still exists, is still cleared (`diligence`), is the right kind for the
 * slot, and belongs to this opportunity's property.
 */
async function copyOne(
  session: Session, memoId: string, opportunityId: string, ref: LiveRef,
): Promise<string> {
  if (!isUuid(ref.photoId)) throw new AppError(GONE);
  const row = await withSession(session, async (tx: Queryable) => {
    const { rows } = await tx.query<{ object_path: string; visibility: string; kind: string }>(
      `select pp.object_path, pp.visibility, pp.kind
         from property_photos pp
         join opportunities o on o.property_id = pp.property_id
        where pp.photo_id = $1 and o.opportunity_id = $2`, [ref.photoId, opportunityId]);
    return rows[0] ?? null;
  });
  if (!row || row.visibility !== "diligence" || row.kind !== KIND_FOR[ref.slot]) throw new AppError(GONE);

  const bytes = await getPhotoObjectBytes(row.object_path);
  if (!bytes) throw new AppError(GONE);

  const path = frozenAssetPath(memoId, ref.slot, createHash("sha256").update(bytes).digest("hex"));
  await ensureMemoAssetBucket();
  await putMemoAsset(path, bytes);
  return path;
}

/**
 * Finalise a draft memo, freezing its Snapshot pictures first. Replaces a bare
 * finalizeMemo for the person-facing path: a memo with no pictures goes through the
 * same single statement it always did.
 */
export async function finaliseMemoFreezingAssets(session: Session, memoId: string): Promise<void> {
  if (!isUuid(memoId)) throw new AppError("That memo could not be found.");

  const draft = await withSession(session, async (tx: Queryable) => {
    const { rows } = await tx.query<DraftRow>(
      "select content, opportunity_id from memos where memo_id = $1 and status = 'draft'", [memoId]);
    return rows[0] ?? null;
  });
  if (!draft) throw new AppError("Only a draft memo can be finalised.");

  const refs = liveRefsIn(draft.content);
  const frozen: Partial<Record<FrozenSlot, string>> = {};
  for (const ref of refs) frozen[ref.slot] = await copyOne(session, memoId, draft.opportunity_id, ref);

  await withSession(session, async (tx: Queryable) => {
    if (refs.length > 0) {
      // Lock the row and make sure it is still the draft we copied from: a recompose in
      // between would have swapped the pictures, and the copy would be of the wrong ones.
      const { rows } = await tx.query<{ content: Record<string, unknown> }>(
        "select content from memos where memo_id = $1 and status = 'draft' for update", [memoId]);
      if (!rows[0]) throw new AppError("Only a draft memo can be finalised.");
      const now = liveRefsIn(rows[0].content);
      const same = now.length === refs.length && refs.every((r) => now.some((n) => n.slot === r.slot && n.photoId === r.photoId));
      if (!same) throw new AppError("This draft changed while it was being finalised. Nothing was locked: try again.");
      const next = freezeSnapshotContent(rows[0].content, frozen);
      const done = await tx.query(
        "update memos set content = $2::jsonb where memo_id = $1 and status = 'draft' returning memo_id",
        [memoId, JSON.stringify(next)]);
      if (done.rows.length === 0) throw new AppError("Only a draft memo can be finalised.");
    }
    const { rows } = await tx.query(
      `update memos set status = 'final', finalized_by = $2, finalized_at = now()
        where memo_id = $1 and status = 'draft' returning memo_id`, [memoId, session.userId]);
    if (rows.length === 0) throw new AppError("Only a draft memo can be finalised.");
  });
}

/**
 * A signed URL for a FROZEN picture of a memo, or null. The path comes from the memo
 * row, read as this caller (RLS decides the memo is theirs), never from the request;
 * it must sit under this memo's own folder; and a slot that is still live resolves to
 * nothing here (a live picture is served by the photograph route, not this one).
 */
export async function issueMemoAssetDownload(
  session: Session, memoId: string, slot: SnapshotSlot,
): Promise<string | null> {
  if (!isUuid(memoId)) return null;
  if (!mayReadPhoto(session.role, "diligence")) return null;
  const row = await withSession(session, async (tx: Queryable) => {
    const { rows } = await tx.query<{ source: string | null; path: string | null }>(
      `select content #>> array['snapshot', $2::text, 'source'] as source,
              content #>> array['snapshot', $2::text, 'path'] as path
         from memos where memo_id = $1`, [memoId, slot]);
    return rows[0] ?? null;
  });
  if (!row || row.source !== "frozen" || !isFrozenPathOf(memoId, row.path)) return null;
  return signMemoAsset(row.path);
}
