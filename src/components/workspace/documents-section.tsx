import type { OpportunityDocument } from "@/lib/data/opportunity-documents";
import type { DdItemRecord } from "@/lib/data/due-diligence";
import { DOC_CATEGORY_KEYS } from "@/lib/documents/catalog";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents/constraints";
import { recordDocumentAction } from "@/app/actions/workspace";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Section, TableWrap, Th, Td, Empty, Provenance } from "@/components/workspace/primitives";

/**
 * Internal opportunity documents.
 *
 * The same private bucket, the same tiers and the same short-lived signed-URL
 * delivery as everything else — this section adds a relationship, not a second
 * storage system. Internal documents are `internal` by default and are NOT
 * investor-visible: what an investor sees is controlled entirely by the
 * publication's own document list, which is a separate, deliberate act.
 *
 * Upload is registration-only in this phase: the file is placed in the bucket
 * by the existing admin path and recorded here. A browser upload route is not
 * built, and the screen says so rather than presenting a control that does not
 * work.
 */
export function DocumentsSection({
  opportunityId, documents, ddItems, canWrite,
}: {
  opportunityId: string;
  documents: OpportunityDocument[];
  ddItems: DdItemRecord[];
  canWrite: boolean;
}) {
  const linkedByDoc = new Map<string, DdItemRecord[]>();
  for (const it of ddItems) {
    if (!it.sourceDocumentId) continue;
    const list = linkedByDoc.get(it.sourceDocumentId) ?? [];
    list.push(it);
    linkedByDoc.set(it.sourceDocumentId, list);
  }

  return (
    <div>
      <Section eyebrow="Vault" title={`Internal documents (${documents.length})`}>
        {documents.length === 0 ? (
          <Empty
            title="No documents recorded against this opportunity."
            hint="Documents are categorised so a finding can be traced back to the file it came from."
          />
        ) : (
          <TableWrap>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <Th>Title</Th>
                  <Th>File</Th>
                  <Th>Category</Th>
                  <Th>Linked diligence</Th>
                  <Th>Access</Th>
                  <Th>Added</Th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => {
                  const linked = linkedByDoc.get(d.documentId) ?? [];
                  return (
                    <tr key={d.documentId}>
                      <Td>{d.title}</Td>
                      <Td className="text-xs text-ink-muted">{d.fileName ?? "—"}</Td>
                      <Td className="text-xs text-ink-muted">{d.category}</Td>
                      <Td className="text-xs text-ink-muted">
                        {linked.length === 0
                          ? "—"
                          : linked.map((l) => l.item).join(", ")}
                      </Td>
                      <Td>
                        <Badge tone={d.accessLevel === "internal" ? "muted" : "caution"}>
                          {d.accessLevel}
                        </Badge>
                      </Td>
                      <Td className="text-2xs text-ink-faint">
                        {formatDate(d.createdAt)}
                        {d.uploadedByName ? ` · ${d.uploadedByName}` : ""}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
        <Provenance>
          Internal documents are never exposed to investors by being recorded here.
          An investor sees only what a publication version explicitly carries.
        </Provenance>
      </Section>

      {canWrite && (
        <Section eyebrow="Register" title="Record a document">
          <p className="mb-4 max-w-2xl text-xs leading-relaxed text-ink-muted">
            This records a file already placed in the private bucket. A
            browser upload route is not built in this phase, so rather than show
            a control that cannot work, the storage path is entered directly.
            Files are capped at {Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)}MB
            and are served only as short-lived signed URLs.
          </p>
          <form action={recordDocumentAction.bind(null, opportunityId)}
            className="max-w-3xl space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="eyebrow">Title</span>
                <input name="title" required
                  className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-3 text-sm text-ink focus:border-line-strong focus:outline-none" />
              </label>
              <label className="block">
                <span className="eyebrow">Category</span>
                <select name="category" defaultValue="Technical DD"
                  className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-2 text-sm text-ink focus:border-line-strong focus:outline-none">
                  {DOC_CATEGORY_KEYS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="eyebrow">Storage path</span>
                <input name="storagePath" required placeholder={`opportunities/${opportunityId}/file.pdf`}
                  className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-3 text-sm text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none" />
              </label>
              <label className="block">
                <span className="eyebrow">File name</span>
                <input name="fileName"
                  className="mt-1 h-9 w-full rounded border border-line bg-surface-card px-3 text-sm text-ink focus:border-line-strong focus:outline-none" />
              </label>
            </div>
            <button type="submit"
              className="rounded bg-purple px-3.5 py-2 text-xs font-semibold text-surface hover:bg-purple-70">
              Record document
            </button>
          </form>
        </Section>
      )}
    </div>
  );
}
