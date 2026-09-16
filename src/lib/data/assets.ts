// ============================================================================
// Assets data layer — assemble the Phase-1 AssetFile shape from the database so
// the existing overview / portfolio components are reused unchanged. RLS-scoped.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { num, str } from "@/lib/data/coerce";
import type {
  AssetFile, Asset, BusinessPlan, PerformancePeriod, Valuation, AssetRisk, AssetDecision,
  AssetMetrics, PlanType, PeriodStatus, ValuationType, AssetRiskCategory, SeverityBand,
} from "@/lib/asset-intelligence/types";
import type { RiskStatus } from "@/types/database";

// Row shapes from node-postgres are dynamic; typed loosely at this mapping boundary.
type Row = Record<string, unknown>;
const metrics = (r: Row): AssetMetrics => ({
  gross_rental_income: num(r.gross_rental_income), noi: num(r.noi),
  operating_expenses: num(r.operating_expenses), occupancy_pct: num(r.occupancy_pct),
  capex: num(r.capex), valuation: num(r.valuation), yield_pct: num(r.yield_pct),
  debt: num(r.debt), ltv_pct: num(r.ltv_pct), cash_on_cash_pct: num(r.cash_on_cash_pct),
  equity_multiple: num(r.equity_multiple), irr_pct: num(r.irr_pct),
});

function mapAsset(r: any): Asset {
  return {
    asset_id: r.asset_id, org_id: r.org_id, portfolio_id: r.portfolio_id ?? null,
    source_opportunity_id: r.opportunity_id ?? null, name: r.name, address: str(r.address),
    city: str(r.city), country: str(r.country), market: (str(r.market) as any) ?? null,
    asset_type: (r.asset_type as any) ?? "other", strategy: (str(r.strategy) as any) ?? null,
    lifecycle_stage: r.lifecycle_stage, currency: r.currency, acquisition_date: str(r.acquisition_date),
    acquisition_price: num(r.acquisition_price), equity_invested: num(r.equity_invested),
    hold_thesis: str(r.hold_thesis), is_demo: r.is_demo === true || r.is_demo === "t" || r.is_demo === "true",
  };
}

const ASSET_SELECT = `
  select a.*, p.address, p.city, p.country, p.market, p.asset_type, o.strategy
  from assets a
  left join properties p on p.property_id = a.property_id
  left join opportunities o on o.opportunity_id = a.opportunity_id`;

/** Group rows by their `asset_id`, so one batched read fans out per asset. */
function byAsset<T>(rows: Row[], map: (r: Row) => T): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const id = r.asset_id as string;
    const list = out.get(id);
    if (list) list.push(map(r));
    else out.set(id, [map(r)]);
  }
  return out;
}

/**
 * Assemble the full file for a set of assets in a FIXED number of queries.
 *
 * The previous shape ran five child queries per asset, sequentially awaited, so
 * the portfolio cost 1 + 5N round trips through the transaction pooler — three
 * seeded assets were sixteen, and thirty assets would be a hundred and fifty-one
 * with nothing overlapping. It is six now, whatever N is.
 *
 * Ordering within each collection is preserved by ordering the batched read the
 * same way the per-asset read did, and grouping is stable — so a caller receives
 * exactly the arrays it received before.
 */
async function assembleMany(tx: Queryable, assetRows: Row[]): Promise<AssetFile[]> {
  if (assetRows.length === 0) return [];
  const ids = assetRows.map((r) => r.asset_id as string);

  const [planRows, periodRows, valuationRows, riskRows, decisionRows] = await Promise.all([
    tx.query<Row>("select * from business_plans where asset_id = any($1::uuid[]) order by asset_id, version", [ids]),
    tx.query<Row>("select * from performance_periods where asset_id = any($1::uuid[]) order by asset_id, period_end", [ids]),
    tx.query<Row>("select * from valuations where asset_id = any($1::uuid[]) order by asset_id, valuation_date", [ids]),
    tx.query<Row>("select * from asset_risks where asset_id = any($1::uuid[]) order by asset_id", [ids]),
    tx.query<Row>("select * from asset_decisions where asset_id = any($1::uuid[]) order by asset_id", [ids]),
  ]);

  const plans = byAsset(planRows.rows, (r): BusinessPlan => ({
    plan_id: r.plan_id as string, asset_id: r.asset_id as string, plan_type: r.plan_type as PlanType,
    version: Number(r.version), as_of_date: r.as_of_date as string, label: str(r.label), ...metrics(r),
  }));
  const periods = byAsset(periodRows.rows, (r): PerformancePeriod => ({
    period_id: r.period_id as string, asset_id: r.asset_id as string,
    period_label: r.period_label as string, period_end: r.period_end as string,
    status: r.status as PeriodStatus, ...metrics(r),
  }));
  const valuations = byAsset(valuationRows.rows, (r): Valuation => ({
    valuation_id: r.valuation_id as string, asset_id: r.asset_id as string,
    valuation_date: r.valuation_date as string, valuer: str(r.valuer),
    valuation: num(r.valuation), valuation_type: r.valuation_type as ValuationType, noi: num(r.noi),
    yield_pct: num(r.yield_pct), erv: num(r.erv), methodology: null, key_assumptions: null,
  }));
  const risks = byAsset(riskRows.rows, (r): AssetRisk => ({
    risk_id: r.risk_id as string, asset_id: r.asset_id as string, title: r.title as string,
    category: r.category as AssetRiskCategory,
    description: str(r.description), probability: num(r.probability), financial_impact: num(r.financial_impact),
    severity: (str(r.severity) as SeverityBand | null), mitigation: str(r.mitigation), owner: str(r.owner),
    deadline: str(r.deadline), status: r.status as RiskStatus,
  }));
  const decisions = byAsset(decisionRows.rows, (r): AssetDecision => ({
    decision_id: r.decision_id as string, asset_id: r.asset_id as string, title: r.title as string,
    issue: str(r.issue), background: null,
    options: null, financial_impact: num(r.financial_impact), recommendation: str(r.recommendation),
    decision_maker: str(r.decision_maker), deadline: str(r.deadline),
    status: r.status as AssetDecision["status"],
    final_decision: null, decision_date: null, rationale: null,
  }));

  return assetRows.map((row) => {
    const id = row.asset_id as string;
    return {
      asset: mapAsset(row),
      plans: plans.get(id) ?? [],
      periods: periods.get(id) ?? [],
      valuations: valuations.get(id) ?? [],
      risks: risks.get(id) ?? [],
      decisions: decisions.get(id) ?? [],
    };
  });
}

export async function getAssetFile(session: Session, assetId: string): Promise<AssetFile | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Row>(`${ASSET_SELECT} where a.asset_id = $1`, [assetId]);
    if (!rows[0]) return null;
    return (await assembleMany(tx, rows))[0];
  });
}

export async function listAssetFiles(session: Session): Promise<AssetFile[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Row>(`${ASSET_SELECT} order by a.name`);
    return assembleMany(tx, rows);
  });
}


export async function listAssetsForNav(session: Session): Promise<{ assetId: string; name: string }[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{ asset_id: string; name: string }>("select asset_id, name from assets order by name");
    return rows.map((r) => ({ assetId: r.asset_id, name: r.name }));
  });
}

export interface NewPeriod {
  periodLabel: string;
  periodEnd: string;
  grossRentalIncome?: number | null;
  noi?: number | null;
  operatingExpenses?: number | null;
  occupancyPct?: number | null;
  capex?: number | null;
  valuation?: number | null;
  yieldPct?: number | null;
  debt?: number | null;
  ltvPct?: number | null;
  cashOnCashPct?: number | null;
}

/** Append an immutable actuals period (status closed). */
export async function addPerformancePeriod(session: Session, assetId: string, p: NewPeriod): Promise<string> {
  return withSession(session, async (tx) => {
    const org = await tx.query<{ org_id: string }>("select org_id from assets where asset_id = $1", [assetId]);
    if (!org.rows[0]) throw new Error("Asset not found or not permitted");
    const res = await tx.query<{ period_id: string }>(
      `insert into performance_periods(org_id, asset_id, period_label, period_end, status,
         gross_rental_income, noi, operating_expenses, occupancy_pct, capex, valuation, yield_pct, debt, ltv_pct, cash_on_cash_pct)
       values ($1,$2,$3,$4,'closed',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning period_id`,
      [org.rows[0].org_id, assetId, p.periodLabel, p.periodEnd, p.grossRentalIncome ?? null, p.noi ?? null,
       p.operatingExpenses ?? null, p.occupancyPct ?? null, p.capex ?? null, p.valuation ?? null,
       p.yieldPct ?? null, p.debt ?? null, p.ltvPct ?? null, p.cashOnCashPct ?? null]);
    return res.rows[0].period_id;
  });
}
