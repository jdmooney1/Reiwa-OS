// ============================================================================
// Deal shares - the PROSPECT side. No session, no account, no role.
// ----------------------------------------------------------------------------
// A prospect has no database identity at all, so this runs on the privileged
// connection, exactly as validating an invitation token does for sign-in (P3). That makes
// THIS FILE the boundary, so it is kept small and tested as one (tests/unit/
// deal-share-boundaries.test.ts):
//
//   it READS    deal_shares and memos, and nothing else
//   it WRITES   one row into deal_share_views per successful open, and nothing else
//
// It never reads opportunities, investment_cases, property_photos, photographs'
// metadata or any live table, and it composes nothing: it hands back what was frozen at
// finalisation.
//
// EVERY REFUSAL IS THE SAME REFUSAL. A wrong token, an expired share, a revoked one, a
// memo that is no longer final: the caller gets `null` and cannot tell which. The token is
// matched by hash, then compared again in constant time (verifyShareToken), and any doubt
// fails closed. The raw token is never logged, never stored, and never put in an error.
// ============================================================================
import { adminQuery } from "@/lib/db/client";
import { looksLikeShareToken, hashShareToken, verifyShareToken } from "@/lib/deal-share/token";
import { prospectSnapshot, prospectTeaser, type ProspectDocument } from "@/lib/deal-share/document";
import { isFrozenPathOf } from "@/lib/memo/assets";
import { signMemoAsset } from "@/lib/memo/assets-store";
import { isSnapshotSlot, type SnapshotSlot } from "@/lib/memo/snapshot-images";

interface ShareRow {
  share_id: string;
  token_hash: string;
  prospect_name: string;
  snapshot_memo_id: string | null;
  teaser_memo_id: string | null;
  snapshot_content: unknown;
  teaser_content: unknown;
  teaser_overrides: unknown;
  teaser_finalized_at: string | null;
}

/**
 * The share a raw token opens right now, or null. Every condition is checked here, in one
 * statement: the hash, not revoked, not expired, and EACH memo the share names must still
 * exist, still belong to the share's opportunity, and still be final.
 */
async function openShare(rawToken: unknown): Promise<ShareRow | null> {
  if (!looksLikeShareToken(rawToken)) return null;
  const hash = hashShareToken(rawToken);
  const rows = await adminQuery<ShareRow>(
    `select s.share_id, s.token_hash, s.prospect_name, s.snapshot_memo_id, s.teaser_memo_id,
            sm.content as snapshot_content,
            tm.content as teaser_content, tm.overrides as teaser_overrides, tm.finalized_at as teaser_finalized_at
       from deal_shares s
       left join memos sm on sm.memo_id = s.snapshot_memo_id
                         and sm.opportunity_id = s.opportunity_id and sm.status = 'final'
       left join memos tm on tm.memo_id = s.teaser_memo_id
                         and tm.opportunity_id = s.opportunity_id and tm.status = 'final'
      where s.token_hash = $1
        and s.revoked_at is null
        and s.expires_at > now()
        and (s.snapshot_memo_id is null or sm.memo_id is not null)
        and (s.teaser_memo_id is null or tm.memo_id is not null)`,
    [hash]);
  const row = rows[0];
  // The index matched on the hash; this is the constant-time check the credential deserves.
  if (!row || !verifyShareToken(rawToken, row.token_hash)) return null;
  return row;
}

export interface ProspectView extends ProspectDocument {
  shareId: string;
  prospectName: string;
  /** The snapshot memo's id: the frozen pictures sit under it. */
  snapshotMemoId: string | null;
}

/**
 * A prospect opens their link: validate, record the view, return the two frozen
 * documents. `null` for every kind of refusal, and nothing is recorded for one.
 */
export async function openProspectShare(rawToken: unknown): Promise<ProspectView | null> {
  const row = await openShare(rawToken);
  if (!row) return null;

  const snapshot = row.snapshot_memo_id ? prospectSnapshot(row.snapshot_content) : null;
  const teaser = row.teaser_memo_id
    ? prospectTeaser(row.teaser_content, row.teaser_overrides, row.teaser_finalized_at ? new Date(row.teaser_finalized_at).toISOString() : null)
    : null;
  // A share whose document cannot be drawn is a share that shows nothing: refuse it like any other.
  if ((row.snapshot_memo_id && !snapshot) || (row.teaser_memo_id && !teaser)) return null;

  // Recorded only if the share is STILL live at this instant, so a revocation that lands
  // between the read and the write is honoured and leaves no view behind.
  const recorded = await adminQuery<{ view_id: string }>(
    `insert into deal_share_views(share_id)
     select share_id from deal_shares where share_id = $1 and revoked_at is null and expires_at > now()
     returning view_id`, [row.share_id]);
  if (recorded.length === 0) return null;

  return {
    shareId: row.share_id, prospectName: row.prospect_name, snapshot, teaser,
    snapshotMemoId: row.snapshot_memo_id,
  };
}

/**
 * A signed, sixty-second URL for one frozen Snapshot picture of the share the token opens,
 * or null. Reads the path from the memo row and signs it only if it sits under that memo's
 * own folder. Records no view: the page already did.
 */
export async function frozenPictureForShare(rawToken: unknown, slot: unknown): Promise<string | null> {
  if (!isSnapshotSlot(slot)) return null;
  const row = await openShare(rawToken);
  if (!row || !row.snapshot_memo_id) return null;
  const snap = (row.snapshot_content as { snapshot?: Record<string, { source?: string; path?: string } | null> } | null)?.snapshot;
  const pic = snap?.[slot as SnapshotSlot];
  if (!pic || pic.source !== "frozen" || !isFrozenPathOf(row.snapshot_memo_id, pic.path)) return null;
  return signMemoAsset(pic.path);
}
