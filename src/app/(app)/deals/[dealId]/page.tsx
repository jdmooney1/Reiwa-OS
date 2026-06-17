import { notFound } from "next/navigation";
import { getDealFile, getNarrative } from "@/lib/mock-data";
import { DealHeader } from "@/components/deal/deal-header";
import { KeyMetricsStrip } from "@/components/deal/key-metrics-strip";
import { DealTabs } from "@/components/deal/deal-tabs";

export default function DealDetailPage({
  params,
}: {
  params: { dealId: string };
}) {
  const file = getDealFile(params.dealId);
  if (!file) notFound();
  const narrative = getNarrative(params.dealId);

  return (
    <div className="min-h-full bg-surface pb-16">
      <DealHeader deal={file.deal} score={file.score} />
      <KeyMetricsStrip deal={file.deal} />
      <DealTabs file={file} narrative={narrative} />
    </div>
  );
}
