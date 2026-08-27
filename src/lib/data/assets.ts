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

// Row shapes from PGlite are dynamic; typed loosely at this mapping boundary.
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
    source_deal_id: r.opportunity_id ?? null, name: r.name, address: str(r.address),
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

async function assembleOne(tx: Queryable, assetRow: any): Promise<AssetFile> {
  const id = assetRow.asset_id;
  const plans = (await tx.query(`select * from business_plans where asset_id = $1 order by version`, [id])).rows.map((r: any): BusinessPlan => ({
    plan_id: r.plan_id, asset_id: id, plan_type: r.plan_type as PlanType, version: Number(r.version),
    as_of_date: r.as_of_date, label: str(r.label), ...metrics(r),
  }));
  const periods = (await tx.query(`select * from performance_periods where asset_id = $1 order by period_end`, [id])).rows.map((r: any): PerformancePeriod => ({
    period_id: r.period_id, asset_id: id, period_label: r.period_label, period_end: r.period_end,
    status: r.status as PeriodStatus, ...metrics(r),
  }));
  const valuations = (await tx.query(`select * from valuations where asset_id = $1 order by valuation_date`, [id])).rows.map((r: any): Valuation => ({
    valuation_id: r.valuation_id, asset_id: id, valuation_date: r.valuation_date, valuer: str(r.valuer),
    valuation: num(r.valuation), valuation_type: r.valuation_type as ValuationType, noi: num(r.noi),
    yield_pct: num(r.yield_pct), erv: num(r.erv), methodology: null, key_assumptions: null,
  }));
  const risks = (await tx.query(`select * from asset_risks where asset_id = $1`, [id])).rows.map((r: any): AssetRisk => ({
    risk_id: r.risk_id, asset_id: id, title: r.title, category: r.category as AssetRiskCategory,
    description: str(r.description), probability: num(r.probability), financial_impact: num(r.financial_impact),
    severity: (str(r.severity) as SeverityBand | null), mitigation: str(r.mitigation), owner: str(r.owner),
    deadline: str(r.deadline), status: r.status as RiskStatus,
  }));
  const decisions = (await tx.query(`select * from asset_decisions where asset_id = $1`, [id])).rows.map((r: any): AssetDecision => ({
    decision_id: r.decision_id, asset_id: id, title: r.title, issue: str(r.issue), background: null,
    options: null, financial_impact: num(r.financial_impact), recommendation: str(r.recommendation),
    decision_maker: str(r.decision_maker), deadline: str(r.deadline), status: r.status,
    final_decision: null, decision_date: null, rationale: null,
  }));
  return {
    asset: mapAsset(assetRow), plans, periods, valuations, risks, decisions,
    leases: [], capex: [], developments: [], milestones: [], loans: [], advisers: [], actions: [], events: [],
  };
}

export async function getAssetFile(session: Session, assetId: string): Promise<AssetFile | null> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(`${ASSET_SELECT} where a.asset_id = $1`, [assetId]);
    return rows[0] ? assembleOne(tx, rows[0]) : null;
  });
}

export async function listAssetFiles(session: Session): Promise<AssetFile[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query(`${ASSET_SELECT} order by a.name`);
    const out: AssetFile[] = [];
    for (const r of rows) out.push(await assembleOne(tx, r));
    return out;
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
