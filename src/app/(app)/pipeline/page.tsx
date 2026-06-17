import { Plus } from "lucide-react";
import { getDeals } from "@/lib/mock-data";
import { PageHeader } from "@/components/layout/page-header";
import { PipelineView } from "@/components/pipeline/pipeline-view";
import { formatMoneyCompact } from "@/lib/format";

export default function PipelinePage() {
  const deals = getDeals();
  const active = deals.filter((d) => d.status === "active");
  const gbp = active.filter((d) => d.currency === "GBP").reduce((s, d) => s + (d.price_guidance ?? 0), 0);
  const eur = active.filter((d) => d.currency === "EUR").reduce((s, d) => s + (d.price_guidance ?? 0), 0);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        eyebrow="Investment Desk"
        title="Deal Pipeline"
        description={`${active.length} active opportunities · ${formatMoneyCompact(gbp, "GBP")} + ${formatMoneyCompact(eur, "EUR")} under consideration`}
        actions={
          <button className="flex items-center gap-1.5 rounded bg-navy px-3.5 py-2 text-xs font-medium text-surface transition-colors hover:bg-navy-50">
            <Plus className="h-3.5 w-3.5" /> New Deal
          </button>
        }
      />
      <div className="min-h-0 flex-1">
        <PipelineView deals={deals} />
      </div>
    </div>
  );
}
