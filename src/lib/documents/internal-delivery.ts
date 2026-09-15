// ============================================================================
// Internal document delivery — the only path from a staff member to a byte.
// ----------------------------------------------------------------------------
// The investor counterpart is secure-delivery.ts, and this module is
// deliberately built to the same shape rather than to a convenient one:
//
//   * A caller presents a DOCUMENT ID. It never presents, receives or guesses a
//     storage path, and no storage path reaches the browser.
//   * The lookup runs inside withSession(), so `opportunity_documents_select`
//     (migration 0008: `app.has_org(org_id)`) decides whether the row exists for
//     this caller. No org comparison is written here, so a defect here cannot
//     widen access — the row simply is not there to read.
//   * The answer to every refusal is null. An opportunity in another
//     organisation, a deleted document and an invented uuid are indistinguishable
//     to the caller.
//   * The signed URL lives for the same sixty seconds as an investor's.
//
// Investors cannot reach this path at all, and not because it is unadvertised:
// a portal contact has no `profiles` row and no `organization_members` row, so
// `app.has_org()` is false for every org and the select returns nothing. The
// route above it additionally requires an internal session.
//
// This module adds a relationship to the existing store. It is not a second
// storage system, it mints no public URL, and it changes no tier.
//
// SERVER-ONLY.
// ============================================================================
import { withSession, type Session } from "@/lib/db/client";
import { isUuid } from "@/lib/data/portal-feed";
import { signDocumentObject } from "@/lib/documents/storage";

interface AuthorisedInternalDocument {
  documentId: string;
  opportunityId: string;
  title: string;
  fileName: string | null;
  storagePath: string;
}

/**
 * Resolve a document id to the object it names, or null when this session may
 * not read it — which RLS, not this function, decides.
 *
 * The opportunity id is checked against the row rather than trusted from the
 * URL: a document id belonging to another opportunity in the same organisation
 * is a real row this caller may read, but it is not the document this URL
 * claims, and a delivery route that quietly serves a different file than the one
 * it names is a route nobody can audit.
 */
async function authoriseInternalDocument(
  session: Session, opportunityId: string, documentId: string,
): Promise<AuthorisedInternalDocument | null> {
  if (!isUuid(documentId) || !isUuid(opportunityId)) return null;

  const rows = await withSession(session, async (tx) => {
    const { rows } = await tx.query<{
      document_id: string; opportunity_id: string;
      title: string; file_name: string | null; storage_path: string;
    }>(
      `select document_id, opportunity_id, title, file_name, storage_path
         from opportunity_documents
        where document_id = $1 and opportunity_id = $2`,
      [documentId, opportunityId]);
    return rows;
  });

  const r = rows[0];
  if (!r) return null;
  return {
    documentId: r.document_id,
    opportunityId: r.opportunity_id,
    title: r.title,
    fileName: r.file_name,
    storagePath: r.storage_path,
  };
}

/**
 * Authorise and sign. Null on any refusal, and the caller must not reveal which
 * refusal applied.
 */
export async function issueInternalDocumentDownload(
  session: Session, opportunityId: string, documentId: string,
): Promise<string | null> {
  const doc = await authoriseInternalDocument(session, opportunityId, documentId);
  if (!doc) return null;
  return signDocumentObject(doc.storagePath, doc.fileName ?? doc.title);
}
