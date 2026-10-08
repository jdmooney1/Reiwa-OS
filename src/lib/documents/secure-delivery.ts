// ============================================================================
// Secure document delivery (P6) — the only path from an investor to a byte.
// ----------------------------------------------------------------------------
// An investor never receives a storage path, a bucket name or a public URL. To
// download a document they present an id, and this module answers with a
// sixty-second signed URL — but only after the DATABASE has agreed.
//
// Two document families share this one path, tried in order, both refused the
// same way (§ below):
//
//   * Publication documents. The lookup runs inside withInvestorSession(), so
//     `publication_documents_tiered` (migration 0005) decides it, from
//     auth.uid() alone:
//       - Standard entitlement  → standard documents only.
//       - Diligence entitlement → standard AND diligence.
//       - `internal`            → refused at every tier, unconditionally.
//       - A revoked or hidden entitlement, a deactivated contact, a suspended
//         organisation, a withdrawn publication or a superseded version all
//         make app.current_investor_org_id() or the policy's entitlement join
//         resolve to nothing, so the row is simply not there to read.
//   * Deal documents (docs/24 Session 4). The id is a document_version_id;
//     `document_version_investor_select` (migration 0056) decides it —
//     app.investor_may_read_document_version(), which in turn reads the
//     deal_room_enabled flag, the underwriting_model exclusion, the
//     investor_nda/investor_teaser exemption or a deal_document_entitlements
//     row, and the governing-language Final/Signed + JA translation_status
//     rule. Nothing here re-derives any of that.
//
// That is why this module holds no tier comparison, no status check and no
// organisation id: a defect here cannot widen access, because the row never
// arrives. A tampered or guessed id is not a capability — it selects zero rows
// from BOTH lookups and is refused exactly like a revoked one.
//
// The activity event — `document_downloaded` (investor_activity_events) for a
// publication document, a `document_view_log` row for a deal document — is
// written ONLY after a signed URL has been successfully minted. A refusal
// writes nothing, so the trail records deliveries, never attempts.
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
  publicationId?: string;
  versionId: string;
}

/**
 * What the database released about a deal_document version an investor may
 * read (docs/24 Session 4). Mirrors AuthorisedDocument's shape and purpose —
 * `file_url` is a delivery detail used to sign the object, never returned to
 * the browser.
 */
interface AuthorisedDealDocumentVersion {
  versionId: string;
  dealDocumentId: string;
  orgId: string;
  fileUrl: string;
}

/**
 * Resolve a document_version id to the object it names, or null when this
 * investor may not read it right now. Same null-for-every-refusal rule as
 * authoriseDocument.
 */
async function authoriseDealDocumentVersion(
  authUserId: string, versionId: string,
): Promise<AuthorisedDealDocumentVersion | null> {
  if (!isUuid(versionId)) return null;
  const rows = await withInvestorSession(authUserId, async (tx) => {
    const { rows } = await tx.query<{
      version_id: string; deal_document_id: string; org_id: string; file_url: string | null;
    }>(
      `select dv.version_id, dv.deal_document_id, dd.org_id, dv.file_url
         from document_version dv
         join deal_document dd on dd.deal_document_id = dv.deal_document_id
        where dv.version_id = $1`,
      [versionId]);
    return rows;
  });
  const r = rows[0];
  if (!r || !r.file_url) return null;
  return {
    versionId: r.version_id,
    dealDocumentId: r.deal_document_id,
    orgId: r.org_id,
    fileUrl: r.file_url,
  };
}

/**
 * The whole delivery: authorise, sign, record. Tries a publication document
 * first, then a deal_document version — both refused identically, so a
 * caller can never tell which family an unguessable id would have named.
 *
 * Returns null on any refusal. A caller must treat null as "no such document
 * for you" and must not reveal which of the reasons applied.
 */
export async function issueDocumentDownload(
  authUserId: string, documentId: string,
): Promise<DownloadGrant | null> {
  const doc = await authoriseDocument(authUserId, documentId);
  if (doc) {
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

  const dealVersion = await authoriseDealDocumentVersion(authUserId, documentId);
  if (dealVersion) {
    const signedUrl = await signDocumentObject(dealVersion.fileUrl);
    if (!signedUrl) return null;

    await recordDealDocumentViewed(authUserId, dealVersion);

    return {
      signedUrl,
      documentId: dealVersion.versionId,
      versionId: dealVersion.versionId,
    };
  }

  return null;
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

/**
 * Write the document_view_log row for a deal_document delivery that has
 * happened. Same posture as recordDocumentDownloaded: kept private, never
 * throws — a logging failure must not fail a download the investor is
 * entitled to. RLS (document_view_log_investor_insert, 0057) re-checks
 * everything this function asserts; this cannot write a row the database
 * would not have allowed from the investor's own session.
 */
async function recordDealDocumentViewed(
  authUserId: string, doc: AuthorisedDealDocumentVersion,
): Promise<void> {
  try {
    await withInvestorSession(authUserId, async (tx) => {
      await tx.query(
        `insert into document_view_log(
           org_id, deal_document_id, document_version_id, investor_contact_id, action)
         values ($1, $2, $3, app.current_investor_contact_id(), 'download')`,
        [doc.orgId, doc.dealDocumentId, doc.versionId]);
    });
  } catch {
    // Deliberately swallowed: the bytes were authorised and delivered.
  }
}
