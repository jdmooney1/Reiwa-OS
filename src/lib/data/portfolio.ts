// ============================================================================
// Portfolio data layer — aggregates from stored asset records (never entered).
// FX rates are read explicitly from fx_rates and the source/date is surfaced.
// ============================================================================
import { withSession, type Session } from "@/lib/db/client";
import { num } from "@/lib/data/coerce";
import { listAssetFiles } from "@/lib/data/assets";
import { portfolioAggregate, type PortfolioAggregate } from "@/lib/asset-intelligence/metrics";
import type { AssetFile } from "@/lib/asset-intelligence/types";

export interface FxContext {
  rates: Record<string, number>; // currency → rate to GBP
  source: string;
  asOf: string | null;
}

export async function getFxContext(session: Session): Promise<FxContext> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{ currency: string; rate_to_gbp: string; as_of_date: string; source: string }>(
      "select currency, rate_to_gbp, as_of_date, source from fx_rates");
    const rates: Record<string, number> = {};
    let source = "—";
    let asOf: string | null = null;
    for (const r of rows) {
      rates[r.currency] = num(r.rate_to_gbp) ?? 1;
      source = r.source;
      asOf = r.as_of_date;
    }
    if (!rates.GBP) rates.GBP = 1;
    return { rates, source, asOf };
  });
}

export interface PortfolioData {
  files: AssetFile[];
  aggregate: PortfolioAggregate;
  fx: FxContext;
}

export async function getPortfolioData(session: Session): Promise<PortfolioData> {
  const [files, fx] = await Promise.all([listAssetFiles(session), getFxContext(session)]);
  const aggregate = portfolioAggregate(files, "GBP", fx.rates);
  return { files, aggregate, fx };
}
