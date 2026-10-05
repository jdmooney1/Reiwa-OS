// ============================================================================
// FX sync: the daily ECB pull, and the rule that it never overwrites a person.
// ----------------------------------------------------------------------------
// Two halves, kept apart so the network is never held open inside a transaction:
//
//   loadEcbRates()   fetch + parse + convert + validate. Throws on ANY problem and
//                    has written nothing: a skipped day is visible through the
//                    staleness flag, a half-written one would not be.
//   applyEcbRates()  the upserts. A row last written by a person (updated_by is
//                    set) is DEFERRED TO, not overwritten, and that is decided in
//                    the statement's own WHERE clause, so an administrator saving
//                    between our read and our write cannot be clobbered either.
//
// Every row goes through validateRateSubmission() (src/lib/fx.ts), the same gate a
// person's entry passes: source rules, GBP is 1, six decimals, no future date.
//
// The seeded "Demo static rates" rows carry no updated_by, so the first sync
// replaces them. That is the intent: they were never a person's decision.
// ============================================================================
import { adminQuery, type Queryable } from "@/lib/db/client";
import { validateRateSubmission, type FxRateInput } from "@/lib/fx";
import { ECB_AUTO_SOURCE, ECB_FEED_URL, EcbFeedError, crossRatesToGbp, parseEcbXml } from "@/lib/fx-ecb";
import { reportError } from "@/lib/errors";
import { todayUtc } from "@/lib/data/fx-rates";

export type FxDb = Pick<Queryable, "query">;

export interface LoadOptions {
  fetchImpl?: typeof fetch;
  /** ISO date the run happens on. Injected so tests do not read a clock. */
  today?: string;
  timeoutMs?: number;
}

/** Fetch the feed and return validated rows for the four currencies, or throw. */
export async function loadEcbRates(opts: LoadOptions = {}): Promise<FxRateInput[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  let xml: string;
  try {
    const res = await doFetch(ECB_FEED_URL, {
      headers: { Accept: "application/xml, text/xml" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      cache: "no-store",
    });
    if (!res.ok) throw new EcbFeedError(`The ECB feed answered ${res.status}.`);
    xml = await res.text();
  } catch (e) {
    if (e instanceof EcbFeedError) throw e;
    throw new EcbFeedError(`The ECB feed could not be fetched (${e instanceof Error ? e.message : "unknown error"}).`);
  }

  const today = opts.today ?? todayUtc();
  const rows: FxRateInput[] = [];
  for (const c of crossRatesToGbp(parseEcbXml(xml))) {
    const checked = validateRateSubmission(
      { currency: c.currency, rate: c.rateToGbp, source: ECB_AUTO_SOURCE, asOf: c.asOf }, today);
    if (!checked.ok) throw new EcbFeedError(`The ${c.currency} rate failed validation: ${checked.error}`);
    rows.push(checked.value);
  }
  return rows;
}

export interface ApplyResult {
  written: string[];
  deferred: { currency: string; reason: string }[];
}

export interface ApplyOptions {
  /** Only these currencies (the admin "use the ECB rate" button). Default: all. */
  only?: readonly string[];
  /** True only when an administrator has asked for the ECB rate to replace their own. */
  takeOverManual?: boolean;
}

export async function applyEcbRates(db: FxDb, rows: readonly FxRateInput[], opts: ApplyOptions = {}): Promise<ApplyResult> {
  const result: ApplyResult = { written: [], deferred: [] };
  const take = opts.takeOverManual === true;

  for (const r of rows) {
    if (opts.only && !opts.only.includes(r.currency)) continue;
    const { rows: done } = await db.query<{ currency: string }>(
      `insert into fx_rates (currency, rate_to_gbp, as_of_date, source, updated_by, updated_at)
       values ($1, $2, $3, $4, null, now())
       on conflict (currency) do update
         set rate_to_gbp = excluded.rate_to_gbp, as_of_date = excluded.as_of_date,
             source = excluded.source, updated_by = null, updated_at = now()
       where $5::boolean
          or (fx_rates.updated_by is null and fx_rates.as_of_date <= excluded.as_of_date)
       returning currency`,
      [r.currency, r.rate.toFixed(6), r.asOf, r.source, take]);
    if (done.length > 0) { result.written.push(r.currency); continue; }

    const { rows: cur } = await db.query<{ manual: boolean }>(
      "select updated_by is not null as manual from fx_rates where currency = $1", [r.currency]);
    result.deferred.push({
      currency: r.currency,
      reason: cur[0]?.manual
        ? "a manual override is in force"
        : "the stored rate is newer than the feed's date",
    });
  }
  return result;
}

export interface SyncOutcome {
  status: "ok" | "failed";
  asOf: string | null;
  written: string[];
  deferred: { currency: string; reason: string }[];
  error?: string;
}

/**
 * The cron's whole job. Never throws: a failure is logged with a reference and
 * returned as `failed`, with fx_rates untouched. System job, so it uses the
 * privileged connection; the person-triggered path uses the administrator's own
 * session instead (src/app/actions/fx.ts).
 */
export async function runFxSync(opts: LoadOptions = {}): Promise<SyncOutcome> {
  let rows: FxRateInput[];
  try {
    rows = await loadEcbRates(opts);
  } catch (e) {
    const ref = reportError("cron.fx-sync", e);
    return { status: "failed", asOf: null, written: [], deferred: [], error: `${e instanceof Error ? e.message : "unknown"} (ref ${ref.reference})` };
  }
  try {
    const db: FxDb = { query: async <T,>(sql: string, params?: unknown[]) => ({ rows: await adminQuery<T>(sql, params ?? []) }) };
    const applied = await applyEcbRates(db, rows);
    for (const d of applied.deferred) console.info(`[reiwa] fx-sync deferred ${d.currency}: ${d.reason}`);
    return { status: "ok", asOf: rows[0]?.asOf ?? null, ...applied };
  } catch (e) {
    const ref = reportError("cron.fx-sync.write", e);
    return { status: "failed", asOf: rows[0]?.asOf ?? null, written: [], deferred: [], error: `The rates could not be saved (ref ${ref.reference}).` };
  }
}
