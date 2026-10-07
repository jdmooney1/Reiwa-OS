// ============================================================================
// Document file ownership: finding, and repairing, publication documents that share a file.
// ----------------------------------------------------------------------------
// Before migration 0034 a draft started from a version kept the source's `storage_path`, so
// two rows pointed at one file. Code now prevents new sharing and the unique index makes it
// impossible; this module is for the rows that already exist.
//
// REPAIR RULE. The row on the OLDEST version keeps the original path (it is the one a
// published snapshot was taken against). Every other row gets its own copy of the file at a
// new path and is re-pointed at it. Rows of published or superseded versions are immutable
// by trigger, so their path is changed with that one trigger switched off for the length of
// one transaction; the path is where a file lives, not part of what was published.
//
// Nothing here runs by itself. The scripts call it, dry-run by default.
// SERVER-ONLY.
// ============================================================================
import type { Pool } from "pg";
import { documentObjectStore, signDocumentObject, DocumentObjectMissingError, type DocumentObjectStore } from "@/lib/documents/storage";

export interface SharedDocumentRow {
  documentId: string;
  versionId: string;
  versionNumber: number;
  versionStatus: string;
  title: string;
  storagePath: string;
  mimeType: string | null;
}

export interface UnsharePlanItem {
  keep: SharedDocumentRow;
  repoint: SharedDocumentRow[];
}

export async function findSharedDocuments(pool: Pool): Promise<UnsharePlanItem[]> {
  const { rows } = await pool.query(
    `select d.document_id, d.version_id, v.version_number, v.status as version_status,
            d.title, d.storage_path, d.mime_type
       from publication_documents d
       join publication_versions v on v.version_id = d.version_id
      where d.storage_path in (select storage_path from publication_documents
                                group by storage_path having count(*) > 1)
      order by d.storage_path, v.version_number, d.created_at, d.document_id`);
  const byPath = new Map<string, SharedDocumentRow[]>();
  for (const r of rows) {
    const row: SharedDocumentRow = {
      documentId: r.document_id, versionId: r.version_id, versionNumber: Number(r.version_number),
      versionStatus: r.version_status, title: r.title, storagePath: r.storage_path, mimeType: r.mime_type,
    };
    byPath.set(row.storagePath, [...(byPath.get(row.storagePath) ?? []), row]);
  }
  return [...byPath.values()].map(([keep, ...repoint]) => ({ keep, repoint }));
}

/** Documents whose stored file does not exist (read-only; uses the same probe a download would). */
export async function findMissingObjects(pool: Pool): Promise<SharedDocumentRow[]> {
  const { rows } = await pool.query(
    `select d.document_id, d.version_id, v.version_number, v.status as version_status,
            d.title, d.storage_path, d.mime_type
       from publication_documents d join publication_versions v on v.version_id = d.version_id
      order by v.version_number, d.title`);
  const missing: SharedDocumentRow[] = [];
  for (const r of rows) {
    if ((await signDocumentObject(r.storage_path)) === null) {
      missing.push({
        documentId: r.document_id, versionId: r.version_id, versionNumber: Number(r.version_number),
        versionStatus: r.version_status, title: r.title, storagePath: r.storage_path, mimeType: r.mime_type,
      });
    }
  }
  return missing;
}

export interface UnshareReport {
  applied: boolean;
  groups: number;
  repointed: { documentId: string; versionNumber: number; title: string; from: string; to: string }[];
  /** Shared rows whose file is already gone: nothing to copy, so they are left as they are. */
  unrepairable: { documentId: string; versionNumber: number; title: string; path: string }[];
  indexCreated: boolean;
}

export async function unshareDocuments(
  pool: Pool, options: { apply: boolean; objects?: DocumentObjectStore } = { apply: false },
): Promise<UnshareReport> {
  const objects = options.objects ?? documentObjectStore;
  const plan = await findSharedDocuments(pool);
  const report: UnshareReport = {
    applied: options.apply, groups: plan.length, repointed: [], unrepairable: [], indexCreated: false,
  };
  const copied: string[] = [];
  const moves: { row: SharedDocumentRow; to: string }[] = [];

  for (const item of plan) {
    for (const row of item.repoint) {
      if (!options.apply) { report.repointed.push({ documentId: row.documentId, versionNumber: row.versionNumber, title: row.title, from: row.storagePath, to: "(new path on --apply)" }); continue; }
      try {
        const to = await objects.copy(row.storagePath, row.versionId, row.mimeType);
        copied.push(to);
        moves.push({ row, to });
      } catch (e) {
        if (e instanceof DocumentObjectMissingError) {
          report.unrepairable.push({ documentId: row.documentId, versionNumber: row.versionNumber, title: row.title, path: row.storagePath });
          continue;
        }
        await objects.remove(copied).catch(() => undefined);
        throw e;
      }
    }
  }

  if (options.apply && moves.length > 0) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("alter table publication_documents disable trigger trg_pubdocument_guard");
      for (const { row, to } of moves) {
        await client.query("update publication_documents set storage_path = $1 where document_id = $2", [to, row.documentId]);
        report.repointed.push({ documentId: row.documentId, versionNumber: row.versionNumber, title: row.title, from: row.storagePath, to });
      }
      await client.query("alter table publication_documents enable trigger trg_pubdocument_guard");
      await client.query("commit");
    } catch (e) {
      await client.query("rollback").catch(() => undefined);
      await objects.remove(copied).catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  if (options.apply) {
    const { rows } = await pool.query(
      "select exists (select 1 from publication_documents group by storage_path having count(*) > 1) as dup");
    if (!rows[0].dup) {
      await pool.query(
        "create unique index if not exists publication_documents_storage_path_key on publication_documents (storage_path)");
      report.indexCreated = true;
    }
  }
  return report;
}
