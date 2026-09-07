// The document-store contract, shared by server and client code.
//
// This module deliberately imports nothing. The admin publication screen is a
// client component and needs the accepted file types, so anything imported here
// would be pulled into the browser bundle with them — which is how the Supabase
// admin client (and the secret key it reads) would end up client-side. Keep it
// free of imports.

/** The one private Supabase Storage bucket. Never public. */
export const DOCUMENT_BUCKET = "publication-documents";

/**
 * How long a download link lives. Short enough that a link copied out of a
 * browser's history, a chat message or a proxy log is already dead, and long
 * enough for the redirect and the transfer to start.
 */
export const SIGNED_URL_TTL_SECONDS = 60;

/** Hard ceiling on an uploaded document. */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

/**
 * The document types Reiwa releases to investors, and the extension each one is
 * stored under. The MIME type is checked against these keys on the server;
 * anything else is refused. The extension comes from THIS map, never from the
 * uploaded file name, so a `.pdf.exe` cannot be talked into the store.
 */
export const ALLOWED_DOCUMENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "application/vnd.ms-powerpoint": ".ppt",
  "text/csv": ".csv",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "application/zip": ".zip",
});

/** The `accept` attribute for the upload control — a convenience, not a control. */
export const UPLOAD_ACCEPT = Object.keys(ALLOWED_DOCUMENT_TYPES).join(",");

export interface UploadRejection {
  ok: false;
  reason: string;
}
export interface UploadAcceptance {
  ok: true;
  mimeType: string;
  sizeBytes: number;
}
export type UploadCheck = UploadAcceptance | UploadRejection;

/**
 * Validate an upload before a single byte is stored. Pure and synchronous, so
 * the same rule can be asserted in a test without a network round-trip.
 *
 * The browser's `accept` attribute is a convenience for the operator; this is
 * the control. It runs on the server, on what the server actually received.
 */
export function checkUpload(mimeType: string, sizeBytes: number): UploadCheck {
  const type = (mimeType ?? "").trim().toLowerCase().split(";")[0];
  if (!type) return { ok: false, reason: "The file type could not be determined." };
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_DOCUMENT_TYPES, type)) {
    return { ok: false, reason: `Files of type ${type} cannot be published to investors.` };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, reason: "The file is empty." };
  }
  if (sizeBytes > MAX_DOCUMENT_BYTES) {
    const mb = Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024));
    return { ok: false, reason: `The file is larger than the ${mb} MB limit.` };
  }
  return { ok: true, mimeType: type, sizeBytes };
}
