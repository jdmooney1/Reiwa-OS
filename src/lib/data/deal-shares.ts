// ============================================================================
// Deal shares - the ADMIN side (RLS-gated). Create, list, revoke.
// ----------------------------------------------------------------------------
// Everything here runs inside withSession() under the admin's own claims, so the
// database (migration 0029: admin-only policies, revoked_at the only updatable column)
// is the real gate. The other half - a prospect opening a link, with no session at all -
// is src/lib/data/deal-share-access.ts, and nothing is shared between the two files.
//
// Only the SHA-256 hash of a token is ever written. createDealShare() returns the RAW
// token once, to the caller, and never logs it.
//
// A memo is a VERSION, and the Snapshot and the Teaser are two renderings of it, so a
// share names a final memo for each document it covers. Creation refuses unless every
// named memo belongs to this opportunity, is FINAL, and (for the Snapshot) actually
// carries a composed snapshot, the same discipline as finalising a Snapshot with a
// missing picture: the message says what to do first.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { staffNamesOn, nameOf } from "@/lib/data/directory";
import { mintShareToken } from "@/lib/deal-share/token";
import { shareState, type ShareInput, type ShareState } from "@/lib/deal-share/policy";

const NEEDS_FINAL = "Finalise the memo first: only a finalised version can be shared with a prospect.";
const NEEDS_SNAPSHOT_FINAL = "There is no finalised Asset Snapshot for this opportunity yet. Finalise the memo first.";

export interface ShareableMemo {
  memoId: string;
  version: number;
  finalizedAt: string;
  /** Whether this version carries an Asset Snapshot (versions composed before it existed do not). */
  hasSnapshot: boolean;
  /** A Snapshot finalised before pictures were frozen still points at live photographs, which a prospect cannot be shown. */
  snapshotPicturesLive: boolean;
}

/** Every FINAL memo version of an opportunity, newest first: what a share can be made from. */
export async function listShareableMemos(session: Session, opportunityId: string): Promise<ShareableMemo[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, any>>(
      `select memo_id, version, finalized_at,
              jsonb_typeof(content -> 'snapshot') = 'object' as has_snapshot,
              (content #>> '{snapshot,photo,source}' = 'live' or content #>> '{snapshot,map,source}' = 'live'
               or content #> '{snapshot,photoId}' is not null) as live
         from memos
        where opportunity_id = $1 and status = 'final'
        order by version desc`, [opportunityId]);
    return rows.map((r) => ({
      memoId: r.memo_id, version: Number(r.version), finalizedAt: new Date(r.finalized_at).toISOString(),
      hasSnapshot: Boolean(r.has_snapshot), snapshotPicturesLive: Boolean(r.live),
    }));
  });
}

async function requireFinalMemo(
  tx: Queryable, memoId: string, opportunityId: string, needsSnapshot: boolean,
): Promise<void> {
  const { rows } = await tx.query<{ status: string; has_snapshot: boolean }>(
    `select status, jsonb_typeof(content -> 'snapshot') = 'object' as has_snapshot
       from memos where memo_id = $1 and opportunity_id = $2`, [memoId, opportunityId]);
  const m = rows[0];
  if (!m) throw new AppError("That memo does not belong to this opportunity.");
  if (m.status !== "final") throw new AppError(NEEDS_FINAL);
  if (needsSnapshot && !m.has_snapshot) throw new AppError(NEEDS_SNAPSHOT_FINAL);
}

export interface CreatedShare { shareId: string; rawToken: string; expiresAt: string }

/** Mint a share. The RAW token is returned once and is not stored anywhere. */
export async function createDealShare(
  session: Session, actorUserId: string, opportunityId: string, input: ShareInput,
): Promise<CreatedShare> {
  const { rawToken, tokenHash } = mintShareToken();
  return withSession(session, async (tx) => {
    const opp = await tx.query("select 1 from opportunities where opportunity_id = $1", [opportunityId]);
    if (opp.rows.length === 0) throw new AppError("That opportunity could not be found.");
    if (input.snapshotMemoId) await requireFinalMemo(tx, input.snapshotMemoId, opportunityId, true);
    if (input.teaserMemoId) await requireFinalMemo(tx, input.teaserMemoId, opportunityId, false);
    const { rows } = await tx.query<{ share_id: string; expires_at: string }>(
      `insert into deal_shares(opportunity_id, snapshot_memo_id, teaser_memo_id, prospect_name, prospect_email,
                               token_hash, expires_at, created_by)
       values ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7), $8)
       returning share_id, expires_at`,
      [opportunityId, input.snapshotMemoId, input.teaserMemoId, input.prospectName, input.prospectEmail,
       tokenHash, input.ttlDays, actorUserId]);
    return { shareId: rows[0].share_id, rawToken, expiresAt: new Date(rows[0].expires_at).toISOString() };
  });
}

export interface DealShareRow {
  shareId: string;
  opportunityId: string;
  opportunityName: string;
  prospectName: string;
  prospectEmail: string;
  snapshotVersion: number | null;
  teaserVersion: number | null;
  state: ShareState;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  viewCount: number;
  lastViewedAt: string | null;
}

/** Shares newest first, with how often and when they were last opened. Never a token or a hash. */
export async function listDealShares(
  session: Session, filter: { opportunityId?: string } = {},
): Promise<DealShareRow[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, any>>(
      `select s.share_id, s.opportunity_id, o.name as opportunity_name, s.prospect_name, s.prospect_email,
              sm.version as snapshot_version, tm.version as teaser_version,
              s.expires_at, s.revoked_at, s.created_at, s.created_by,
              v.n as view_count, v.last_at
         from deal_shares s
         join opportunities o on o.opportunity_id = s.opportunity_id
         left join memos sm on sm.memo_id = s.snapshot_memo_id
         left join memos tm on tm.memo_id = s.teaser_memo_id
         left join lateral (select count(*)::int as n, max(viewed_at) as last_at
                              from deal_share_views w where w.share_id = s.share_id) v on true
        where ($1::uuid is null or s.opportunity_id = $1)
        order by s.created_at desc`, [filter.opportunityId ?? null]);
    const directory = await staffNamesOn(tx, rows.map((r) => r.created_by));
    return rows.map((r) => ({
      shareId: r.share_id, opportunityId: r.opportunity_id, opportunityName: r.opportunity_name,
      prospectName: r.prospect_name, prospectEmail: r.prospect_email,
      snapshotVersion: r.snapshot_version === null ? null : Number(r.snapshot_version),
      teaserVersion: r.teaser_version === null ? null : Number(r.teaser_version),
      state: shareState({ expiresAt: r.expires_at, revokedAt: r.revoked_at }),
      expiresAt: new Date(r.expires_at).toISOString(),
      revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(), createdByName: nameOf(directory, r.created_by ?? null),
      viewCount: Number(r.view_count), lastViewedAt: r.last_at ? new Date(r.last_at).toISOString() : null,
    }));
  });
}

/** Revoke now. The link stops working on its next use; nothing already seen is undone. */
export async function revokeDealShare(session: Session, shareId: string): Promise<void> {
  await withSession(session, (tx) =>
    tx.query("update deal_shares set revoked_at = now() where share_id = $1 and revoked_at is null", [shareId]));
}

export interface ShareableOpportunity { opportunityId: string; name: string; finalVersions: number }

/** Opportunities with at least one final memo: the only ones a share can be made for. */
export async function listShareableOpportunities(session: Session): Promise<ShareableOpportunity[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, any>>(
      `select o.opportunity_id, o.name, count(m.memo_id)::int as n
         from opportunities o join memos m on m.opportunity_id = o.opportunity_id and m.status = 'final'
        group by o.opportunity_id, o.name order by o.name`);
    return rows.map((r) => ({ opportunityId: r.opportunity_id, name: r.name, finalVersions: Number(r.n) }));
  });
}

/** One opportunity's name, for the form's heading. */
export async function opportunityName(session: Session, opportunityId: string): Promise<string | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{ name: string }>("select name from opportunities where opportunity_id = $1", [opportunityId]);
    return rows[0]?.name ?? null;
  });
}
