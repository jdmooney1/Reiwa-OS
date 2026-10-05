// ============================================================================
// Asset photographs - the register in `property_photos` (migration 0019).
// ----------------------------------------------------------------------------
// Every call runs under withSession, so RLS enforces organisation scope and
// write permission. Nothing returned to a caller contains an object path: a
// photograph is opened by presenting its id to /api/asset-photos/<id>.
//
// A photograph belongs to a PROPERTY, not an opportunity: the same building
// recurring in the pipeline (see resolveProperty) keeps its pictures.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { staffNamesOn, nameOf } from "@/lib/data/directory";
import { AppError } from "@/lib/errors";
import {
  DEFAULT_PHOTO_VISIBILITY, isPhotoVisibility, type PhotoVisibility, type PhotoKind,
} from "@/lib/photos/constraints";

export interface PropertyPhoto {
  photoId: string;
  propertyId: string;
  kind: PhotoKind;
  isHeadline: boolean;
  sortOrder: number;
  caption: string | null;
  visibility: PhotoVisibility;
  uploadedByName: string | null;
  createdAt: string;
}

/**
 * Headline first, then the gallery in the order staff arranged it. `kind` says which
 * pictures: the building gallery by default, or the property's maps. The two are
 * never mixed in one list, so a map cannot turn up in a gallery.
 */
export async function listPropertyPhotos(
  session: Session, propertyId: string, kind: PhotoKind = "building",
): Promise<PropertyPhoto[]> {
  return withSession(session, async (tx: Queryable) => {
    const { rows } = await tx.query<Record<string, any>>(
      `select photo_id, property_id, kind, is_headline, sort_order, caption, visibility,
              uploaded_by, created_at
         from property_photos
        where property_id = $1 and kind = $2
        order by is_headline desc, sort_order, created_at, photo_id`,
      [propertyId, kind]);
    const directory = await staffNamesOn(tx, rows.map((r) => r.uploaded_by));
    return rows.map((r) => ({
      photoId: r.photo_id, propertyId: r.property_id, kind: r.kind as PhotoKind, isHeadline: r.is_headline === true,
      sortOrder: Number(r.sort_order), caption: r.caption ?? null,
      visibility: r.visibility as PhotoVisibility,
      uploadedByName: nameOf(directory, r.uploaded_by ?? null),
      createdAt: new Date(r.created_at).toISOString(),
    }));
  });
}

/** The organisation a property sits in, or null when this caller cannot see it. */
export async function propertyOrgFor(session: Session, propertyId: string): Promise<string | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{ org_id: string }>(
      "select org_id from properties where property_id = $1", [propertyId]);
    return rows[0]?.org_id ?? null;
  });
}

/**
 * Register a stored object. Visibility is NOT a parameter: every photograph
 * starts `internal` and is only widened afterwards, by a person, on purpose.
 *
 * `asHeadline` demotes the existing headline into the gallery in the same
 * transaction and BEFORE the insert, because the partial unique index
 * (property_photos_one_headline) checks immediately.
 */
export async function recordPhoto(
  session: Session,
  input: { propertyId: string; objectPath: string; mimeType: string; asHeadline: boolean; kind?: PhotoKind },
): Promise<string> {
  const kind: PhotoKind = input.kind ?? "building";
  // A map is never a headline (a CHECK says so too); asking for one is ignored, not an error.
  const asHeadline = kind === "building" && input.asHeadline;
  return withSession(session, async (tx) => {
    const prop = await tx.query<{ org_id: string }>(
      "select org_id from properties where property_id = $1", [input.propertyId]);
    if (!prop.rows[0]) throw new AppError("That property could not be found.");

    if (asHeadline) {
      await tx.query(
        "update property_photos set is_headline = false where property_id = $1 and is_headline",
        [input.propertyId]);
    }
    const { rows } = await tx.query<{ photo_id: string }>(
      `insert into property_photos
         (org_id, property_id, object_path, mime_type, is_headline, sort_order, visibility, uploaded_by, kind)
       values ($1, $2, $3, $4, $5,
               (select coalesce(max(sort_order), 0) + 1 from property_photos where property_id = $2),
               $6, $7, $8)
       returning photo_id`,
      [prop.rows[0].org_id, input.propertyId, input.objectPath, input.mimeType,
       asHeadline, DEFAULT_PHOTO_VISIBILITY, session.userId, kind]);
    return rows[0].photo_id;
  });
}

/**
 * Make this photograph the headline; the previous one drops into the gallery.
 * Scoped to the property in the WHERE clause, so a photograph of any other
 * property is simply not found.
 */
export async function setHeadline(session: Session, propertyId: string, photoId: string): Promise<void> {
  await withSession(session, async (tx) => {
    const found = await tx.query(
      "select 1 from property_photos where photo_id = $1 and property_id = $2 and kind = 'building'", [photoId, propertyId]);
    if (found.rows.length === 0) throw new AppError("That photograph could not be found.");
    await tx.query(
      "update property_photos set is_headline = false where property_id = $1 and is_headline and photo_id <> $2",
      [propertyId, photoId]);
    await tx.query("update property_photos set is_headline = true where photo_id = $1", [photoId]);
  });
}

export async function setPhotoVisibility(
  session: Session, propertyId: string, photoId: string, visibility: string,
): Promise<void> {
  if (!isPhotoVisibility(visibility)) throw new AppError("That is not a valid visibility.");
  await withSession(session, async (tx) => {
    const { rows } = await tx.query(
      `update property_photos set visibility = $3
        where photo_id = $1 and property_id = $2 returning photo_id`,
      [photoId, propertyId, visibility]);
    if (rows.length === 0) throw new AppError("That photograph could not be found.");
  });
}

/**
 * Re-number the gallery. Only photographs of this property, as RLS shows them,
 * are touched; an id that is not one of them is refused rather than skipped.
 */
export async function reorderPhotos(
  session: Session, propertyId: string, orderedIds: string[],
): Promise<void> {
  await withSession(session, async (tx) => {
    const { rows } = await tx.query<{ photo_id: string }>(
      "select photo_id from property_photos where property_id = $1 and kind = 'building'", [propertyId]);
    const known = new Set(rows.map((r) => r.photo_id));
    if (new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !known.has(id))) {
      throw new AppError("That order includes a photograph that is not part of this property.");
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.query("update property_photos set sort_order = $2 where photo_id = $1", [orderedIds[i], i + 1]);
    }
  });
}

/** Delete the row and report where its object was, so the caller can remove it too. */
export async function deletePhotoRow(
  session: Session, propertyId: string, photoId: string,
): Promise<{ objectPath: string } | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{ object_path: string }>(
      "delete from property_photos where photo_id = $1 and property_id = $2 returning object_path",
      [photoId, propertyId]);
    return rows[0] ? { objectPath: rows[0].object_path } : null;
  });
}
