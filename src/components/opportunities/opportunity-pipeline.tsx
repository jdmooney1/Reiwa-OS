"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LayoutGrid, Table2 } from "lucide-react";
import type { Opportunity, OppStage, OppStatus } from "@/lib/data/opportunity-types";
import { OPP_STAGES } from "@/lib/data/opportunity-types";
import { ASSET_TYPE_LABEL, STRATEGY_LABEL } from "@/lib/domain";
import { formatMoneyCompact, formatPct } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AssetType, Strategy } from "@/types/database";

const STAGE_LABEL: Record<OppStage, string> = {
  new: "New", screening: "Screening", underwriting: "Underwriting", ic: "IC", approved: "Approved", acquired: "Acquired",
};
const STATUS_LABEL: Record<OppStatus, string> = {
  active: "Active", rejected: "Rejected", withdrawn: "Withdrawn", lost: "Lost", converted: "Converted",
};
const STATUS_TONE = {
  active: "positive", rejected: "negative", withdrawn: "muted", lost: "negative", converted: "gold",
} as const;

export function OpportunityPipeline({ opportunities }: { opportunities: Opportunity[] }) {
  const [view, setView] = useState<"board" | "table">("board");
  const active = useMemo(() => opportunities.filter((o) => o.status === "active" || o.status === "converted"), [opportunities]);
  const archived = useMemo(() => opportunities.filter((o) => o.status === "rejected" || o.status === "withdrawn" || o.status === "lost"), [opportunities]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-8 py-3">
        <div className="flex items-center rounded-lg border border-line bg-surface-card p-0.5">
          {([["board", "Board", LayoutGrid], ["table", "Table", Table2]] as const).map(([k, label, Icon]) => (
            <button key={k} onClick={() => setView(k)}
              className={cn("flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                view === k ? "bg-navy text-surface" : "text-ink-muted hover:text-ink")}>
              <Icon className="h-3.5 w-3.5" strokeWidth={1.75} /> {label}
            </button>
          ))}
        </div>
        <span className="tabular text-2xs text-ink-faint">{active.length} active · {archived.length} archived</span>
      </div>

      <div className="flex-1 overflow-auto">
        {view === "board" ? (
          <div className="flex gap-4 overflow-x-auto px-8 py-6">
            {OPP_STAGES.map((stage) => {
              const col = active.filter((o) => o.stage === stage);
              return (
                <div key={stage} className="flex w-72 shrink-0 flex-col">
                  <div className="mb-3 flex items-center gap-2 border-b border-line pb-2">
                    <span className="text-xs font-semibold uppercase tracking-label text-ink">{STAGE_LABEL[stage]}</span>
                    <span className="tabular rounded bg-navy/5 px-1.5 py-0.5 text-2xs font-medium text-ink-muted">{col.length}</span>
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
            <OppTable rows={active} />
            {archived.length > 0 && (
              <>
                <div className="eyebrow mt-8 mb-2">Archived</div>
                <OppTable rows={archived} muted />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OppCard({ o }: { o: Opportunity }) {
  return (
    <Link href={`/opportunities/${o.opportunityId}`}>
      <Card className="p-3.5 transition-colors hover:border-gold/40">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{o.name}</div>
            <div className="truncate text-2xs text-ink-faint">{o.city ?? "—"} · {ASSET_TYPE_LABEL[o.assetType as AssetType] ?? o.assetType}</div>
          </div>
          <Badge tone={STATUS_TONE[o.status]} dot>{STATUS_LABEL[o.status]}</Badge>
        </div>
        <div className="tabular mt-3 grid grid-cols-3 gap-y-2 border-t border-line pt-3 text-xs">
          <Fig label="Price" v={formatMoneyCompact(o.targetPrice, o.currency as "GBP")} />
          <Fig label="NIY" v={formatPct(o.niy, 1)} />
          <Fig label="Target IRR" v={formatPct(o.targetIrr, 1)} />
        </div>
        {o.strategy && <div className="mt-2.5"><Badge tone="neutral">{STRATEGY_LABEL[o.strategy as Strategy] ?? o.strategy}</Badge></div>}
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

function OppTable({ rows, muted }: { rows: Opportunity[]; muted?: boolean }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-line", muted && "opacity-70")}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-sunken/50 text-left">
            {["Opportunity", "Location", "Type", "Strategy", "Stage", "Price", "NIY", "IRR", "Status"].map((h, i) => (
              <th key={h} className={cn("px-3 py-2.5 text-2xs font-medium uppercase tracking-label text-ink-faint", i >= 5 && i <= 7 && "text-right")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular divide-y divide-line">
          {rows.map((o) => (
            <tr key={o.opportunityId} className="hover:bg-gold/[0.04]">
              <td className="px-3 py-2.5"><Link href={`/opportunities/${o.opportunityId}`} className="font-medium text-ink hover:text-gold-deep">{o.name}</Link></td>
              <td className="px-3 py-2.5 text-ink-muted">{o.city ?? "—"}</td>
              <td className="px-3 py-2.5 text-ink-muted">{ASSET_TYPE_LABEL[o.assetType as AssetType] ?? o.assetType}</td>
              <td className="px-3 py-2.5 text-ink-muted">{o.strategy ? (STRATEGY_LABEL[o.strategy as Strategy] ?? o.strategy) : "—"}</td>
              <td className="px-3 py-2.5 text-ink-muted">{STAGE_LABEL[o.stage]}</td>
              <td className="px-3 py-2.5 text-right font-medium text-ink">{formatMoneyCompact(o.targetPrice, o.currency as "GBP")}</td>
              <td className="px-3 py-2.5 text-right text-ink-muted">{formatPct(o.niy, 1)}</td>
              <td className="px-3 py-2.5 text-right text-ink-muted">{formatPct(o.targetIrr, 1)}</td>
              <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[o.status]} dot>{STATUS_LABEL[o.status]}</Badge></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-ink-faint">No opportunities.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
