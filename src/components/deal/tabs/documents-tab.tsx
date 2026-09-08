"use client";

import { useMemo, useState } from "react";
import { UploadCloud, AlertTriangle, HelpCircle, ShieldAlert } from "lucide-react";
import type { DealFile, DocumentRecord, DueDiligenceItem, Risk, DocCategory } from "@/types/database";
import {
  DOC_CATEGORY_BY_KEY, DOC_CATEGORY_KEYS, INGEST_STATUS_LABEL, INGEST_STATUS_TONE,
} from "@/lib/documents/catalog";
import { generateExtraction, ddItemFromFinding, riskFromFinding } from "@/lib/documents/ingest";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DocumentDrawer } from "@/components/deal/documents/document-drawer";

const withDelay = <T,>(v: T, ms = 600): Promise<T> =>
  new Promise((r) => setTimeout(() => r(v), ms));

export function DocumentsTab({ file }: { file: DealFile }) {
  const deal = file.deal;
  const [docs, setDocs] = useState<DocumentRecord[]>(file.documents);
  const [openId, setOpenId] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [filterCat, setFilterCat] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  // Session-created links (placeholder for persisted DD/risk creation).
  const [createdDD, setCreatedDD] = useState<Record<string, DueDiligenceItem[]>>({});
  const [createdRisks, setCreatedRisks] = useState<Record<string, Risk[]>>({});

  const openDoc = docs.find((d) => d.document_id === openId) ?? null;

  const updateDoc = (id: string, patch: Partial<DocumentRecord>) =>
    setDocs((prev) => prev.map((d) => (d.document_id === id ? { ...d, ...patch } : d)));

  const filtered = docs.filter(
    (d) =>
      (!filterCat || d.category === filterCat) &&
      (!filterStatus || d.ingest_status === filterStatus),
  );

  // Vault rollup.
  const stats = useMemo(() => {
    const reviewed = docs.filter((d) => d.ingest_status === "reviewed").length;
    const pending = docs.filter((d) => d.ingest_status === "uploaded").length;
    const findings = docs.reduce(
      (s, d) =>
        s +
        (d.extraction
          ? d.extraction.risks.length +
            d.extraction.missing_information.length +
            d.extraction.follow_up_questions.length
          : 0),
      0,
    );
    return { reviewed, pending, findings };
  }, [docs]);

  // ---- Actions -------------------------------------------------------------
  const onUpload = () => {
    const id = `upload-${Date.now()}`;
    const newDoc: DocumentRecord = {
      document_id: id, deal_id: deal.deal_id, file_name: `New Document ${docs.length + 1}.pdf`,
      file_type: "application/pdf", category: "Broker Brochure", storage_url: null,
      uploaded_by: "JD Mooney", uploaded_at: new Date().toISOString(),
      summary: null, ingest_status: "uploaded", extraction: null,
    };
    setDocs((prev) => [newDoc, ...prev]);
    setOpenId(id);
  };

  const onIngest = async (id: string) => {
    const doc = docs.find((d) => d.document_id === id);
    if (!doc) return;
    setIngesting(true);
    updateDoc(id, { ingest_status: "processing" });
    await withDelay(null);
    updateDoc(id, { ingest_status: "extracted", extraction: generateExtraction(doc.category, deal) });
    setIngesting(false);
  };

  const onCreateTask = (docId: string, finding: string) => {
    const doc = docs.find((d) => d.document_id === docId);
    if (!doc) return;
    const task = ddItemFromFinding(finding, doc.category, deal, doc.file_name);
    setCreatedDD((prev) => ({ ...prev, [docId]: [...(prev[docId] ?? []), task] }));
  };

  const onCreateRisk = (docId: string, finding: string) => {
    const doc = docs.find((d) => d.document_id === docId);
    if (!doc) return;
    const risk = riskFromFinding(finding, deal, doc.file_name);
    setCreatedRisks((prev) => ({ ...prev, [docId]: [...(prev[docId] ?? []), risk] }));
  };

  // Pre-existing DD items linked to a document by file name + session-created.
  const linkedDDFor = (doc: DocumentRecord) => [
    ...file.dueDiligence.filter((i) => i.linked_documents.includes(doc.file_name)),
    ...(createdDD[doc.document_id] ?? []),
  ];
  const linkedRisksFor = (doc: DocumentRecord) => createdRisks[doc.document_id] ?? [];

  return (
    <div className="space-y-5">
      {/* Vault control bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-card px-4 py-3">
        <div className="flex items-center gap-6">
          <Stat label="Documents" value={docs.length} />
          <Stat label="Reviewed" value={stats.reviewed} tone="positive" />
          <Stat label="Pending ingestion" value={stats.pending} tone={stats.pending ? "caution" : undefined} />
          <Stat label="Open findings" value={stats.findings} tone={stats.findings ? "caution" : undefined} />
        </div>
        <button
          onClick={onUpload}
          className="flex items-center gap-1.5 rounded bg-purple px-3.5 py-2 text-xs font-medium text-surface hover:bg-purple-70"
        >
          <UploadCloud className="h-3.5 w-3.5" /> Upload Document
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow mr-1">Filter</span>
        <Select value={filterCat} onChange={setFilterCat} placeholder="Category"
          options={DOC_CATEGORY_KEYS.map((k) => ({ value: k, label: k }))} />
        <Select value={filterStatus} onChange={setFilterStatus} placeholder="Status"
          options={(["uploaded", "processing", "extracted", "reviewed"] as const).map((s) => ({ value: s, label: INGEST_STATUS_LABEL[s] }))} />
        <span className="tabular ml-auto text-2xs text-ink-faint">{filtered.length} of {docs.length}</span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((doc) => (
          <DocumentCard
            key={doc.document_id}
            doc={doc}
            linkedDD={linkedDDFor(doc).length}
            onOpen={() => setOpenId(doc.document_id)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full rounded-lg border border-dashed border-line py-10 text-center text-sm text-ink-faint">
            No documents match the current filters.
          </div>
        )}
      </div>

      {openDoc && (
        <DocumentDrawer
          doc={openDoc}
          deal={deal}
          linkedDD={linkedDDFor(openDoc)}
          linkedRisks={linkedRisksFor(openDoc)}
          ingesting={ingesting}
          onClose={() => setOpenId(null)}
          onIngest={() => onIngest(openDoc.document_id)}
          onReview={() => updateDoc(openDoc.document_id, { ingest_status: "reviewed" })}
          onChangeCategory={(c: DocCategory) => updateDoc(openDoc.document_id, { category: c })}
          onCreateTask={(finding) => onCreateTask(openDoc.document_id, finding)}
          onCreateRisk={(finding) => onCreateRisk(openDoc.document_id, finding)}
        />
      )}
    </div>
  );
}

function DocumentCard({
  doc, linkedDD, onOpen,
}: {
  doc: DocumentRecord; linkedDD: number; onOpen: () => void;
}) {
  const def = DOC_CATEGORY_BY_KEY[doc.category];
  const Icon = def.icon;
  const ex = doc.extraction;
  return (
    <button
      onClick={onOpen}
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface-card p-3.5 text-left transition-colors hover:border-line"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded bg-surface-sunken text-ink-muted">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <Badge tone={INGEST_STATUS_TONE[doc.ingest_status]} dot>{INGEST_STATUS_LABEL[doc.ingest_status]}</Badge>
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-ink">{doc.file_name}</div>
        <div className="mt-0.5 text-2xs text-ink-faint">{doc.category}</div>
      </div>
      {ex ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-2.5 text-2xs text-ink-muted">
          {ex.financial_figures.length > 0 && <span className="tabular">{ex.financial_figures.length} figures</span>}
          {ex.risks.length > 0 && (
            <span className="flex items-center gap-1 text-negative"><ShieldAlert className="h-3 w-3" /> {ex.risks.length}</span>
          )}
          {ex.missing_information.length > 0 && (
            <span className="flex items-center gap-1 text-caution"><AlertTriangle className="h-3 w-3" /> {ex.missing_information.length}</span>
          )}
          {ex.follow_up_questions.length > 0 && (
            <span className="flex items-center gap-1 text-caution"><HelpCircle className="h-3 w-3" /> {ex.follow_up_questions.length}</span>
          )}
          {linkedDD > 0 && <span className="ml-auto text-ink-faint">{linkedDD} DD linked</span>}
        </div>
      ) : (
        <div className="border-t border-line pt-2.5 text-2xs italic text-ink-faint">
          Awaiting ingestion
        </div>
      )}
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "positive" | "caution" }) {
  return (
    <div>
      <div className="eyebrow mb-0.5">{label}</div>
      <div
        className={cn(
          "tabular text-lg font-semibold",
          tone === "positive" && "text-positive",
          tone === "caution" && "text-caution",
          !tone && "text-ink",
        )}
      >
        {value}
      </div>
    </div>
  );
}
