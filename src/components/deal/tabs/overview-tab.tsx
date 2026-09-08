import { HelpCircle } from "lucide-react";
import type { Deal } from "@/types/database";
import type { DealNarrative } from "@/lib/mock-data";
import { ASSET_TYPE_LABEL, STRATEGY_LABEL } from "@/lib/domain";
import { formatArea, formatMoneyCompact } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/card";

export function OverviewTab({
  deal,
  narrative,
}: {
  deal: Deal;
  narrative?: DealNarrative;
}) {
  const facts: { label: string; value: string }[] = [
    { label: "Address", value: deal.address ?? "—" },
    { label: "Submarket", value: deal.submarket ?? "—" },
    { label: "Asset Type", value: ASSET_TYPE_LABEL[deal.asset_type] },
    { label: "Strategy", value: deal.strategy ? STRATEGY_LABEL[deal.strategy] : "—" },
    { label: "Size", value: formatArea(deal.size_sqft, "sqft") },
    { label: "Size (metric)", value: formatArea(deal.size_sqm, "sqm") },
    { label: "Guide Price", value: formatMoneyCompact(deal.price_guidance, deal.currency) },
    { label: "Vendor", value: deal.vendor_name ?? "—" },
    { label: "Broker", value: deal.broker_name ?? "—" },
    { label: "Source", value: deal.source ?? "—" },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Left: Asset snapshot */}
      <div className="lg:col-span-1">
        <Card>
          <CardHeader eyebrow="Asset" title="Asset Snapshot" />
          <CardBody className="p-0">
            <dl className="divide-y divide-line">
              {facts.map((f) => (
                <div key={f.label} className="flex items-baseline justify-between gap-4 px-5 py-2.5">
                  <dt className="text-2xs uppercase tracking-label text-ink-faint">{f.label}</dt>
                  <dd className="tabular text-right text-sm text-ink">{f.value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      </div>

      {/* Right: narrative */}
      <div className="space-y-6 lg:col-span-2">
        <Prose eyebrow="Thesis" title="Investment Thesis" body={narrative?.thesis} />
        <Prose eyebrow="Rationale" title="Strategic Rationale" body={narrative?.strategicRationale} />

        <Card>
          <CardHeader eyebrow="Execution" title="Business Plan" />
          <CardBody>
            {narrative?.businessPlan ? (
              <ol className="space-y-3">
                {narrative.businessPlan.map((step, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="tabular mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-2xs font-semibold text-ink-muted">
                      {i + 1}
                    </span>
                    <span className="text-sm leading-relaxed text-ink">{step}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty />
            )}
          </CardBody>
        </Card>

        <Prose eyebrow="Market" title="Market Position" body={narrative?.marketPosition} />
        <Prose eyebrow="Japan" title="Japan Investor Rationale" body={narrative?.japanRationale} accent />

        <Card>
          <CardHeader eyebrow="Diligence" title="Key Open Questions" />
          <CardBody>
            {narrative?.openQuestions ? (
              <ul className="space-y-2.5">
                {narrative.openQuestions.map((q, i) => (
                  <li key={i} className="flex gap-2.5">
                    <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-caution" strokeWidth={1.75} />
                    <span className="text-sm leading-relaxed text-ink">{q}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Prose({
  eyebrow,
  title,
  body,
  accent = false,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  accent?: boolean;
}) {
  return (
    <Card className={accent ? "border-line bg-purple/[0.03]" : undefined}>
      <CardHeader eyebrow={eyebrow} title={title} />
      <CardBody>
        {body ? (
          <p className="text-sm leading-relaxed text-ink/90">{body}</p>
        ) : (
          <Empty />
        )}
      </CardBody>
    </Card>
  );
}

function Empty() {
  return (
    <p className="text-sm italic text-ink-faint">
      Not yet authored for this deal.
    </p>
  );
}
