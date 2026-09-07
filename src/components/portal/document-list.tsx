import { FileText, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DOC_CATEGORY_LABEL, DOC_LEVEL_LABEL } from "@/lib/portal-labels";
import type { PortalDocument } from "@/lib/data/portal-feed";
import type { EntitlementDocumentLevel } from "@/lib/data/investor-portal";

function fileSize(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

/**
 * The documents released with this opportunity.
 *
 * The list is exactly what `publication_documents_tiered` returned for this
 * investor: a standard entitlement never receives a diligence document, and an
 * `internal` document is refused at every tier, so nothing is filtered here —
 * there is no client-side or server-side hiding to get wrong.
 *
 * Each link points at /portal/documents/<id>, which re-authorises the request
 * against the database and answers with a sixty-second signed URL. The storage
 * path is not part of the projection that reaches this component, so there is
 * no direct object reference anywhere in the investor's browser.
 */
export function DocumentList({
  documents, tier,
}: {
  documents: PortalDocument[];
  tier: EntitlementDocumentLevel;
}) {
  if (documents.length === 0) {
    return (
      <p className="rounded border border-dashed border-line px-5 py-8 text-center text-sm text-ink-muted">
        No documents have been released with this opportunity yet.
      </p>
    );
  }

  return (
    <>
      <ul className="divide-y divide-line rounded border border-line">
        {documents.map((d) => (
          <li key={d.documentId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
            <FileText className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.75} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{d.title}</div>
              <div className="mt-0.5 text-2xs text-ink-faint">
                {DOC_CATEGORY_LABEL[d.category]}
                {fileSize(d.sizeBytes) && <span> · {fileSize(d.sizeBytes)}</span>}
              </div>
            </div>
            {d.accessLevel === "diligence" && (
              <Badge tone="gold">{DOC_LEVEL_LABEL.diligence}</Badge>
            )}
            <a
              href={`/portal/documents/${d.documentId}`}
              // The link leaves for a signed storage URL; keep it out of the referer.
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded border border-line px-2.5 py-1.5 text-2xs font-medium text-ink-muted hover:border-gold/40 hover:text-ink focus-visible:border-gold"
            >
              <Download className="h-3 w-3" strokeWidth={1.75} aria-hidden="true" />
              <span>Download</span>
              <span className="sr-only"> {d.title}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-2xs leading-relaxed text-ink-faint">
        Documents are held in Reiwa Capital&rsquo;s private document store. Each download link is
        issued to you personally and expires within a minute, so please open it rather than sharing
        it.
        {tier === "standard" && (
          <>
            {" "}Your organisation currently holds standard document access; diligence materials are
            released separately.
          </>
        )}
      </p>
    </>
  );
}
