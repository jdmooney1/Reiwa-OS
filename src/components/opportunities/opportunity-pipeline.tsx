"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, LayoutGrid, ListChecks, Table2 } from "lucide-react";
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
  hasActiveFilters, setFilter, nonGbpHiddenByPrice, type PipelineFilters, type FilterKey,
} from "@/lib/pipeline/filter";
import { sortRows, nextSort, ariaSort, SORT_LABEL, type SortKey, type SortState } from "@/lib/pipeline/sort";
import { toQueryString, DEFAULT_VIEW, type PipelineViewState, type PipelineMode } from "@/lib/pipeline/view-state";
import { buildTriageQueue } from "@/lib/pipeline/triage";
import type { SavedView } from "@/lib/data/pipeline-views";
import type { TriageResult } from "@/lib/data/triage";
import { PriceFilter, YieldFilter } from "@/components/opportunities/pipeline-money-filters";
import { SavedViewsMenu } from "@/components/opportunities/pipeline-saved-views";
import { TriageMode } from "@/components/opportunities/pipeline-triage";
import { RemoveDealButton, RestoreDealButton } from "@/components/opportunities/remove-deal";
import { TRIAGE_STATUSES, TRIAGE_PRIORITIES, type TriageStatus } from "@/lib/data/opportunity-types";
import { cn } from "@/lib/utils";
import type { AssetType, Strategy } from "@/types/database";

const STAGE_LABEL: Record<OppStage, string> = {
  new: "New", screening: "Screening", underwriting: "Underwriting", ic: "IC", approved: "Approved", acquired: "Acquired",
};
const STATUS_LABEL: Record<OppStatus, string> = {
  active: "Active", rejected: "Rejected", withdrawn: "Withdrawn", lost: "Lost", converted: "Converted",
};
const STATUS_TONE = {
  active: "positive", rejected: "negative", withdrawn: "muted", lost: "negative", converted: "accent",
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
export function OpportunityPipeline({
  opportunities: fromServer, initialState = DEFAULT_VIEW, initialMode = "browse",
  savedViews = { available: false, views: [] }, canWrite = false,
}: {
  opportunities: PipelineRow[];
  /** The view the address bar asked for, parsed on the server. Omitted: the plain pipeline. */
  initialState?: PipelineViewState;
  initialMode?: PipelineMode;
  savedViews?: { available: boolean; views: SavedView[] };
  /** Whether this person may triage. Omitted: no, and the Triage button is not drawn. */
  canWrite?: boolean;
}) {
  // The whole view (filters, sort, board or table) is ONE value that mirrors the address bar, so a
  // filtered view can be bookmarked and shared. It is read from the URL on the server for the first
  // render (initialState) and written back with history.replaceState as the person works: no
  // navigation, no refetch, no history entry per keystroke.
  const [state, setState] = useState<PipelineViewState>(initialState);
  const [mode, setMode] = useState<PipelineMode>(initialMode);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const { filters, sort, layout: view } = state;

  useEffect(() => {
    const qs = toQueryString(state, mode);
    const path = window.location.pathname;
    const next = qs ? `${path}?${qs}` : path;
    // `null`, not window.history.state: Next treats a call carrying its own internal state as its own and does not
    // adopt the new address, so a later revalidation (every triage decision revalidates this page) would put the
    // old one back and drop the filters and the mode.
    if (next !== path + window.location.search) window.history.replaceState(null, "", next);
  }, [state, mode]);

  // Decisions made in triage mode show at once, before the server round trip is refreshed.
  const [decisions, setDecisions] = useState<Record<string, TriageResult>>({});
  // Likewise a deal just taken off the pipeline (or restored) moves between the board and the Archived list at once.
  const [statuses, setStatuses] = useState<Record<string, OppStatus>>({});
  useEffect(() => { setDecisions({}); setStatuses({}); }, [fromServer]);
  const opportunities = useMemo(
    () => fromServer.map((o) => {
      const d = decisions[o.opportunityId];
      const st = statuses[o.opportunityId];
      return d || st ? { ...o, ...(d ?? {}), ...(st ? { status: st } : {}) } : o;
    }),
    [fromServer, decisions, statuses]);

  const active = useMemo(() => opportunities.filter((o) => o.status === "active" || o.status === "converted"), [opportunities]);
  const archived = useMemo(() => opportunities.filter((o) => o.status === "rejected" || o.status === "withdrawn" || o.status === "lost"), [opportunities]);

  // Filters apply WITHIN the active/archived split and the board/table toggle,
  // never instead of them. Client-side: the whole pipeline is already here.
  const setFilters = useCallback((f: PipelineFilters) => { setState((s) => ({ ...s, filters: f })); }, []);
  const change = (key: FilterKey, value: string) => setState((s) => ({ ...s, filters: setFilter(s.filters, key, value) }));
  const patchFilters = (patch: Partial<PipelineFilters>) => setState((s) => ({ ...s, filters: { ...s.filters, ...patch } }));
  const setLayout = (layout: "board" | "table") => setState((s) => ({ ...s, layout }));
  const clickSort = (key: SortKey) => setState((s) => ({ ...s, sort: nextSort(s.sort, key) }));
  const filteredActive = useMemo(() => applyFilters(active, filters), [active, filters]);
  const shownActive = useMemo(() => sortRows(filteredActive, sort), [filteredActive, sort]);
  const shownArchived = useMemo(() => sortRows(applyFilters(archived, filters), sort), [archived, filters, sort]);
  const progress = useMemo(() => triageProgress(opportunities), [opportunities]);
  const nonGbpHidden = useMemo(() => nonGbpHiddenByPrice(opportunities, filters), [opportunities, filters]);
  const untriagedInView = useMemo(() => buildTriageQueue(shownActive).length, [shownActive]);

  // Triage steps through a SNAPSHOT of the untriaged deals in the current view, in its order.
  const [queueIds, setQueueIds] = useState<string[]>([]);
  const enterTriage = useCallback(() => {
    setQueueIds(buildTriageQueue(shownActive).map((o) => o.opportunityId));
    setMode("triage");
  }, [shownActive]);
  // Opened from a link with ?mode=triage: start in triage, once, on load.
  useEffect(() => {
    if (initialMode === "triage") enterTriage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const leaveTriage = useCallback(() => setMode("browse"), []);

  return (
    <div className="flex h-full flex-col">
      <FilterBar
        rows={opportunities} filters={filters} onChange={change} onPatch={patchFilters}
        onClear={() => { setFilters(NO_FILTERS); setActiveViewId(null); }}
        shown={shownActive.length + shownArchived.length} progress={progress} nonGbpHidden={nonGbpHidden}
        views={
          <SavedViewsMenu
            initial={savedViews.views} available={savedViews.available} state={state} activeId={activeViewId}
            onActive={setActiveViewId}
            onApply={(v) => { setState(v.state); setActiveViewId(v.viewId); }}
          />
        }
      />
      <div className="flex items-center justify-between border-b border-line px-8 py-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-lg border border-line bg-surface-card p-0.5">
            {([["board", "Board", LayoutGrid], ["table", "Table", Table2]] as const).map(([k, label, Icon]) => (
              <button key={k} onClick={() => { setLayout(k); if (mode === "triage") setMode("browse"); }}
                className={cn("flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                  view === k && mode !== "triage" ? "bg-purple text-surface" : "text-ink-muted hover:text-ink")}>
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} /> {label}
              </button>
            ))}
          </div>
          {canWrite && (
            <button type="button" onClick={enterTriage} disabled={untriagedInView === 0 && mode !== "triage"} data-action="enter-triage"
              title={untriagedInView === 0 ? "Nothing untriaged in this view" : "Step through the untriaged deals in this view, one at a time"}
              className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50",
                mode === "triage" ? "border-purple bg-purple text-surface" : "border-line bg-surface-card text-ink-muted hover:text-ink")}>
              <ListChecks className="h-3.5 w-3.5" strokeWidth={1.75} />
              Triage <span className="tabular text-2xs opacity-80">({untriagedInView})</span>
            </button>
          )}
        </div>
        <span className="tabular text-2xs text-ink-faint">
          {hasActiveFilters(filters)
            ? `${shownActive.length} of ${active.length} active · ${shownArchived.length} of ${archived.length} archived`
            : `${active.length} active · ${archived.length} archived`}
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        {mode === "triage" ? (
          <TriageMode
            queueIds={queueIds} rows={opportunities} onExit={leaveTriage}
            onDecided={(id, r) => setDecisions((d) => ({ ...d, [id]: r }))}
            onUndone={(id) => setDecisions((d) => ({ ...d, [id]: { triageStatus: "untriaged", triagePriority: null, triageNote: null } }))}
          />
        ) : view === "board" ? (
          <div className="flex gap-4 overflow-x-auto px-8 py-6">
            {OPP_STAGES.map((stage) => {
              const col = filteredActive.filter((o) => o.stage === stage);
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
            <OppTable rows={shownActive} filtered={hasActiveFilters(filters)} sort={sort} onSort={clickSort}
              canWrite={canWrite} onRemoved={(id, st) => setStatuses((s) => ({ ...s, [id]: st }))} onRestored={(id) => setStatuses((s) => ({ ...s, [id]: "active" }))} />
            {shownArchived.length > 0 && (
              <>
                <div className="eyebrow mt-8 mb-2">Archived</div>
                <OppTable rows={shownArchived} muted sort={sort} onSort={clickSort}
                  canWrite={canWrite} onRemoved={(id, st) => setStatuses((s) => ({ ...s, [id]: st }))} onRestored={(id) => setStatuses((s) => ({ ...s, [id]: "active" }))} />
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

/** The four columns that sort, and the key each one sorts by. */
const SORTABLE_HEADER: Record<string, SortKey> = { Price: "price", "Total cost": "totalCost", "Entry yield": "entryYield", IRR: "irr" };
const SORT_TITLE: Record<SortKey, string> = {
  price: "Sort by price: highest first, then lowest first, then the original order. Pound deals only; other currencies and blanks come last.",
  totalCost: "Sort by total cost: highest first, then lowest first, then the original order. Pound deals only; other currencies and blanks come last.",
  entryYield: "Sort by entry yield: highest first, then lowest first, then the original order. Blanks come last.",
  irr: "Sort by IRR: highest first, then lowest first, then the original order. Blanks come last.",
};

function OppTable({ rows, muted, filtered, sort, onSort, canWrite, onRemoved, onRestored }: {
  rows: PipelineRow[]; muted?: boolean; filtered?: boolean; sort: SortState | null; onSort: (key: SortKey) => void;
  canWrite: boolean; onRemoved: (id: string, status: OppStatus) => void; onRestored: (id: string) => void;
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-line", muted && "opacity-70")}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-sunken/50 text-left">
            {["Opportunity", "Location", "Type", "Strategy", "Stage", "Price", "Total cost", "Entry yield", "IRR", "Basis", "Status", "Triage"].map((h, i) => {
              const key = SORTABLE_HEADER[h];
              const right = i >= 5 && i <= 8;
              return (
                <th key={h} scope="col" aria-sort={key ? ariaSort(sort, key) : undefined}
                  className={cn("px-3 py-2.5 text-2xs font-medium uppercase tracking-label text-ink-faint", right && "text-right")}>
                  {key ? (
                    <button type="button" onClick={() => onSort(key)} title={SORT_TITLE[key]} data-sort={key}
                      className={cn("inline-flex items-center gap-1 uppercase tracking-label hover:text-ink", sort?.key === key && "text-ink")}>
                      {SORT_LABEL[key]}
                      {sort?.key === key
                        ? (sort.dir === "desc" ? <ArrowDown className="h-3 w-3" aria-hidden="true" /> : <ArrowUp className="h-3 w-3" aria-hidden="true" />)
                        : <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />}
                    </button>
                  ) : h}
                </th>
              );
            })}
            {canWrite && <th scope="col" className="px-3 py-2.5"><span className="sr-only">Actions</span></th>}
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
              {canWrite && (
                <td className="px-3 py-2.5 text-right">
                  {o.status === "active" && <RemoveDealButton compact opportunityId={o.opportunityId} name={o.name} onDone={(st) => onRemoved(o.opportunityId, st)} />}
                  {(o.status === "rejected" || o.status === "withdrawn" || o.status === "lost") && (
                    <RestoreDealButton compact opportunityId={o.opportunityId} onDone={() => onRestored(o.opportunityId)} />
                  )}
                </td>
              )}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={13} className="px-3 py-8 text-center text-sm text-ink-faint">{filtered ? "No opportunities match these filters." : "No opportunities."}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function FilterBar({ rows, filters, onChange, onPatch, onClear, shown, progress, nonGbpHidden, views }: {
  rows: PipelineRow[];
  filters: PipelineFilters;
  onChange: (key: FilterKey, value: string) => void;
  onPatch: (patch: Partial<PipelineFilters>) => void;
  onClear: () => void;
  shown: number;
  progress: { total: number; untriaged: number; reviewed: number };
  nonGbpHidden: number;
  views: React.ReactNode;
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
        <span className="ml-auto">{views}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2">
        <PriceFilter filters={filters} onPatch={onPatch} nonGbpHidden={nonGbpHidden} />
        <YieldFilter filters={filters} onPatch={onPatch} />
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
