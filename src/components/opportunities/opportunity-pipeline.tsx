"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LayoutGrid, Table2 } from "lucide-react";
import type { OppStage, OppStatus } from "@/lib/data/opportunity-types";
import type { PipelineRow } from "@/lib/data/opportunity-file";
import { OPP_STAGES } from "@/lib/data/opportunity-types";
import { ASSET_TYPE_LABEL, STRATEGY_LABEL } from "@/lib/domain";
import { formatMoneyCompact, formatPct } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import {
  NO_FILTERS, applyFilters, facet, triageFacet, priorityFacet, triageProgress,
  hasActiveFilters, setFilter, type PipelineFilters, type FilterKey,
} from "@/lib/pipeline/filter";
import { TRIAGE_STATUSES, TRIAGE_PRIORITIES, type TriageStatus } from "@/lib/data/opportunity-types";
import { cn } from "@/lib/utils";
import type { AssetType, Strategy } from "@/types/database";

const STAGE_LABEL: Record<OppStage, string> = {
  new: "New", screening: "Screening", underwriting: "Underwriting", ic: "IC", approved: "Approved", acquired: "Acquired",
};
const STATUS_LABEL: Record<OppStatus, string> = {
  active: "Active", rejected: "Rejected", withdrawn: "Withdrawn", lost: "Lost", converted: "Converted", merged: "Merged",
};
const STATUS_TONE = {
  active: "positive", rejected: "negative", withdrawn: "muted", lost: "negative", converted: "accent", merged: "muted",
} as const;

const TRIAGE_LABEL: Record<TriageStatus, string> = {
  untriaged: "Untriaged", live: "Live", dead: "Dead", reference: "Reference",
};

/**
 * Where a deal stands in review. Untriaged is drawn differently in KIND, not
 * just colour - a dashed outline and muted text - so a screen of rows shows at a
 * glance which still need a look. The other three are states and get a dot.
 */
function TriageBadge({ o }: { o: PipelineRow }) {
  if (o.triageStatus === "untriaged") {
    return (
      <span title="Loaded from the pipeline sheet and not yet reviewed"
        className="inline-flex items-center rounded border border-dashed border-line-strong px-1.5 py-px text-2xs font-medium text-ink-faint">
        Untriaged
      </span>
    );
  }
  const tone = o.triageStatus === "live" ? "positive" : o.triageStatus === "dead" ? "negative" : "accent";
  return (
    <span className="inline-flex items-center gap-1.5" title={o.triageNote ?? undefined}>
      <Badge tone={tone} dot>{TRIAGE_LABEL[o.triageStatus]}</Badge>
      {o.triagePriority && <span className="tabular text-2xs font-semibold text-ink">{o.triagePriority}</span>}
    </span>
  );
}

/**
 * Figures on a pipeline row come from that opportunity's own investment case,
 * not from the projected headline columns. The projection keeps those columns
 * correct, so this is a provenance choice rather than a correctness fix: a
 * number on a card should come from the record that owns it, so that if the two
 * ever diverge the card is wrong in an obvious way rather than a plausible one.
 *
 * A row whose case is only a working draft says so. "£42.5m" and "£42.5m, not
 * yet through committee" are different statements to make in a pipeline review.
 */
export function OpportunityPipeline({ opportunities }: { opportunities: PipelineRow[] }) {
  const [view, setView] = useState<"board" | "table">("board");
  const active = useMemo(() => opportunities.filter((o) => o.status === "active" || o.status === "converted"), [opportunities]);
  const archived = useMemo(() => opportunities.filter((o) => o.status === "rejected" || o.status === "withdrawn" || o.status === "lost"), [opportunities]);

  // Filters apply WITHIN the active/archived split and the board/table toggle,
  // never instead of them. Client-side: the whole pipeline is already here.
  const [filters, setFilters] = useState<PipelineFilters>(NO_FILTERS);
  const change = (key: FilterKey, value: string) => setFilters((f) => setFilter(f, key, value));
  const shownActive = useMemo(() => applyFilters(active, filters), [active, filters]);
  const shownArchived = useMemo(() => applyFilters(archived, filters), [archived, filters]);
  // A merged record is a duplicate kept for the audit trail: it is neither on the board nor in the count of deals still to triage.
  const progress = useMemo(() => triageProgress(opportunities.filter((o) => o.status !== "merged")), [opportunities]);

  return (
    <div className="flex h-full flex-col">
      <FilterBar
        rows={opportunities} filters={filters} onChange={change} onClear={() => setFilters(NO_FILTERS)}
        shown={shownActive.length + shownArchived.length} progress={progress}
      />
      <div className="flex items-center justify-between border-b border-line px-8 py-3">
        <div className="flex items-center rounded-lg border border-line bg-surface-card p-0.5">
          {([["board", "Board", LayoutGrid], ["table", "Table", Table2]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setView(k)}
              className={cn("flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                view === k ? "bg-purple text-surface" : "text-ink-muted hover:text-ink")}>
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} /> {label}
            </button>
          ))}
        </div>
        <span className="tabular text-2xs text-ink-faint">
          {hasActiveFilters(filters)
            ? `${shownActive.length} of ${active.length} active · ${shownArchived.length} of ${archived.length} archived`
            : `${active.length} active · ${archived.length} archived`}
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        {view === "board" ? (
          <div className="flex gap-4 overflow-x-auto px-8 py-6">
            {OPP_STAGES.map((stage) => {
              const col = shownActive.filter((o) => o.stage === stage);
              return (
                <div key={stage} className="flex w-72 shrink-0 flex-col">
                  <div className="mb-3 flex items-center gap-2 border-b border-line pb-2">
                    <span className="text-xs font-semibold uppercase tracking-label text-ink">{STAGE_LABEL[stage]}</span>
                    <span className="tabular rounded bg-surface-sunken px-1.5 py-0.5 text-2xs font-medium text-ink-muted">{col.length}</span>
                  </div>
                  <div className="flex flex-1 flex-col gap-2.5">
                    {col.map((o) => <OppCard key={o.opportunityId} o={o} />)}
                    {col.length === 0 && <div className="rounded-lg border border-dashed border-line py-6 text-center text-2xs text-ink-faint">—</div>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-8 py-6">
            <OppTable rows={shownActive} filtered={hasActiveFilters(filters)} />
            {shownArchived.length > 0 && (
              <>
                <div className="eyebrow mt-8 mb-2">Archived</div>
                <OppTable rows={shownArchived} muted />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OppCard({ o }: { o: PipelineRow }) {
  return (
    <Link href={`/opportunities/${o.opportunityId}`}>
      <Card className="overflow-hidden p-0 transition-colors hover:border-line">
        {o.headlinePhotoId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/asset-photos/${o.headlinePhotoId}?variant=thumb`} alt="" loading="lazy"
            className="aspect-[16/9] w-full object-cover"
          />
        )}
        <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{o.name}</div>
            <div className="truncate text-2xs text-ink-faint">{o.city ?? "—"} · {ASSET_TYPE_LABEL[o.assetType as AssetType] ?? o.assetType}</div>
          </div>
          <Badge tone={STATUS_TONE[o.status]} dot>{STATUS_LABEL[o.status]}</Badge>
        </div>
        <div className="mt-2"><TriageBadge o={o} /></div>
        <div className="tabular mt-3 grid grid-cols-3 gap-y-2 border-t border-line pt-3 text-xs">
          <Fig label="Price" v={formatMoneyCompact(o.caseAcquisitionPrice, o.currency as "GBP")} />
          <Fig label="Entry yield" v={formatPct(o.caseEntryYieldPct, 1)} />
          <Fig label="Target IRR" v={formatPct(o.caseTargetIrr, 1)} />
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          {o.strategy
            ? <Badge tone="neutral">{STRATEGY_LABEL[o.strategy as Strategy] ?? o.strategy}</Badge>
            : <span />}
          <span className="text-2xs text-ink-faint">{basisNote(o)}</span>
        </div>
        </div>
      </Card>
    </Link>
  );
}

function Fig({ label, v }: { label: string; v: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-label text-ink-faint">{label}</div>
      <div className="mt-0.5 font-medium text-ink">{v}</div>
    </div>
  );
}

function OppTable({ rows, muted, filtered }: { rows: PipelineRow[]; muted?: boolean; filtered?: boolean }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-line", muted && "opacity-70")}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-sunken/50 text-left">
            {["Opportunity", "Location", "Type", "Strategy", "Stage", "Price", "Total cost", "Entry yield", "IRR", "Basis", "Status", "Triage"].map((h, i) => (
              <th key={h} className={cn("px-3 py-2.5 text-2xs font-medium uppercase tracking-label text-ink-faint", i >= 5 && i <= 8 && "text-right")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular divide-y divide-line">
          {rows.map((o) => (
            <tr key={o.opportunityId} className="hover:bg-purple/[0.04]">
              <td className="px-3 py-2.5"><Link href={`/opportunities/${o.opportunityId}`} className="font-medium text-ink hover:text-ink-muted">{o.name}</Link></td>
              <td className="px-3 py-2.5 text-ink-muted">{o.city ?? "—"}</td>
              <td className="px-3 py-2.5 text-ink-muted">{ASSET_TYPE_LABEL[o.assetType as AssetType] ?? o.assetType}</td>
              <td className="px-3 py-2.5 text-ink-muted">{o.strategy ? (STRATEGY_LABEL[o.strategy as Strategy] ?? o.strategy) : "—"}</td>
              <td className="px-3 py-2.5 text-ink-muted">{STAGE_LABEL[o.stage]}</td>
              <td className="px-3 py-2.5 text-right font-medium text-ink">{formatMoneyCompact(o.caseAcquisitionPrice, o.currency as "GBP")}</td>
              <td className="px-3 py-2.5 text-right text-ink-muted">{formatMoneyCompact(o.caseTotalCost, o.currency as "GBP")}</td>
              <td className="px-3 py-2.5 text-right text-ink-muted">{formatPct(o.caseEntryYieldPct, 1)}</td>
              <td className="px-3 py-2.5 text-right text-ink-muted">{formatPct(o.caseTargetIrr, 1)}</td>
              <td className="px-3 py-2.5 text-2xs text-ink-faint">{basisNote(o)}</td>
              <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[o.status]} dot>{STATUS_LABEL[o.status]}</Badge></td>
              <td className="px-3 py-2.5"><TriageBadge o={o} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={12} className="px-3 py-8 text-center text-sm text-ink-faint">{filtered ? "No opportunities match these filters." : "No opportunities."}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function FilterBar({ rows, filters, onChange, onClear, shown, progress }: {
  rows: PipelineRow[];
  filters: PipelineFilters;
  onChange: (key: FilterKey, value: string) => void;
  onClear: () => void;
  shown: number;
  progress: { total: number; untriaged: number; reviewed: number };
}) {
  const tri = triageFacet(rows, filters);
  const pri = priorityFacet(rows, filters);
  const markets = facet(rows, filters, "market");
  const types = facet(rows, filters, "assetType");
  const strategies = facet(rows, filters, "strategy");
  const counted = (label: string, n: number) => `${label} (${n})`;

  return (
    <div className="border-b border-line px-8 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Triage first: the filter most used while the pipeline is being worked through. */}
        <Select value={filters.triageStatus} onChange={(v) => onChange("triageStatus", v)} placeholder="All triage"
          options={TRIAGE_STATUSES.map((t) => ({ value: t, label: counted(TRIAGE_LABEL[t], tri[t]) }))} />
        <span title={filters.triageStatus === "live" ? undefined : "Priority is set only on live deals - choose Live to filter by it"}>
          <Select value={filters.triagePriority} onChange={(v) => onChange("triagePriority", v)} placeholder="Any priority"
            disabled={filters.triageStatus !== "live"}
            options={TRIAGE_PRIORITIES.map((p) => ({ value: p, label: counted(p, pri[p]) }))} />
        </span>
        <Select value={filters.market} onChange={(v) => onChange("market", v)} placeholder="All markets"
          options={markets.map((o) => ({ value: o.value, label: counted(o.value, o.count) }))} />
        <Select value={filters.assetType} onChange={(v) => onChange("assetType", v)} placeholder="All types"
          options={types.map((o) => ({ value: o.value, label: counted(ASSET_TYPE_LABEL[o.value as AssetType] ?? o.value, o.count) }))} />
        <Select value={filters.strategy} onChange={(v) => onChange("strategy", v)} placeholder="All strategies"
          options={strategies.map((o) => ({ value: o.value, label: counted(STRATEGY_LABEL[o.value as Strategy] ?? o.value, o.count) }))} />
        <input type="search" value={filters.query} onChange={(e) => onChange("query", e.target.value)}
          placeholder="Search name, address, broker" aria-label="Search name, address or broker"
          className="h-8 w-60 rounded border border-line bg-surface-card px-2.5 text-xs text-ink placeholder:text-ink-faint focus:border-line-strong focus:outline-none focus:ring-1 focus:ring-purple/30" />
        {hasActiveFilters(filters) && (
          <button type="button" onClick={onClear}
            className="text-xs font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline">
            Clear filters
          </button>
        )}
      </div>
      <div className="tabular mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-2xs text-ink-faint">
        <span>{hasActiveFilters(filters) ? `${shown} of ${progress.total} deals match` : `${progress.total} deals`}</span>
        {/* Everything loads untriaged, so reviewed starts at zero and only rises. */}
        <span>
          <span className="font-medium text-ink">{progress.untriaged}</span> untriaged
          {" · "}
          <span className="font-medium text-ink">{progress.reviewed}</span> reviewed
          <span> (the untriaged count should fall as the pipeline is worked through)</span>
        </span>
      </div>
    </div>
  );
}

/** Says which underwriting a row's figures came from, in three words or fewer. */
function basisNote(o: PipelineRow): string {
  if (o.caseBasis === "none") return "Not underwritten";
  return `v${o.caseVersion} ${o.caseBasis === "approved" ? "approved" : "working"}`;
}
