// The asset-photo contract, shared by server and client code.
//
// Imports nothing, for the reason documents/constraints.ts gives: the gallery is
// a client component and needs the accepted types, so anything imported here
// would be pulled into the browser bundle with them - the Supabase admin client
// and the secret key it reads included. Keep it free of imports.

/** The one private bucket for asset photos. Never public. */
export const PHOTO_BUCKET = "property-photos";

/** Same lifetime as a document link: a copied URL is already dead. */
export const PHOTO_SIGNED_URL_TTL_SECONDS = 60;

/** Hard ceiling on one photograph. A phone's original is usually 3-8 MB. */
export const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

/** How many photographs one upload may carry; the rest are refused up front. */
export const MAX_PHOTOS_PER_UPLOAD = 20;

/**
 * What is accepted, and the extension each is stored under. The extension comes
 * from THIS map, never from the file name. SVG is absent on purpose: it is a
 * document that can carry script, not a picture.
 */
export const ALLOWED_PHOTO_TYPES: Readonly<Record<string, string>> = Object.freeze({
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
});

/** What every stored photograph is, whatever was uploaded: the server re-encodes to JPEG. */
export const STORED_PHOTO_TYPE = "image/jpeg";

/** The longest edge of the stored full-size image and of its thumbnail, in pixels. */
export const FULL_EDGE = 2400;
export const THUMB_EDGE = 480;

/** The thumbnail's path, deterministically derived from the full image's. */
export function thumbPathFor(objectPath: string): string {
  return objectPath.replace(/(\.[a-z0-9]+)$/i, "-thumb$1");
}

export const PHOTO_ACCEPT = Object.keys(ALLOWED_PHOTO_TYPES).join(",");

/**
 * Who may be shown a photo. Deliberately NOT the document vocabulary: there is
 * no `standard`. An off-market building's exterior can identify it as surely as
 * its address, so a photo is never more exposed than the location pin, which is
 * diligence-tier only. The database check (migration 0019) says the same.
 */
export type PhotoVisibility = "internal" | "diligence";
export const PHOTO_VISIBILITIES: readonly PhotoVisibility[] = ["internal", "diligence"];

/** What a new photograph is until someone decides otherwise. */
export const DEFAULT_PHOTO_VISIBILITY: PhotoVisibility = "internal";

export const isPhotoVisibility = (v: unknown): v is PhotoVisibility =>
  typeof v === "string" && (PHOTO_VISIBILITIES as readonly string[]).includes(v);

export type PhotoCheck =
  | { ok: true; mimeType: string; sizeBytes: number }
  | { ok: false; reason: string };

/**
 * The type the BYTES say they are, from their first few bytes, or null. The
 * browser's claim is a convenience; this is what decides, so an HTML page or a
 * script renamed to .jpg is refused rather than stored under an image type.
 */
export function sniffImageType(head: Uint8Array): string | null {
  const b = head;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
    && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  // RIFF....WEBP
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/**
 * Validate one photograph before a byte is stored. Pure and synchronous, so the
 * rule is asserted in a test with no network. Runs on what the server received:
 * the declared type must be allowed AND the bytes must agree with it.
 */
export function checkPhoto(declaredType: string, sizeBytes: number, head: Uint8Array): PhotoCheck {
  const declared = (declaredType ?? "").trim().toLowerCase().split(";")[0];
  if (!declared) return { ok: false, reason: "The file type could not be determined." };
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_PHOTO_TYPES, declared)) {
    return { ok: false, reason: `Only JPEG, PNG and WebP photographs can be uploaded; this is ${declared}.` };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, reason: "The file is empty." };
  }
  if (sizeBytes > MAX_PHOTO_BYTES) {
    const mb = Math.round(MAX_PHOTO_BYTES / (1024 * 1024));
    return { ok: false, reason: `The photograph is larger than the ${mb} MB limit.` };
  }
  const actual = sniffImageType(head);
  if (!actual) return { ok: false, reason: "The file is not a JPEG, PNG or WebP image." };
  if (actual !== declared) {
    return { ok: false, reason: `The file says it is ${declared} but its contents are ${actual}.` };
  }
  return { ok: true, mimeType: actual, sizeBytes };
}
