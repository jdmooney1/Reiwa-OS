import { SlidersHorizontal } from "lucide-react";
import type { Deal, DealMetrics } from "@/types/database";
import { formatMoney, formatPct, formatMultiple } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { MetricTile } from "@/components/shared/metric-tile";
import { cn } from "@/lib/utils";

export function FinancialsTab({
  deal,
  metrics,
}: {
  deal: Deal;
  metrics: DealMetrics | null;
}) {
  if (!metrics) {
    return (
      <Card>
        <CardBody>
          <p className="py-6 text-center text-sm italic text-ink-faint">
            No underwriting model has been entered for this deal yet.
          </p>
        </CardBody>
      </Card>
    );
  }

  const cur = deal.currency;
  const inputs: { label: string; value: string }[] = [
    { label: "Purchase Price", value: formatMoney(metrics.purchase_price, cur) },
    { label: "Acquisition Costs", value: formatMoney(metrics.acquisition_costs, cur) },
    { label: "Stamp Duty / Transfer Tax", value: formatMoney(metrics.stamp_duty_or_transfer_tax, cur) },
    { label: "Capex Budget", value: formatMoney(metrics.capex, cur) },
    { label: "Total Cost", value: formatMoney(metrics.total_cost, cur) },
    { label: "Debt Amount", value: formatMoney(metrics.debt_amount, cur) },
    { label: "LTV", value: formatPct(metrics.ltv, 1) },
    { label: "Interest Rate", value: formatPct(metrics.interest_rate, 2) },
    { label: "Passing Rent", value: formatMoney(metrics.rent, cur) },
    { label: "ERV", value: formatMoney(metrics.erv, cur) },
    { label: "NOI", value: formatMoney(metrics.noi, cur) },
    { label: "Exit Yield", value: formatPct(metrics.exit_yield, 2) },
  ];

  const outputs: { label: string; value: string; sub?: string }[] = [
    { label: "Levered IRR", value: formatPct(metrics.irr, 1) },
    { label: "Equity Multiple", value: formatMultiple(metrics.equity_multiple) },
    { label: "Cash-on-Cash", value: formatPct(metrics.cash_on_cash, 1), sub: "stabilised" },
    { label: "Yield on Cost", value: formatPct(metrics.yield_on_cost, 2) },
    { label: "Exit Value", value: formatMoney(metrics.exit_value, cur) },
    { label: "NOI", value: formatMoney(metrics.noi, cur), sub: "per annum" },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Inputs */}
      <div className="lg:col-span-2">
        <Card>
          <CardHeader eyebrow="Underwriting" title="Inputs" />
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <tbody className="tabular divide-y divide-line">
                {inputs.map((row) => {
                  const emphasise = row.label === "Total Cost";
                  return (
                    <tr key={row.label} className={cn(emphasise && "bg-surface-sunken/40")}>
                      <td className="px-5 py-2.5 text-ink-muted">{row.label}</td>
                      <td className={cn("px-5 py-2.5 text-right font-medium text-ink", emphasise && "font-semibold")}>
                        {row.value}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>

      {/* Outputs + sensitivity */}
      <div className="space-y-6">
        <Card>
          <CardHeader eyebrow="Returns" title="Output Metrics" />
          <CardBody>
            <div className="grid grid-cols-2 gap-x-4 gap-y-5">
              {outputs.map((o) => (
                <MetricTile key={o.label} label={o.label} value={o.value} sub={o.sub} />
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader eyebrow="Analysis" title="Sensitivity" />
          <CardBody>
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line bg-surface-sunken/30 px-4 py-8 text-center">
              <SlidersHorizontal className="h-5 w-5 text-ink-faint" strokeWidth={1.5} />
              <div className="text-xs font-medium text-ink-muted">
                IRR sensitivity grid
              </div>
              <div className="max-w-xs text-2xs text-ink-faint">
                Exit yield × entry price and rent growth × capex scenarios. Interactive
                model to be wired to the underwriting engine.
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
