// ============================================================================
// Which investors may be shown a property's photographs. Pure.
// ----------------------------------------------------------------------------
// The rule is enforced in the DATABASE first (migration 0020): the functions
// behind investor_feed.headline_photo_id and the gallery return a photo only when
// staff have marked THAT photo `diligence` and the investor's own entitlement to
// the publication is at the diligence tier. Anything else arrives as nothing.
//
// This is the SECOND lock, in the application, so the rule does not rest on a
// single layer: a row is turned into photographs only if it is diligence-tier.
// If a database function were ever loosened by mistake, a standard-tier row would
// still come out of here as nothing - and vice versa, a mistake here alone
// exposes nothing, because the database has already returned no rows.
//
// The tier is read from the row's own document_access_level, never from a
// parameter, a cookie or anything the client sends. Same shape as location.ts.
// ============================================================================

/** The tier at which photographs are shown: the same one the location pin uses. */
export const PHOTO_TIER = "diligence";

export interface PortalPhoto { photoId: string; caption: string | null }

export function visiblePhotos(row: {
  documentAccessLevel: string;
  photos: { photoId: string; caption: string | null }[];
}): { photoId: string; caption: string | null }[] {
  return row.documentAccessLevel === PHOTO_TIER ? row.photos : [];
}

/** The teaser photo's id, or null: only a diligence-tier row carries one through. */
export function visibleHeadlinePhoto(row: {
  documentAccessLevel: string;
  headlinePhotoId: string | null;
}): string | null {
  return row.documentAccessLevel === PHOTO_TIER ? row.headlinePhotoId : null;
}
