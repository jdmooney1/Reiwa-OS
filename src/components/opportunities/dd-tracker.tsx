"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, ClipboardList, ShieldCheck } from "lucide-react";
import type { DdItem, DdStatus } from "@/lib/data/deal-file-types";
import {
  DD_STATUS_ORDER, computeProgress, criticalOpenItems, isDdIssue,
} from "@/lib/data/deal-file-types";
import {
  DD_STATUS_LABEL, DD_STATUS_TONE, DD_STATUS_COLOR,
  PRIORITY_LABEL, PRIORITY_TONE, JURISDICTION_LABEL,
} from "@/lib/dd/labels";
import { DD_TEMPLATES, defaultTemplateId, type DdTemplateId } from "@/lib/dd/templates";
import { applyDdTemplateAction, setDdStatusAction } from "@/app/actions/deal-file";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/domain";

export function DdTracker({
  opportunityId, market, items, canWrite,
}: {
  opportunityId: string;
  market: string | null;
  items: DdItem[];
  canWrite: boolean;
}) {
  if (items.length === 0) {
    return <FrameworkChooser opportunityId={opportunityId} market={market} canWrite={canWrite} />;
  }
  return <Tracker opportunityId={opportunityId} items={items} canWrite={canWrite} />;
}

// ---------------------------------------------------------------------------
// Framework chooser — shown until a market framework has been instantiated.
// ---------------------------------------------------------------------------
function FrameworkChooser({
  opportunityId, market, canWrite,
}: {
  opportunityId: string;
  market: string | null;
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const recommended = defaultTemplateId(market);

  return (
    <div className="mx-auto max-w-3xl py-2">
      <div className="mb-5 text-center">
        <ClipboardList className="mx-auto h-6 w-6 text-ink-muted" strokeWidth={1.5} />
        <h3 className="display mt-2 text-lg text-ink">Initiate Due Diligence</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
          Apply a Reiwa framework to open the standing risk-control workstreams for
          this opportunity. Every line becomes an owned, status-tracked item.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Object.values(DD_TEMPLATES).map((t) => {
          const isRecommended = t.id === recommended;
          return (
            <Card key={t.id} className={cn(isRecommended && "border-plum/30 bg-plum/[0.03]")}>
              <CardBody className="flex h-full flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="display text-base text-ink">{t.name}</div>
                  {isRecommended && <Badge tone="emphasis">Recommended</Badge>}
                </div>
                <p className="flex-1 text-xs leading-relaxed text-ink-muted">{t.description}</p>
                <div className="text-2xs text-ink-muted">{t.items.length} workstreams</div>
                <button
                  disabled={!canWrite || pending}
                  onClick={() => start(() => applyDdTemplateAction(opportunityId, t.id as DdTemplateId))}
                  className={cn(
                    "rounded px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50",
                    isRecommended
                      ? "bg-plum text-surface hover:bg-plum-50"
                      : "border border-line text-ink-muted hover:border-plum/30 hover:text-ink",
                  )}
                >
                  {pending ? "Applying…" : `Apply ${t.name}`}
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
// Tracker
// ---------------------------------------------------------------------------
function Tracker({
  opportunityId, items, canWrite,
}: {
  opportunityId: string;
  items: DdItem[];
  canWrite: boolean;
}) {
  const [sectionFilter, setSectionFilter] = useState<string>("");
  const progress = useMemo(() => computeProgress(items), [items]);
  const critical = useMemo(() => criticalOpenItems(items), [items]);

  const sections = useMemo(() => {
    const seen: string[] = [];
    for (const it of items) if (!seen.includes(it.section)) seen.push(it.section);
    return seen;
  }, [items]);

  const visible = sectionFilter
    ? items.filter((it) => it.section === sectionFilter)
    : items;

  return (
    <div className="space-y-5">
      {/* Progress */}
      <Card>
        <CardHeader
          eyebrow="Risk control"
          title="Due Diligence Progress"
          action={
            <div className="tabular text-right">
              <div className="display text-xl text-ink">{progress.pct}%</div>
              <div className="text-2xs text-ink-muted">
                {progress.cleared} of {progress.inScope} cleared
              </div>
            </div>
          }
        />
        <CardBody className="space-y-3">
          <StatusBar byStatus={progress.byStatus} />
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-2xs text-ink-muted">
            {DD_STATUS_ORDER.filter((s) => progress.byStatus[s] > 0).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: DD_STATUS_COLOR[s] }} />
                {DD_STATUS_LABEL[s]} · {progress.byStatus[s]}
              </span>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* Critical open items */}
      {critical.length > 0 && (
        <Card>
          <CardHeader
            eyebrow="Attention"
            title={
              <span className="inline-flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-flag" strokeWidth={1.75} />
                Critical Open Items
              </span>
            }
          />
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {critical.slice(0, 6).map((it) => (
                <li key={it.itemId} className="flex items-start justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <div className="text-sm text-ink">{it.item}</div>
                    <div className="mt-0.5 text-2xs text-ink-muted">{it.section}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={PRIORITY_TONE[it.priority]}>{PRIORITY_LABEL[it.priority]}</Badge>
                    {isDdIssue(it.status) && <Badge tone="negative" dot>Issue</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* Workstreams */}
      <Card>
        <CardHeader
          eyebrow="Workstreams"
          title={
            <span className="inline-flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
              {visible.length} item{visible.length === 1 ? "" : "s"}
            </span>
          }
          action={
            <select
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
              className="h-8 rounded border border-line bg-surface-card px-2 text-xs text-ink focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20"
            >
              <option value="">All sections</option>
              {sections.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          }
        />
        <CardBody className="p-0">
          <ul className="divide-y divide-line">
            {visible.map((it) => (
              <li key={it.itemId} className="px-5 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink">{it.item}</div>
                    {it.question && (
                      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{it.question}</p>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs text-ink-muted">
                      <span>{it.section}</span>
                      <span aria-hidden>·</span>
                      <span>{JURISDICTION_LABEL[it.jurisdiction]}</span>
                      <span aria-hidden>·</span>
                      <span>{PRIORITY_LABEL[it.priority]} priority</span>
                      {it.owner && (<><span aria-hidden>·</span><span>{it.owner}</span></>)}
                    </div>
                  </div>
                  <StatusSelect
                    status={it.status}
                    disabled={!canWrite}
                    onChange={(status) => setDdStatusAction(opportunityId, it.itemId, status)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StatusBar({ byStatus }: { byStatus: Record<DdStatus, number> }) {
  const total = DD_STATUS_ORDER.reduce((s, k) => s + byStatus[k], 0);
  if (total === 0) return <div className="h-1.5 rounded-full bg-surface-sunken" />;
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-sunken">
      {DD_STATUS_ORDER.map((s) => {
        const n = byStatus[s];
        if (n === 0) return null;
        return (
          <div
            key={s}
            title={`${DD_STATUS_LABEL[s]}: ${n}`}
            style={{ width: `${(n / total) * 100}%`, backgroundColor: DD_STATUS_COLOR[s] }}
          />
        );
      })}
    </div>
  );
}

const TONE_TEXT: Record<Tone, string> = {
  positive: "text-positive", caution: "text-caution", negative: "text-negative",
  emphasis: "text-plum", neutral: "text-ink", muted: "text-ink-muted",
};

function StatusSelect({
  status, disabled, onChange,
}: {
  status: DdStatus;
  disabled: boolean;
  onChange: (status: DdStatus) => void;
}) {
  const [pending, start] = useTransition();
  return (
    <select
      value={status}
      disabled={disabled || pending}
      onChange={(e) => {
        const next = e.target.value as DdStatus;
        start(() => { void onChange(next); });
      }}
      className={cn(
        "h-7 shrink-0 cursor-pointer rounded border border-line bg-surface-card px-2 text-2xs font-medium",
        "focus:border-plum focus:outline-none focus:ring-1 focus:ring-plum/20 disabled:opacity-60",
        TONE_TEXT[DD_STATUS_TONE[status]],
      )}
    >
      {DD_STATUS_ORDER.map((s) => (
        <option key={s} value={s} className="text-ink">{DD_STATUS_LABEL[s]}</option>
      ))}
    </select>
  );
}
