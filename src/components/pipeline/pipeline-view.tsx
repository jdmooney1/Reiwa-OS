"use client";

import { useMemo, useState } from "react";
import { LayoutGrid, Table2, Map, Star, Search, X } from "lucide-react";
import type { DealSummary } from "@/lib/mock-data";
import type { AssetType, Currency, DealStage, Market, Strategy } from "@/types/database";
import {
  ASSET_TYPE_LABEL, STRATEGY_LABEL, STAGE_LABEL,
} from "@/lib/domain";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PipelineBoard } from "./pipeline-board";
import { PipelineTable } from "./pipeline-table";
import { PipelineMap } from "./pipeline-map";
import { Watchlist } from "./watchlist";

type ViewKey = "board" | "table" | "map" | "watchlist";

const VIEWS: { key: ViewKey; label: string; icon: React.ElementType }[] = [
  { key: "board", label: "Kanban", icon: LayoutGrid },
  { key: "table", label: "Table", icon: Table2 },
  { key: "map", label: "Map", icon: Map },
  { key: "watchlist", label: "Watchlist", icon: Star },
];

const PRICE_BANDS = [
  { value: "0-40", label: "Under 40m" },
  { value: "40-75", label: "40m – 75m" },
  { value: "75-120", label: "75m – 120m" },
  { value: "120-9999", label: "120m+" },
];

interface Filters {
  market: string;
  assetType: string;
  strategy: string;
  stage: string;
  minScore: string;
  priceBand: string;
  currency: string;
  search: string;
}

const EMPTY: Filters = {
  market: "", assetType: "", strategy: "", stage: "",
  minScore: "", priceBand: "", currency: "", search: "",
};

function opts<T extends string>(labels: Record<T, string>, keys: T[]) {
  return keys.map((k) => ({ value: k, label: labels[k] }));
}

export function PipelineView({ deals }: { deals: DealSummary[] }) {
  const [view, setView] = useState<ViewKey>("board");
  const [filters, setFilters] = useState<Filters>(EMPTY);

  const set = (key: keyof Filters) => (value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const filtered = useMemo(() => {
    return deals.filter((d) => {
      if (filters.market && d.market !== filters.market) return false;
      if (filters.assetType && d.asset_type !== filters.assetType) return false;
      if (filters.strategy && d.strategy !== filters.strategy) return false;
      if (filters.stage && d.deal_stage !== filters.stage) return false;
      if (filters.currency && d.currency !== filters.currency) return false;
      if (filters.minScore && (d.overall_score ?? 0) < Number(filters.minScore)) return false;
      if (filters.priceBand) {
        const [lo, hi] = filters.priceBand.split("-").map(Number);
        const price = (d.price_guidance ?? 0) / 1_000_000;
        if (price < lo || price > hi) return false;
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const hay = `${d.asset_name} ${d.city} ${d.submarket ?? ""} ${d.broker_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [deals, filters]);

  const activeFilterCount = Object.entries(filters).filter(
    ([k, v]) => k !== "search" && v !== "",
  ).length;

  const markets: Market[] = ["London", "Amsterdam", "Paris", "Berlin", "Frankfurt", "Madrid", "Milan", "Dublin"];
  const assetTypes = Object.keys(ASSET_TYPE_LABEL) as AssetType[];
  const strategies = Object.keys(STRATEGY_LABEL) as Strategy[];
  const stages = Object.keys(STAGE_LABEL) as DealStage[];
  const currencies: Currency[] = ["GBP", "EUR", "USD"];

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 border-b border-line px-8 py-3">
        <div className="flex items-center justify-between gap-4">
          {/* View switcher */}
          <div className="flex items-center rounded-lg border border-line bg-surface-card p-0.5">
            {VIEWS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={cn(
                  "flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                  view === key
                    ? "bg-navy text-surface"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                {label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative w-64">
            <label htmlFor="pipeline-search" className="sr-only">
              Search the pipeline by asset or broker
            </label>
            <Search aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <input
              id="pipeline-search"
              type="search"
              value={filters.search}
              onChange={(e) => set("search")(e.target.value)}
              placeholder="Search assets, brokers…"
              className="h-8 w-full rounded border border-line bg-surface-card pl-8 pr-2.5 text-xs text-ink placeholder:text-ink-faint focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/30"
            />
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="eyebrow mr-1">Filter</span>
          <Select value={filters.market} onChange={set("market")} placeholder="Market"
            options={markets.map((m) => ({ value: m, label: m }))} />
          <Select value={filters.assetType} onChange={set("assetType")} placeholder="Asset type"
            options={opts(ASSET_TYPE_LABEL, assetTypes)} />
          <Select value={filters.strategy} onChange={set("strategy")} placeholder="Strategy"
            options={opts(STRATEGY_LABEL, strategies)} />
          <Select value={filters.stage} onChange={set("stage")} placeholder="Stage"
            options={opts(STAGE_LABEL, stages)} />
          <Select value={filters.minScore} onChange={set("minScore")} placeholder="Min score"
            options={["5", "6", "7", "8"].map((s) => ({ value: s, label: `${s}.0+` }))} />
          <Select value={filters.priceBand} onChange={set("priceBand")} placeholder="Price range"
            options={PRICE_BANDS} />
          <Select value={filters.currency} onChange={set("currency")} placeholder="Currency"
            options={currencies.map((c) => ({ value: c, label: c }))} />
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => setFilters((f) => ({ ...EMPTY, search: f.search }))}
              className="flex items-center gap-1 rounded px-2 py-1 text-2xs font-medium text-ink-muted hover:text-negative"
            >
              <X className="h-3 w-3" /> Clear ({activeFilterCount})
            </button>
          )}
          <span className="tabular ml-auto text-2xs text-ink-faint">
            {filtered.length} of {deals.length} deals
          </span>
        </div>
      </div>

      {/* Active view */}
      <div className="flex-1 overflow-auto">
        {view === "board" && <PipelineBoard deals={filtered} />}
        {view === "table" && <PipelineTable deals={filtered} />}
        {view === "map" && <PipelineMap deals={filtered} />}
        {view === "watchlist" && <Watchlist deals={filtered} />}
      </div>
    </div>
  );
}
