// ============================================================================
// The property facts only the One-Page Asset Snapshot may carry.
// ----------------------------------------------------------------------------
// Kept out of src/lib/data/memos.ts on purpose. That file builds the sources for
// the seventeen prose sections and is held, by tests/unit/memo-boundaries.test.ts,
// to naming no address and no photograph. The Snapshot is the one document that
// carries both (decision: JD, Asset Snapshot brief), so the two reads live here,
// where the exception is visible and the boundary test can see it is one file.
//
// The photograph follows the investor teaser card's rule (migration 0020): of the
// photos staff have explicitly cleared as `diligence`, the first by headline, then
// gallery order. A photograph still marked `internal` is never used, whatever its
// position: nothing is shown outside until a human has cleared it.
//
// Runs under withSession like everything else, so RLS decides what the caller sees.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import type { MemoAssetFacts } from "@/lib/memo/compose";

const clean = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
};

/** Street, city and postcode as recorded, comma-separated. Null without a street address. */
export function joinAddress(address: unknown, city: unknown, postcode: unknown): string | null {
  const street = clean(address);
  if (!street) return null;
  return [street, clean(city), clean(postcode)].filter((x): x is string => x !== null).join(", ");
}

export async function loadSnapshotAsset(session: Session, opportunityId: string): Promise<MemoAssetFacts> {
  return withSession(session, async (tx: Queryable) => {
    const { rows } = await tx.query<{ reference: string | null; address: string | null; city: string | null; postcode: string | null; photo_id: string | null }>(
      `select o.reference, p.address, p.city, p.postcode,
              (select pp.photo_id
                 from property_photos pp
                where pp.property_id = o.property_id and pp.visibility = 'diligence'
                order by pp.is_headline desc, pp.sort_order, pp.created_at, pp.photo_id
                limit 1) as photo_id
         from opportunities o
         left join properties p on p.property_id = o.property_id
        where o.opportunity_id = $1`, [opportunityId]);
    const r = rows[0];
    return {
      reference: clean(r?.reference),
      addressLine: joinAddress(r?.address, r?.city, r?.postcode),
      photoId: r?.photo_id ?? null,
    };
  });
}
