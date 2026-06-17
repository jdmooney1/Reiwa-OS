import { FileText, UploadCloud, Download } from "lucide-react";
import type { DocumentRecord, DocCategory } from "@/types/database";
import { formatDate } from "@/lib/format";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const CATEGORY_ORDER: DocCategory[] = [
  "Legal", "Financial", "Technical", "Valuation", "Planning", "Tax",
  "ESG", "Insurance", "Marketing", "Correspondence", "Other",
];

export function DocumentsTab({ documents }: { documents: DocumentRecord[] }) {
  const present = CATEGORY_ORDER.filter((c) => documents.some((d) => d.category === c));

  return (
    <div className="space-y-6">
      {/* Upload dropzone */}
      <button className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-surface-card py-8 text-center transition-colors hover:border-gold/50 hover:bg-gold/[0.02]">
        <UploadCloud className="h-6 w-6 text-ink-faint" strokeWidth={1.5} />
        <div className="text-sm font-medium text-ink">Upload to the Document Vault</div>
        <div className="text-2xs text-ink-faint">
          Drag &amp; drop or browse · stored privately in Supabase Storage
        </div>
      </button>

      {/* Category tag filter row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="eyebrow mr-1">Categories</span>
        {present.map((c) => (
          <Badge key={c} tone="neutral">
            {c} · {documents.filter((d) => d.category === c).length}
          </Badge>
        ))}
        {present.length === 0 && (
          <span className="text-xs italic text-ink-faint">No documents uploaded yet.</span>
        )}
      </div>

      {/* Document cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {documents.map((doc) => (
          <Card key={doc.document_id} className="transition-colors hover:border-gold/40">
            <CardBody className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded bg-navy/5 text-ink-muted">
                  <FileText className="h-4 w-4" strokeWidth={1.75} />
                </div>
                <Badge tone="gold">{doc.category}</Badge>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{doc.file_name}</div>
                {doc.summary && (
                  <div className="mt-0.5 line-clamp-2 text-xs text-ink-muted">{doc.summary}</div>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-line pt-2.5 text-2xs text-ink-faint">
                <span>{doc.uploaded_by} · {formatDate(doc.uploaded_at)}</span>
                <Download className="h-3.5 w-3.5 cursor-pointer hover:text-gold-deep" />
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
