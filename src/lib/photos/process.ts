// ============================================================================
// Server-side re-encode of every uploaded photograph. SERVER-ONLY.
// ----------------------------------------------------------------------------
// This is the CONTROL that removes metadata. The browser's own re-encode
// (client.ts) only keeps uploads small: a client can be bypassed, so nothing
// here trusts it.
//
// It runs on every upload, always, before any object or row exists, whatever
// visibility the photo ends up at. One path that is always on cannot be
// forgotten for the one photo that mattered.
//
//   1. rotate()   bakes the EXIF orientation into the pixels BEFORE the tag that
//                 carries it is discarded, so a phone photo taken on its side
//                 is still upright.
//   2. resize     longest edge at most FULL_EDGE, never enlarged. Normal
//                 uploads (already shrunk by the browser) pass through unscaled.
//   3. jpeg()     WITHOUT withMetadata(): sharp then writes none of the input's
//                 EXIF (GPS included), XMP, IPTC, ICC profile or thumbnail.
//   4. a second, THUMB_EDGE rendition for lists and the pipeline board.
//
// Transparency is flattened onto white, as the browser does, since JPEG has no
// alpha and black would be the default.
// ============================================================================
import sharp from "sharp";
import { FULL_EDGE, THUMB_EDGE } from "@/lib/photos/constraints";

export interface ProcessedPhoto {
  /** Re-encoded JPEG, metadata-free, longest edge <= FULL_EDGE. */
  full: Buffer;
  /** Re-encoded JPEG, metadata-free, longest edge <= THUMB_EDGE. */
  thumb: Buffer;
}

const JPEG = { quality: 85, mozjpeg: true } as const;

/**
 * Throws when sharp cannot decode the bytes, for example a file whose header
 * looked like an image (it passed checkPhoto) but whose body is not. The caller
 * turns that into a sentence for the person.
 */
export async function reencodePhoto(bytes: Uint8Array): Promise<ProcessedPhoto> {
  // A decompression-bomb ceiling well above any camera (100 MP), so a small file
  // that declares an enormous canvas cannot exhaust memory.
  const base = sharp(bytes, { failOn: "error", limitInputPixels: 100_000_000 })
    .rotate()
    .flatten({ background: "#ffffff" });

  const [full, thumb] = await Promise.all([
    base.clone()
      .resize({ width: FULL_EDGE, height: FULL_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg(JPEG).toBuffer(),
    base.clone()
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg(JPEG).toBuffer(),
  ]);
  return { full, thumb };
}
