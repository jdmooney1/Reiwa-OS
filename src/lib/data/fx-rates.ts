// ============================================================================
// FX rates - the admin-maintained rows behind the portfolio and the memos.
// ----------------------------------------------------------------------------
// Everything runs under withSession. Reading is open to any signed-in staff (the
// portfolio needs it); writing is the database's `app.is_admin()` policy
// (migration 0025), so nothing in this file is the reason a non-admin could not
// change a rate, and nothing here could be the reason one could.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { FX_CURRENCIES, type FxRateInput } from "@/lib/fx";

export interface FxRateRecord {
  currency: string;
  rateToGbp: number;
  asOf: string;
  source: string;
  updatedAt: string | null;
  updatedByName: string | null;
}

interface Row {
  currency: string; rate_to_gbp: string; as_of_date: string; source: string;
  updated_at: string | null; updated_by_name: string | null;
}

/** The four currencies, in a fixed order. A currency with no row is simply absent. */
export async function listFxRates(session: Session): Promise<FxRateRecord[]> {
  return withSession(session, async (tx: Queryable) => {
    const { rows } = await tx.query<Row>(
      `select f.currency, f.rate_to_gbp::text, f.as_of_date::text, f.source, f.updated_at,
              coalesce(p.name, p.email) as updated_by_name
         from fx_rates f left join profiles p on p.user_id = f.updated_by
        where f.currency = any($1)`, [[...FX_CURRENCIES]]);
    const byCurrency = new Map(rows.map((r) => [r.currency, r]));
    return FX_CURRENCIES.flatMap((c) => {
      const r = byCurrency.get(c);
      return r ? [{
        currency: r.currency, rateToGbp: Number(r.rate_to_gbp), asOf: r.as_of_date, source: r.source,
        updatedAt: r.updated_at ? String(r.updated_at) : null, updatedByName: r.updated_by_name,
      }] : [];
    });
  });
}

/**
 * Record one rate. An upsert, so a currency whose row was ever removed can be put
 * back. RLS requires app.is_admin() for both halves; a non-admin gets a policy
 * violation, never a changed row.
 */
export async function saveFxRate(session: Session, input: FxRateInput): Promise<void> {
  await withSession(session, async (tx: Queryable) => {
    await tx.query(
      `insert into fx_rates (currency, rate_to_gbp, as_of_date, source, updated_by, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (currency) do update
         set rate_to_gbp = excluded.rate_to_gbp, as_of_date = excluded.as_of_date,
             source = excluded.source, updated_by = excluded.updated_by, updated_at = now()`,
      [input.currency, input.rate, input.asOf, input.source, session.userId]);
  });
}

/** Today as an ISO date in UTC. The one place the clock is read for FX. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
