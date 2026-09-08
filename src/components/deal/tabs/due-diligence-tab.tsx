"use client";

import { useMemo, useState } from "react";
import {
  ShieldCheck, AlertTriangle, ChevronRight, FileText, ClipboardList, MapPin,
} from "lucide-react";
import type { Deal, DueDiligenceItem, DdStatus, DdSection } from "@/types/database";
import {
  DD_SECTIONS, DD_STATUS_LABEL, PRIORITY_LABEL, PRIORITY_TONE,
  JURISDICTION_LABEL, JURISDICTION_TONE, RISK_LEVEL_TONE, isDdIssue, isDdOpen,
} from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DD_TEMPLATES, applyTemplate, defaultTemplateId } from "@/lib/dd/templates";
import { StatusSelect } from "@/components/deal/dd/status-select";
import { StatusBar } from "@/components/deal/dd/status-bar";
import { computeProgress, criticalOpenItems } from "@/components/deal/dd/dd-progress";

export function DueDiligenceTab({
  deal,
  items: initialItems,
}: {
  deal: Deal;
  items: DueDiligenceItem[];
}) {
  const [items, setItems] = useState<DueDiligenceItem[]>(initialItems);

  if (items.length === 0) {
    return <TemplateChooser deal={deal} onApply={(id) => setItems(applyTemplate(id, deal.deal_id))} />;
  }

  const updateStatus = (itemId: string, status: DdStatus) =>
    setItems((prev) => prev.map((it) => (it.item_id === itemId ? { ...it, status } : it)));

  return <Tracker items={items} onStatus={updateStatus} />;
}

// ---------------------------------------------------------------------------
// Template chooser — applies a framework to a deal with no DD yet.
// ---------------------------------------------------------------------------
function TemplateChooser({
  deal,
  onApply,
}: {
  deal: Deal;
  onApply: (id: "london" | "amsterdam") => void;
}) {
  const recommended = defaultTemplateId(deal.market);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 text-center">
        <ClipboardList className="mx-auto h-6 w-6 text-ink-faint" strokeWidth={1.5} />
        <h3 className="mt-2 text-lg text-ink">Initiate Due Diligence</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
          Apply a Reiwa DD framework to open the standing risk-control workstreams for this deal.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Object.values(DD_TEMPLATES).map((t) => {
          const isRecommended = t.id === recommended;
          return (
            <Card
              key={t.id}
              className={cn(isRecommended && "border-line bg-purple/[0.03]")}
            >
              <CardBody className="flex h-full flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="text-base text-ink">{t.name}</div>
                  {isRecommended && <Badge tone="accent">Recommended</Badge>}
                </div>
                <p className="flex-1 text-xs leading-relaxed text-ink-muted">{t.description}</p>
                <div className="text-2xs text-ink-faint">
                  {t.items.length} workstreams · {DD_SECTIONS.length} sections
                </div>
                <button
                  onClick={() => onApply(t.id)}
                  className={cn(
                    "rounded px-3 py-2 text-xs font-medium transition-colors",
                    isRecommended
                      ? "bg-purple text-surface hover:bg-purple-70"
                      : "border border-line text-ink hover:bg-surface-sunken",
                  )}
                >
                  Apply {t.market} framework
                </button>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tracker — control summary, critical items, and section workstreams.
// ---------------------------------------------------------------------------
function Tracker({
  items,
  onStatus,
}: {
  items: DueDiligenceItem[];
  onStatus: (id: string, s: DdStatus) => void;
}) {
  const progress = useMemo(() => computeProgress(items), [items]);
  const critical = useMemo(() => criticalOpenItems(items), [items]);

  const jurisdictions = Array.from(new Set(items.map((i) => i.jurisdiction)));
  const highRiskOpen = items.filter((i) => isDdOpen(i.status) && i.priority !== "low").length;

  // Group by section in framework order.
  const grouped = DD_SECTIONS.map((section) => ({
    section,
    items: items.filter((i) => i.section === section),
  })).filter((g) => g.items.length > 0);

  // Expand sections that contain a critical-open item by default.
  const initialExpanded = new Set(
    grouped
      .filter((g) => g.items.some((i) => isDdOpen(i.status) && (isDdIssue(i.status) || i.priority === "critical" || i.priority === "high")))
      .map((g) => g.section),
  );
  const [expanded, setExpanded] = useState<Set<DdSection>>(initialExpanded);
  const toggle = (s: DdSection) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });

  return (
    <div className="space-y-6">
      {/* Control summary */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-11 w-11 items-center justify-center rounded-full",
                  progress.issues > 0 ? "bg-negative/10 text-negative" : "bg-positive/10 text-positive",
                )}
              >
                {progress.issues > 0 ? (
                  <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
                ) : (
                  <ShieldCheck className="h-5 w-5" strokeWidth={1.75} />
                )}
              </div>
              <div>
                <div className="eyebrow">Due Diligence Control</div>
                <div className="text-base text-ink">
                  {progress.issues > 0
                    ? `${progress.issues} open ${progress.issues === 1 ? "issue" : "issues"} identified`
                    : "No open issues"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <ControlStat label="Cleared" value={`${progress.cleared}/${progress.inScope}`} />
              <ControlStat label="Open" value={progress.open} tone={progress.open > 0 ? "caution" : "positive"} />
              <ControlStat label="Issues" value={progress.issues} tone={progress.issues > 0 ? "negative" : "positive"} />
              <ControlStat label="Priority Open" value={highRiskOpen} tone={highRiskOpen > 0 ? "caution" : "positive"} />
              <div className="text-right">
                <div className="eyebrow mb-0.5">Complete</div>
                <div className="tabular text-2xl text-ink">{progress.pct}%</div>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <StatusBar byStatus={progress.byStatus} height={8} />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="eyebrow mr-1">Jurisdictions</span>
            {jurisdictions.map((j) => (
              <Badge key={j} tone={JURISDICTION_TONE[j]}>
                <MapPin className="h-2.5 w-2.5" /> {JURISDICTION_LABEL[j]}
              </Badge>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Critical open items */}
      {critical.length > 0 && (
        <Card className="border-negative/30 bg-negative/[0.03]">
          <CardHeader
            eyebrow="Risk Control"
            title="Critical Open Items"
            action={
              <span className="tabular rounded bg-negative/10 px-2 py-0.5 text-2xs font-semibold text-negative">
                {critical.length}
              </span>
            }
          />
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {critical.map((it) => (
                <li key={it.item_id} className="flex items-start justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink">{it.item}</span>
                      {isDdIssue(it.status) && (
                        <Badge tone="negative" dot>Issue</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-2xs text-ink-faint">
                      {it.section} · {it.owner ?? "Unassigned"} · due {formatDate(it.due_date)}
                    </div>
                    {it.notes && <p className="mt-1 max-w-2xl text-xs text-ink-muted">{it.notes}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={PRIORITY_TONE[it.priority]}>{PRIORITY_LABEL[it.priority]}</Badge>
                    <StatusSelect status={it.status} onChange={(s) => onStatus(it.item_id, s)} />
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* Section workstreams */}
      <div className="space-y-3">
        {grouped.map(({ section, items: secItems }) => {
          const p = computeProgress(secItems);
          const isOpen = expanded.has(section);
          const hasIssue = secItems.some((i) => isDdIssue(i.status));
          return (
            <Card key={section}>
              <button
                onClick={() => toggle(section)}
                className="flex w-full items-center gap-4 px-5 py-3 text-left"
              >
                <ChevronRight
                  className={cn("h-4 w-4 shrink-0 text-ink-faint transition-transform", isOpen && "rotate-90")}
                />
                <div className="flex flex-1 items-center gap-3">
                  <span className="text-sm font-medium text-ink">{section}</span>
                  {hasIssue && <Badge tone="negative" dot>Issue</Badge>}
                </div>
                <div className="hidden w-40 sm:block">
                  <StatusBar byStatus={p.byStatus} />
                </div>
                <span className="tabular w-16 shrink-0 text-right text-2xs text-ink-faint">
                  {p.cleared}/{p.inScope}
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-line">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-line align-top">
                      {secItems.map((it) => (
                        <ItemRow key={it.item_id} item={it} onStatus={onStatus} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ItemRow({
  item,
  onStatus,
}: {
  item: DueDiligenceItem;
  onStatus: (id: string, s: DdStatus) => void;
}) {
  return (
    <tr>
      <td className="px-5 py-3">
        <div className="font-medium text-ink">{item.item}</div>
        {item.question && (
          <div className="mt-0.5 max-w-2xl text-xs leading-relaxed text-ink-muted">{item.question}</div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Badge tone={JURISDICTION_TONE[item.jurisdiction]}>{JURISDICTION_LABEL[item.jurisdiction]}</Badge>
          <Badge tone={PRIORITY_TONE[item.priority]}>{PRIORITY_LABEL[item.priority]}</Badge>
          {item.risk_level && (
            <Badge tone={RISK_LEVEL_TONE[item.risk_level]} dot>
              {item.risk_level[0].toUpperCase() + item.risk_level.slice(1)} risk
            </Badge>
          )}
          {item.linked_documents.map((doc) => (
            <span key={doc} className="inline-flex items-center gap-1 text-2xs text-ink-faint">
              <FileText className="h-3 w-3" /> {doc}
            </span>
          ))}
        </div>
        {item.notes && <p className="mt-1.5 text-2xs italic text-ink-faint">{item.notes}</p>}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right text-xs text-ink-muted">
        {item.owner ?? "—"}
        <div className="text-2xs text-ink-faint">{formatDate(item.due_date)}</div>
      </td>
      <td className="px-5 py-3 text-right">
        <StatusSelect status={item.status} onChange={(s) => onStatus(item.item_id, s)} />
      </td>
    </tr>
  );
}

function ControlStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "positive" | "caution" | "negative";
}) {
  const color =
    tone === "positive" ? "text-positive" :
    tone === "caution" ? "text-caution" :
    tone === "negative" ? "text-negative" : "text-ink";
  return (
    <div className="text-right">
      <div className="eyebrow mb-0.5">{label}</div>
      <div className={cn("tabular text-lg font-semibold", color)}>{value}</div>
    </div>
  );
}
