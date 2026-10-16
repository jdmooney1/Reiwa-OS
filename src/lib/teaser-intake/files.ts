// ============================================================================
// Teaser intake file rules. PURE and client-safe (imports nothing), so the drop
// zone and the server apply the same types and the same size ceiling, and the
// path and signature checks can be tested without storage.
// ============================================================================

/** What a teaser may be: a PDF, or a screenshot / scan of one. */
export const INTAKE_TYPES = ["application/pdf", "image/png", "image/jpeg"] as const;
export type IntakeType = (typeof INTAKE_TYPES)[number];

/** The `accept` attribute for the drop zone: a convenience, not a control. */
export const INTAKE_ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

/**
 * The reader takes a request of up to 32 MB, and a file grows by a third when
 * it is encoded for it. Teasers are a few MB; a full IM that is larger than
 * this is better read from its teaser pages.
 */
export const MAX_INTAKE_BYTES = 22 * 1024 * 1024;

export function isIntakeType(t: string): t is IntakeType {
  return (INTAKE_TYPES as readonly string[]).includes(t);
}

/** A declared type, normalised; "" when the browser gave none it could name. */
export function declaredIntakeType(fileName: string, mime: string): IntakeType | null {
  const m = (mime ?? "").trim().toLowerCase().split(";")[0];
  if (isIntakeType(m)) return m;
  if (m === "image/jpg") return "image/jpeg";
  // Some browsers send no type for a PDF dragged from a mail client.
  if (!m || m === "application/octet-stream") {
    const ext = (fileName ?? "").toLowerCase().split(".").pop();
    if (ext === "pdf") return "application/pdf";
    if (ext === "png") return "image/png";
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  }
  return null;
}

/** What the bytes actually are, from their own signature. */
export function sniffIntakeType(b: Uint8Array): IntakeType | null {
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return "application/pdf"; // %PDF-
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function intakeFolder(userId: string): string {
  return `intake/${userId}`;
}

/** True only for intake/<this user>/<uuid>.<pdf|png|jpg>: no other folder, no traversal, no one else's file. */
export function isIntakePathFor(userId: string, path: unknown): path is string {
  if (typeof path !== "string" || typeof userId !== "string") return false;
  if (!new RegExp(`^${UUID}$`, "i").test(userId)) return false;
  return new RegExp(`^intake/${userId}/${UUID}\\.(pdf|png|jpg)$`, "i").test(path);
}
