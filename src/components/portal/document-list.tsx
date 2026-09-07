"use client";

import { useState } from "react";
import { FileText, Download, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DOC_CATEGORY_LABEL, DOC_LEVEL_LABEL } from "@/lib/portal-labels";
import { requestDocumentUrlAction } from "@/app/actions/portal";
import type { PortalDocument } from "@/lib/data/portal-feed";
import type { EntitlementDocumentLevel } from "@/lib/data/investor-portal";

function fileSize(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

const REFUSAL: Record<string, string> = {
  signed_out: "Your session has ended. Sign in again to download this document.",
  not_available: "This document is no longer available to you. Please contact Reiwa Capital.",
  missing_file: "This document has not been uploaded yet. Your Reiwa contact can send it directly.",
  failed: "The download could not be prepared just now. Please try again in a moment.",
};

/**
 * The documents released with this opportunity.
 *
 * The list is exactly what `publication_documents_tiered` returned for this
 * investor: a standard entitlement never receives a diligence document, and an
 * `internal` document is refused at every tier, so nothing is filtered here.
 *
 * Downloading never uses a URL held by the browser. The button asks the server,
 * which re-checks entitlement against the database and only then mints a
 * signed link that expires in under a minute. The document's storage path is
 * not part of the data this component receives.
 */
export function DocumentList({
  documents, tier,
}: {
  documents: PortalDocument[];
  tier: EntitlementDocumentLevel;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  if (documents.length === 0) {
    return (
      <p className="rounded border border-dashed border-line px-5 py-8 text-center text-sm text-ink-muted">
        No documents have been released with this opportunity yet.
      </p>
    );
  }

  async function download(documentId: string) {
    setBusy(documentId);
    setError(null);
    try {
      const result = await requestDocumentUrlAction(documentId);
      if (result.ok) {
        // The link is single-purpose and short-lived; hand it straight to the
        // browser rather than holding it anywhere.
        window.location.href = result.url;
      } else {
        setError({ id: documentId, message: REFUSAL[result.reason] ?? REFUSAL.failed });
      }
    } catch {
      setError({ id: documentId, message: REFUSAL.failed });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <ul className="divide-y divide-line rounded border border-line">
        {documents.map((d) => (
          <li key={d.documentId} className="px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
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
              <button
                type="button"
                onClick={() => download(d.documentId)}
                disabled={busy === d.documentId}
                className="inline-flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-2xs font-medium text-ink-muted transition-colors hover:border-gold/40 hover:text-ink disabled:opacity-60"
              >
                {busy === d.documentId
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} aria-hidden="true" />
                  : <Download className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />}
                {busy === d.documentId ? "Preparing…" : "Download"}
                <span className="sr-only"> {d.title}</span>
              </button>
            </div>
            {error?.id === d.documentId && (
              <p role="alert" className="mt-2 text-2xs text-negative">{error.message}</p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-2xs leading-relaxed text-ink-faint">
        Documents are held privately by Reiwa Capital and released to you individually. Each
        download link is prepared for you at the moment you ask and expires within a minute; it
        cannot be shared.
        {tier === "standard" && (
          <>
            {" "}Your organisation currently holds standard document access; diligence materials
            are released separately.
          </>
        )}
      </p>
    </>
  );
}
