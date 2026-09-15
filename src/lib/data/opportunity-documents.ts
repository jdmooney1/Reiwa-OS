// ============================================================================
// Internal opportunity documents.
// ----------------------------------------------------------------------------
// A RELATIONSHIP, not a second document system. Files go to the same private
// bucket as everything else (src/lib/documents/constraints.ts), are never
// public, and are delivered by the same short-lived signed-URL discipline.
// Nothing here weakens a tier or a delivery control.
//
// `accessLevel` reuses the publication vocabulary on purpose: a diligence file
// that later belongs in an investor data room should be promotable without the
// bytes being uploaded twice. It defaults to `internal`, because a diligence
// document is internal until somebody deliberately decides otherwise.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { num, str } from "@/lib/data/coerce";
import type { DocCategory } from "@/types/database";

export type DocumentAccessLevel = "standard" | "diligence" | "internal";

export interface OpportunityDocument {
  documentId: string;
  orgId: string;
  opportunityId: string;
  title: string;
  category: DocCategory | string;
  storagePath: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  accessLevel: DocumentAccessLevel;
  uploadedBy: string | null;
  createdAt: string;
}

function mapDoc(r: Record<string, any>): OpportunityDocument {
  return {
    documentId: r.document_id, orgId: r.org_id, opportunityId: r.opportunity_id,
    title: r.title, category: r.category, storagePath: r.storage_path,
    fileName: str(r.file_name), mimeType: str(r.mime_type), sizeBytes: num(r.size_bytes),
    accessLevel: r.access_level, uploadedBy: r.uploaded_by ?? null, createdAt: r.created_at,
  };
}

export async function listDocuments(
  session: Session, opportunityId: string,
): Promise<OpportunityDocument[]> {
  return withSession(session, async (tx: Queryable) => {
    const { rows } = await tx.query(
      "select * from opportunity_documents where opportunity_id = $1 order by created_at desc",
      [opportunityId]);
    return rows.map(mapDoc);
  });
}

export async function recordDocument(
  session: Session,
  opportunityId: string,
  input: {
    title: string; storagePath: string; category?: string;
    fileName?: string | null; mimeType?: string | null; sizeBytes?: number | null;
    accessLevel?: DocumentAccessLevel;
  },
): Promise<string> {
  return withSession(session, async (tx) => {
    const opp = await tx.query<{ org_id: string }>(
      "select org_id from opportunities where opportunity_id = $1", [opportunityId]);
    if (!opp.rows[0]) throw new Error("Opportunity not found or not permitted");
    const res = await tx.query<{ document_id: string }>(
      `insert into opportunity_documents
         (org_id, opportunity_id, title, category, storage_path, file_name, mime_type, size_bytes, access_level, uploaded_by)
       values ($1,$2,$3,coalesce($4,'Other'),$5,$6,$7,$8,coalesce($9,'internal'),$10)
       returning document_id`,
      [opp.rows[0].org_id, opportunityId, input.title, input.category ?? null, input.storagePath,
       input.fileName ?? null, input.mimeType ?? null, input.sizeBytes ?? null,
       input.accessLevel ?? null, session.userId ?? null]);
    return res.rows[0].document_id;
  });
}
