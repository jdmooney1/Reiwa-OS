"use client";

import {
  X, Sparkles, Loader2, Link2, CheckCircle2, AlertTriangle, HelpCircle,
  Banknote, FileSignature, ListChecks, Plus, ShieldAlert,
} from "lucide-react";
import type { Deal, DocumentRecord, DueDiligenceItem, Risk, DocCategory } from "@/types/database";
import {
  DOC_CATEGORY_BY_KEY, DOC_CATEGORY_KEYS, INGEST_STATUS_LABEL, INGEST_STATUS_TONE,
} from "@/lib/documents/catalog";
import { DD_STATUS_LABEL, DD_STATUS_TONE, RISK_STATUS_LABEL, RISK_STATUS_TONE } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function DocumentDrawer({
  doc, deal, linkedDD, linkedRisks, ingesting,
  onClose, onIngest, onReview, onChangeCategory, onCreateTask, onCreateRisk,
}: {
  doc: DocumentRecord;
  deal: Deal;
  linkedDD: DueDiligenceItem[];
  linkedRisks: Risk[];
  ingesting: boolean;
  onClose: () => void;
  onIngest: () => void;
  onReview: () => void;
  onChangeCategory: (c: DocCategory) => void;
  onCreateTask: (finding: string) => void;
  onCreateRisk: (finding: string) => void;
}) {
  const def = DOC_CATEGORY_BY_KEY[doc.category];
  const Icon = def.icon;
  const ex = doc.extraction;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-navy/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-xl flex-col bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line bg-surface-card px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-navy/5 text-ink-muted">
              <Icon className="h-5 w-5" strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-serif text-base text-ink">{doc.file_name}</h3>
              <div className="mt-0.5 flex items-center gap-2 text-2xs text-ink-faint">
                <span>{doc.uploaded_by ?? "—"}</span>
                <span>·</span>
                <span>{formatDate(doc.uploaded_at)}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-ink-faint hover:bg-surface-sunken hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Meta: category, status, link to deal */}
        <div className="grid grid-cols-3 gap-3 border-b border-line px-5 py-3">
          <div>
            <div className="eyebrow mb-1">Category</div>
            <Select
              value={doc.category}
              onChange={(v) => onChangeCategory(v as DocCategory)}
              options={DOC_CATEGORY_KEYS.map((k) => ({ value: k, label: k }))}
            />
          </div>
          <div>
            <div className="eyebrow mb-1">Status</div>
            <Badge tone={INGEST_STATUS_TONE[doc.ingest_status]} dot>{INGEST_STATUS_LABEL[doc.ingest_status]}</Badge>
          </div>
          <div>
            <div className="eyebrow mb-1">Linked to</div>
            <div className="flex items-center gap-1 text-xs text-ink">
              <Link2 className="h-3 w-3 text-ink-faint" /> {deal.asset_name}
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!ex ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line bg-surface-card py-10 text-center">
              <Sparkles className="h-6 w-6 text-gold" strokeWidth={1.5} />
              <div className="text-sm font-medium text-ink">Not yet ingested</div>
              <p className="max-w-xs text-xs text-ink-muted">
                Run AI ingestion to extract key facts, financial figures, lease terms, risks and
                missing information into structured deal memory.
              </p>
              <button
                onClick={onIngest}
                disabled={ingesting}
                className="mt-1 flex items-center gap-1.5 rounded bg-gold px-3.5 py-2 text-2xs font-semibold text-navy hover:bg-gold-soft disabled:opacity-60"
              >
                {ingesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                {ingesting ? "Extracting…" : "Run AI Ingestion"}
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Summary */}
              <div className="rounded-lg border border-gold/30 bg-gold/[0.03] px-4 py-3">
                <div className="eyebrow mb-1">AI Summary</div>
                <p className="text-sm leading-relaxed text-ink/90">{ex.summary}</p>
              </div>

              <FindingList icon={CheckCircle2} title="Key Facts" items={ex.key_facts} tone="neutral" />
              <FindingList icon={Banknote} title="Financial Figures" items={ex.financial_figures} tone="neutral" mono />
              <FindingList icon={FileSignature} title="Lease Terms" items={ex.lease_terms} tone="neutral" />
              <FindingList
                icon={ShieldAlert} title="Risks" items={ex.risks} tone="negative"
                action={{ label: "Risk", icon: Plus, onClick: onCreateRisk }}
              />
              <FindingList
                icon={AlertTriangle} title="Missing Information" items={ex.missing_information} tone="caution"
                action={{ label: "DD task", icon: Plus, onClick: onCreateTask }}
              />
              <FindingList
                icon={HelpCircle} title="Suggested Follow-Up Questions" items={ex.follow_up_questions} tone="caution"
                action={{ label: "DD task", icon: Plus, onClick: onCreateTask }}
              />

              {/* Linked DD items */}
              <LinkedSection icon={ListChecks} title="Linked DD Items" count={linkedDD.length}>
                {linkedDD.length === 0 ? (
                  <Empty text="No DD items linked yet. Create tasks from findings above." />
                ) : (
                  linkedDD.map((i) => (
                    <div key={i.item_id} className="flex items-center justify-between gap-3 px-4 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-ink">{i.item}</div>
                        <div className="text-2xs text-ink-faint">{i.section}</div>
                      </div>
                      <Badge tone={DD_STATUS_TONE[i.status]} dot>{DD_STATUS_LABEL[i.status]}</Badge>
                    </div>
                  ))
                )}
              </LinkedSection>

              {/* Linked risks */}
              <LinkedSection icon={ShieldAlert} title="Linked Risks" count={linkedRisks.length}>
                {linkedRisks.length === 0 ? (
                  <Empty text="No risks linked yet. Create risks from findings above." />
                ) : (
                  linkedRisks.map((r) => (
                    <div key={r.risk_id} className="flex items-center justify-between gap-3 px-4 py-2">
                      <div className="min-w-0 truncate text-xs font-medium text-ink">{r.risk_title}</div>
                      <Badge tone={RISK_STATUS_TONE[r.status]} dot>{RISK_STATUS_LABEL[r.status]}</Badge>
                    </div>
                  ))
                )}
              </LinkedSection>

              {doc.ingest_status !== "reviewed" && (
                <button
                  onClick={onReview}
                  className="flex w-full items-center justify-center gap-1.5 rounded border border-line py-2 text-2xs font-medium text-ink-muted hover:border-positive/40 hover:text-positive"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Mark extraction reviewed
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function FindingList({
  icon: Icon, title, items, tone, mono, action,
}: {
  icon: React.ElementType;
  title: string;
  items: string[];
  tone: "neutral" | "negative" | "caution";
  mono?: boolean;
  action?: { label: string; icon: React.ElementType; onClick: (finding: string) => void };
}) {
  if (items.length === 0) return null;
  const ActionIcon = action?.icon;
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            tone === "negative" && "text-negative",
            tone === "caution" && "text-caution",
            tone === "neutral" && "text-ink-faint",
          )}
          strokeWidth={1.75}
        />
        <span className="text-2xs font-medium uppercase tracking-label text-ink-muted">{title}</span>
      </div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="group flex items-start justify-between gap-2 rounded px-2 py-1 hover:bg-surface-sunken/50">
            <span className={cn("text-xs leading-relaxed text-ink/90", mono && "tabular")}>{item}</span>
            {action && ActionIcon && (
              <button
                onClick={() => action.onClick(item)}
                className="flex shrink-0 items-center gap-0.5 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-ink-muted opacity-0 transition-opacity hover:border-gold/40 hover:text-gold-deep group-hover:opacity-100"
              >
                <ActionIcon className="h-2.5 w-2.5" /> {action.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LinkedSection({
  icon: Icon, title, count, children,
}: {
  icon: React.ElementType; title: string; count: number; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line">
      <div className="flex items-center gap-1.5 border-b border-line px-4 py-2">
        <Icon className="h-3.5 w-3.5 text-ink-faint" strokeWidth={1.75} />
        <span className="text-2xs font-medium uppercase tracking-label text-ink-muted">{title}</span>
        <span className="tabular ml-auto text-2xs text-ink-faint">{count}</span>
      </div>
      <div className="divide-y divide-line">{children}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-3 text-2xs italic text-ink-faint">{text}</p>;
}
