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

/**
 * The FX rates the portfolio is valued in, and how stale they are.
 *
 * Two things here are deliberate, and both were wrong before.
 *
 * A rate that cannot be read is OMITTED rather than defaulted to 1. Parity is
 * not a safe default — it is a silent claim that a euro is a pound, applied to
 * every valuation in that currency. `portfolioAggregate()` already refuses to
 * value a portfolio whose rate is missing, for exactly this reason; a fallback
 * here would have made that refusal unreachable. A non-finite value is treated
 * the same way, because `Number("")` is 0 and `Number("x")` is NaN, and neither
 * is a rate.
 *
 * The reported `asOf` is the OLDEST date across the rates actually used, not
 * whichever row the database happened to return last. The line is a staleness
 * caveat shown beside the valuation, so it has to describe the weakest input,
 * and an unordered read made it non-deterministic between requests.
 */
/** One `fx_rates` row, as the database returns it. */
export interface FxRateRow {
  currency: string;
  rate_to_gbp: string | null;
  as_of_date: string;
  source: string;
}

/**
 * Build the FX context from rows, oldest `as_of_date` first.
 *
 * Pure, and separated from the query on purpose: the rule it encodes — never
 * invent a rate — is the kind of thing that should be provable without a
 * database standing by.
 */
export function fxContextFrom(rows: readonly FxRateRow[]): FxContext {
  const rates: Record<string, number> = {};
  const sources: string[] = [];
  let asOf: string | null = null;

  for (const r of rows) {
    const rate = num(r.rate_to_gbp);
    // `Number("")` is 0 and `Number("x")` is NaN; neither is a rate, and nor is
    // a negative one. An unusable rate is OMITTED rather than defaulted.
    if (rate === null || !Number.isFinite(rate) || rate <= 0) continue;
    rates[r.currency] = rate;
    if (!sources.includes(r.source)) sources.push(r.source);
    // Rows arrive oldest first, so the first usable one is the stalest.
    if (asOf === null) asOf = r.as_of_date;
  }

  // GBP against GBP is one by definition, not an assumption about a market.
  if (!rates.GBP) rates.GBP = 1;

  return { rates, source: sources.length === 0 ? "—" : sources.join(", "), asOf };
}

export async function getFxContext(session: Session): Promise<FxContext> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<FxRateRow>(
      "select currency, rate_to_gbp, as_of_date, source from fx_rates order by as_of_date, currency");
    return fxContextFrom(rows);
  });
}

export interface PortfolioData {
  files: AssetFile[];
  fx: FxContext;
}

/**
 * The portfolio's inputs: every asset file, and the rates to value them in.
 *
 * It does NOT aggregate. It used to, and nothing ever read the result — the one
 * caller destructures `files` and `fx`, and `PortfolioDashboard` computes the
 * aggregate itself from the same two inputs. So every request rolled up the
 * whole portfolio twice and threw one away. The aggregation lives with the
 * component that renders it; this function loads.
 */
export async function getPortfolioData(session: Session): Promise<PortfolioData> {
  const [files, fx] = await Promise.all([listAssetFiles(session), getFxContext(session)]);
  return { files, fx };
}
