// ============================================================================
// Taking a deal off the pipeline, and putting it back.
// ----------------------------------------------------------------------------
// Removal ARCHIVES: status becomes an outcome (withdrawn, lost or rejected), archived_at is stamped,
// and the deal moves from the board to the Archived list. Nothing is deleted. Why, by whom and when
// is kept in two places: source_facts._removal (so it is there even for a deal with no property) and,
// where the deal has a property, an event on the property's timeline (sold, withdrawn, passed).
//
// Runs under the caller's session, so row level security decides who may write. Only an ACTIVE deal
// can be removed, and only a removed one (rejected, withdrawn, lost) restored: a converted deal has
// an asset, and a merged one is a duplicate, and neither is this function's to move.
// ============================================================================
import { withSession, type Session } from "@/lib/db/client";
import { AppError } from "@/lib/errors";
import { recordEvent } from "@/lib/data/property-events";
import {
  REMOVAL_REASONS, REMOVABLE_FROM, RESTORABLE_FROM, isRemovalReason, cleanNote, type RemovedStatus,
} from "@/lib/pipeline/removal";

const NOT_YOURS = "That deal could not be found, or you cannot change it.";

export async function removeFromPipeline(
  session: Session, opportunityId: string, reason: unknown, note: unknown,
): Promise<{ status: RemovedStatus }> {
  if (!isRemovalReason(reason)) throw new AppError("Choose why the deal is coming off the pipeline.");
  const def = REMOVAL_REASONS[reason];
  const n = cleanNote(note);
  return withSession(session, async (tx) => {
    const cur = await tx.query<{ org_id: string; status: string; property_id: string | null; name: string }>(
      "select org_id, status, property_id, name from opportunities where opportunity_id = $1 for update", [opportunityId]);
    const o = cur.rows[0];
    if (!o) throw new AppError(NOT_YOURS);
    if (!REMOVABLE_FROM.includes(o.status)) {
      throw new AppError(o.status === "converted"
        ? "This deal has been converted to an asset and cannot be taken off the pipeline."
        : "This deal is already off the pipeline.");
    }
    const done = await tx.query(
      `update opportunities
          set status = $2, archived_at = now(),
              source_facts = source_facts || jsonb_build_object('_removal',
                jsonb_build_object('reason', $3::text, 'note', $4::text, 'at', now(), 'by', $5::text))
        where opportunity_id = $1 and status = 'active'
        returning opportunity_id`,
      [opportunityId, def.status, reason, n, session.userId]);
    if (done.rows.length === 0) throw new AppError(NOT_YOURS);
    if (def.event && o.property_id) {
      await recordEvent(tx, {
        orgId: o.org_id, propertyId: o.property_id, opportunityId, eventType: def.event,
        headline: def.headline, detail: n, sourceKind: "reiwa_manual", createdBy: session.userId,
      });
    }
    return { status: def.status };
  });
}

export async function restoreToPipeline(session: Session, opportunityId: string): Promise<void> {
  await withSession(session, async (tx) => {
    const cur = await tx.query<{ org_id: string; status: string; property_id: string | null }>(
      "select org_id, status, property_id from opportunities where opportunity_id = $1 for update", [opportunityId]);
    const o = cur.rows[0];
    if (!o) throw new AppError(NOT_YOURS);
    if (!RESTORABLE_FROM.includes(o.status)) throw new AppError("Only a deal that was taken off the pipeline can be restored.");
    const done = await tx.query(
      `update opportunities set status = 'active', archived_at = null, source_facts = source_facts - '_removal'
        where opportunity_id = $1 and status = any($2::text[]) returning opportunity_id`,
      [opportunityId, [...RESTORABLE_FROM]]);
    if (done.rows.length === 0) throw new AppError(NOT_YOURS);
    if (o.property_id) {
      await recordEvent(tx, {
        orgId: o.org_id, propertyId: o.property_id, opportunityId, eventType: "relaunched",
        headline: "Restored to the pipeline", detail: null, sourceKind: "reiwa_manual", createdBy: session.userId,
      });
    }
  });
}
