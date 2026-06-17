import { MapPin } from "lucide-react";
import type { DealSummary } from "@/lib/mock-data";
import { formatMoneyCompact } from "@/lib/format";

/** Map view placeholder — clusters deals by market until a map provider is wired in. */
export function PipelineMap({ deals }: { deals: DealSummary[] }) {
  const markets = Array.from(
    deals.reduce((map, d) => {
      const key = d.city ?? "Other";
      const entry = map.get(key) ?? { count: 0, value: 0, currency: d.currency };
      entry.count += 1;
      entry.value += d.price_guidance ?? 0;
      map.set(key, entry);
      return map;
    }, new Map<string, { count: number; value: number; currency: DealSummary["currency"] }>()),
  );

  return (
    <div className="px-8 py-6">
      <div className="relative overflow-hidden rounded-lg border border-line bg-navy">
        {/* Faint grid to suggest a map canvas */}
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative flex min-h-[420px] flex-col items-center justify-center gap-6 p-10 text-center">
          <div className="flex flex-col items-center gap-2">
            <MapPin className="h-7 w-7 text-gold" strokeWidth={1.5} />
            <div className="text-sm font-medium text-surface">Geographic view</div>
            <div className="max-w-md text-xs text-surface/50">
              Interactive map integration (Mapbox) is planned. For now, deals are
              grouped by market.
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {markets.map(([city, { count, value, currency }]) => (
              <div
                key={city}
                className="rounded-lg border border-white/10 bg-white/5 px-5 py-4 text-left"
              >
                <div className="text-sm font-medium text-surface">{city}</div>
                <div className="tabular mt-1 text-2xs text-surface/50">
                  {count} {count === 1 ? "deal" : "deals"} · {formatMoneyCompact(value, currency)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
