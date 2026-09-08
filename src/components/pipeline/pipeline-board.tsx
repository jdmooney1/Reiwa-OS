import type { DealSummary } from "@/lib/mock-data";
import { PIPELINE_STAGES, pipelineStageOf, type PipelineStage } from "@/lib/domain";
import { formatMoneyCompact } from "@/lib/format";
import { DealCard } from "./deal-card";

export function PipelineBoard({ deals }: { deals: DealSummary[] }) {
  const byStage = new Map<PipelineStage, DealSummary[]>();
  for (const stage of PIPELINE_STAGES) byStage.set(stage, []);
  for (const deal of deals) {
    byStage.get(pipelineStageOf(deal.deal_stage, deal.status))!.push(deal);
  }

  return (
    <div className="flex h-full gap-4 overflow-x-auto px-8 py-6">
      {PIPELINE_STAGES.map((stage) => {
        const column = byStage.get(stage)!;
        const value = column.reduce((s, d) => s + (d.price_guidance ?? 0), 0);
        return (
          <div key={stage} className="flex w-72 shrink-0 flex-col">
            <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-label text-ink">
                  {stage}
                </span>
                <span className="tabular rounded bg-surface-sunken px-1.5 py-0.5 text-2xs font-medium text-ink-muted">
                  {column.length}
                </span>
              </div>
              {value > 0 && (
                <span className="tabular text-2xs text-ink-faint">
                  {formatMoneyCompact(value, column[0]?.currency)}
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-2.5">
              {column.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line py-6 text-center text-2xs text-ink-faint">
                  No deals
                </div>
              ) : (
                column.map((deal) => <DealCard key={deal.deal_id} deal={deal} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
