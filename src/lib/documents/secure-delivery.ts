// ============================================================================
// Secure document delivery (P6) — the only path from an investor to a byte.
// ----------------------------------------------------------------------------
// An investor never receives a storage path, a bucket name or a public URL. To
// download a document they present a document id, and this module answers with
// a sixty-second signed URL — but only after the DATABASE has agreed.
//
// The authorisation is not written here. The lookup runs inside
// withInvestorSession(), so `publication_documents_tiered` (migration 0005)
// decides it, from auth.uid() alone:
//
//   * Standard entitlement  → standard documents only.
//   * Diligence entitlement → standard AND diligence.
//   * `internal`            → refused at every tier, unconditionally.
//   * A revoked or hidden entitlement, a deactivated contact, a suspended
//     organisation, a withdrawn publication or a superseded version all make
//     app.current_investor_org_id() or the policy's entitlement join resolve to
//     nothing, so the row is simply not there to read.
//
// That is why this module holds no tier comparison, no status check and no
// organisation id: a defect here cannot widen access, because the row never
// arrives. A tampered or guessed document id is not a capability — it selects
// zero rows and is refused exactly like a revoked one.
//
// The `document_downloaded` event is written ONLY after a signed URL has been
// successfully minted. A refusal writes nothing, so the activity trail records
// deliveries, never attempts.
//
// SERVER-ONLY.
// ============================================================================
import { withInvestorSession } from "@/lib/db/client";
import { isUuid } from "@/lib/data/portal-feed";
import { signDocumentObject } from "@/lib/documents/storage";

/**
 * What the database released about a document the investor may read. The
 * storage path is present because the RLS check has already passed — it is a
 * delivery detail used to sign the object and is never returned to the browser.
 */
interface AuthorisedDocument {
  documentId: string;
  versionId: string;
  publicationId: string;
  title: string;
  fileName: string | null;
  storagePath: string;
}

/**
 * Resolve a document id to the object it names, or null when this investor may
 * not read it. Null is the answer for every refusal — unentitled, wrong tier,
 * internal, revoked, deactivated, suspended, withdrawn, malformed or invented —
 * so no caller can distinguish "does not exist" from "not allowed".
 */
async function authoriseDocument(
  authUserId: string, documentId: string,
): Promise<AuthorisedDocument | null> {
  if (!isUuid(documentId)) return null;
  const rows = await withInvestorSession(authUserId, async (tx) => {
    const { rows } = await tx.query<{
      document_id: string; version_id: string; publication_id: string;
      title: string; file_name: string | null; storage_path: string;
    }>(
      `select d.document_id, d.version_id, v.publication_id,
              d.title, d.file_name, d.storage_path
         from publication_documents d
         join publication_versions v on v.version_id = d.version_id
        where d.document_id = $1`,
      [documentId]);
    return rows;
  });
  const r = rows[0];
  if (!r) return null;
  return {
    documentId: r.document_id,
    versionId: r.version_id,
    publicationId: r.publication_id,
    title: r.title,
    fileName: r.file_name,
    storagePath: r.storage_path,
  };
}

export interface DownloadGrant {
  signedUrl: string;
  documentId: string;
  publicationId: string;
  versionId: string;
}

/**
 * The whole delivery: authorise, sign, record.
 *
 * Returns null on any refusal. A caller must treat null as "no such document
 * for you" and must not reveal which of the reasons applied.
 */
export async function issueDocumentDownload(
  authUserId: string, documentId: string,
): Promise<DownloadGrant | null> {
  const doc = await authoriseDocument(authUserId, documentId);
  if (!doc) return null;

  const signedUrl = await signDocumentObject(doc.storagePath, doc.fileName ?? doc.title);
  // The store could not produce a link (missing object, storage outage). Nothing
  // was delivered, so nothing is recorded.
  if (!signedUrl) return null;

  await recordDocumentDownloaded(authUserId, doc);

  return {
    signedUrl,
    documentId: doc.documentId,
    publicationId: doc.publicationId,
    versionId: doc.versionId,
  };
}

/**
 * Write the `document_downloaded` event for a delivery that has happened.
 *
 * Kept private to this module so the event cannot be emitted from anywhere that
 * has not just minted a signed URL. Never throws: a failed activity write must
 * not fail a download the investor is entitled to.
 */
async function recordDocumentDownloaded(
  authUserId: string, doc: AuthorisedDocument,
): Promise<void> {
  try {
    await withInvestorSession(authUserId, async (tx) => {
      await tx.query(
        `insert into investor_activity_events(
           investor_contact_id, investor_org_id, event_type,
           publication_id, version_id, document_id, context)
         values (app.current_investor_contact_id(), app.current_investor_org_id(),
                 'document_downloaded', $1, $2, $3, $4)`,
        [doc.publicationId, doc.versionId, doc.documentId,
         JSON.stringify({ title: doc.title })]);
    });
  } catch {
    // Deliberately swallowed: the bytes were authorised and delivered.
  }
}
