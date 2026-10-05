// ============================================================================
// Browser-side helpers for the photo gallery. Imports nothing from the server.
// ----------------------------------------------------------------------------
// A phone original is 3-8 MB and the platform caps a request body at about
// 4.5 MB, so each photograph is shrunk BEFORE it is sent: longest edge at most
// MAX_EDGE, re-encoded as JPEG. Re-encoding through a canvas also drops the
// EXIF block, GPS position included - a deliberate side effect for an
// off-market asset.
//
// This is a convenience, never a control. The server validates what it receives
// regardless (lib/photos/constraints.ts) and re-encodes every photograph itself
// (lib/photos/process.ts), which is what actually removes metadata.
// ============================================================================

export const MAX_EDGE = 2400;
/** What the browser aims to send. Comfortably under the platform's ceiling. */
export const TARGET_BYTES = 3.5 * 1024 * 1024;

/** The size to draw at: the longest edge capped at `max`, never enlarged. */
export function fitWithin(width: number, height: number, max = MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** `ids` with the item at `from` moved to index `to`. A no-op for nonsense indices. */
export function moveItem<T>(ids: readonly T[], from: number, to: number): T[] {
  const out = [...ids];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

/** Shrink and re-encode one image. Rejects with a sentence fit to show. */
export async function shrinkImage(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name}: this browser could not read the image. Use a JPEG, PNG or WebP.`);
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(`${file.name}: could not prepare the image.`);
  // JPEG has no alpha: paint white first so a transparent PNG is not black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  for (const quality of [0.85, 0.7, 0.55]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (blob && blob.size <= TARGET_BYTES) {
      const base = file.name.replace(/\.[^.]+$/, "") || "photo";
      return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
    }
  }
  throw new Error(`${file.name}: still too large after shrinking. Try a smaller image.`);
}
