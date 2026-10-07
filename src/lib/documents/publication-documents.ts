// ============================================================================
// Removing a publication document: the row, then the file - and only its own file.
// ----------------------------------------------------------------------------
// One function, used by the admin action and by the tests that reproduce the audit's
// data-loss path, so what is tested is what runs.
// SERVER-ONLY (reaches the storage secret key).
// ============================================================================
import type { Session } from "@/lib/db/client";
import { removePublicationDocument } from "@/lib/data/investor-portal";
import { deleteDocumentObject } from "@/lib/documents/storage";

/**
 * Delete a document row and, when nothing else references its file, the file.
 * Returns the object path that was deleted, or null when none was (row not found,
 * not permitted, or the file is still referenced and was therefore left alone).
 */
export async function removePublicationDocumentAndObject(
  session: Session, documentId: string,
  deleteObject: (path: string) => Promise<void> = deleteDocumentObject,
): Promise<string | null> {
  const path = await removePublicationDocument(session, documentId);
  if (path) await deleteObject(path);
  return path;
}
