// ============================================================================
// Deal assessments - the data layer over `deal_assessments` (0036).
// ----------------------------------------------------------------------------
// READ THE DEAL, APPEND A RUN, LIST RUNS. That is the whole surface. Nothing in
// this file writes to investment_cases, opportunities or properties: an
// assessment reads the underwriting and records what it found next to it.
//
// The case read is the CURRENT version, or the latest when none is current, so
// a run always names exactly which version it assessed.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { num, str } from "@/lib/data/coerce";
import { staffNamesOn, nameOf, type NameDirectory } from "@/lib/data/directory";
import { convertViaGbp } from "@/lib/fx";
import type { DealFacts, InputLine, Tier } from "@/lib/underwrite/inputs";
import { parseAssessment, type Assessment, type Verdict } from "@/lib/underwrite/assessment";
import { fromStorable, type Report } from "@/lib/underwrite/report";

export interface DealContext {
  orgId: string;
  facts: DealFacts;
  sourceFacts: Record<string, unknown>;
  dataCompleteness: string | null;
  thesis: string | null;
  businessPlan: string | null;
}

export async function loadDealContextOn(tx: Queryable, opportunityId: string): Promise<DealContext | null> {
  const { rows } = await tx.query<Record<string, any>>(
    `select o.opportunity_id, o.org_id, o.name, o.market, o.asset_type, o.currency, o.size_sqft,
            o.target_price, o.niy, o.passing_rent, o.erv, o.capex_budget,
            o.source_facts, o.data_completeness,
            p.tenure, p.unexpired_term_years, p.ground_rent_pa, p.ground_rent_note,
            p.wault_to_expiry_years, p.wault_to_breaks_years, p.rent_review_mechanism, p.epc_rating
       from opportunities o
       left join properties p on p.property_id = o.property_id
      where o.opportunity_id = $1`, [opportunityId]);
  const o = rows[0];
  if (!o) return null;

  const cases = await tx.query<Record<string, any>>(
    `select * from investment_cases where opportunity_id = $1
      order by (status = 'current') desc, version desc limit 1`, [opportunityId]);
  const c = cases.rows[0] ?? null;

  // RLS decides whether this session may read rates; an empty result is "no rate", not an error.
  const fx = await tx.query<{ currency: string; rate_to_gbp: string; as_of_date: string; source: string }>(
    "select currency, rate_to_gbp::text, as_of_date::text, source from fx_rates where currency = any($1)",
    [[o.currency, "JPY"]]);
  const rate = (ccy: string) => (ccy === "GBP" ? 1 : num(fx.rows.find((r) => r.currency === ccy)?.rate_to_gbp));
  const jpy = fx.rows.find((r) => r.currency === "JPY");
  const yenPerUnit = convertViaGbp(1, rate(o.currency), rate("JPY"));

  const facts: DealFacts = {
    name: o.name, market: str(o.market), assetType: o.asset_type, currency: o.currency, sizeSqft: num(o.size_sqft),
    opportunity: {
      targetPrice: num(o.target_price), niy: num(o.niy), passingRent: num(o.passing_rent),
      erv: num(o.erv), capexBudget: num(o.capex_budget),
    },
    property: {
      tenure: str(o.tenure), unexpiredTermYears: num(o.unexpired_term_years),
      groundRentPa: num(o.ground_rent_pa), groundRentNote: str(o.ground_rent_note),
      waultToExpiryYears: num(o.wault_to_expiry_years), waultToBreaksYears: num(o.wault_to_breaks_years),
      rentReviewMechanism: str(o.rent_review_mechanism), epcRating: str(o.epc_rating),
    },
    case: c ? {
      caseId: c.case_id, version: Number(c.version),
      acquisitionPrice: num(c.acquisition_price), acquisitionCosts: num(c.acquisition_costs),
      acquisitionDate: c.acquisition_date ? new Date(c.acquisition_date).toISOString().slice(0, 10) : null,
      capex: num(c.capex), grossRentalIncome: num(c.gross_rental_income), noi: num(c.noi), erv: num(c.erv),
      occupancyPct: num(c.occupancy_pct), debt: num(c.debt), ltvPct: num(c.ltv_pct), debtCostPct: num(c.debt_cost_pct),
      entryYieldPct: num(c.entry_yield_pct), exitYieldPct: num(c.exit_yield_pct), holdPeriodYears: num(c.hold_period_years),
      assumptions: (c.assumptions ?? {}) as Record<string, unknown>,
    } : null,
    fx: yenPerUnit !== null && jpy ? { yenPerUnit, asOf: jpy.as_of_date, source: jpy.source } : null,
  };
  return {
    orgId: o.org_id, facts,
    sourceFacts: (o.source_facts ?? {}) as Record<string, unknown>,
    dataCompleteness: str(o.data_completeness),
    thesis: c ? str(c.thesis) : null,
    businessPlan: c ? str(c.business_plan_assumptions) : null,
  };
}

export async function loadDealContext(session: Session, opportunityId: string): Promise<DealContext | null> {
  return withSession(session, (tx) => loadDealContextOn(tx, opportunityId));
}

export interface StoredAssessment {
  assessmentId: string;
  opportunityId: string;
  caseId: string | null;
  caseVersion: number | null;
  tier: Tier;
  engineVersion: number;
  inputs: InputLine[];
  report: Report | null;
  assessment: Assessment | null;
  model: string | null;
  verdict: Verdict | null;
  createdByName: string | null;
  createdAt: string;
}

export interface NewAssessment {
  orgId: string;
  opportunityId: string;
  caseId: string | null;
  tier: Tier;
  engineVersion: number;
  inputs: InputLine[];
  results: unknown;
  assessment: Assessment | null;
  model: string | null;
}

function mapRow(r: Record<string, any>, names: NameDirectory): StoredAssessment {
  const assessment = r.assessment ? parseAssessment(r.assessment) : null;
  return {
    assessmentId: r.assessment_id, opportunityId: r.opportunity_id, caseId: r.case_id ?? null,
    caseVersion: r.case_version != null ? Number(r.case_version) : null,
    tier: r.tier, engineVersion: Number(r.engine_version),
    inputs: Array.isArray(r.inputs) ? r.inputs as InputLine[] : [],
    report: fromStorable(r.results),
    assessment, model: r.model ?? null, verdict: (r.verdict ?? null) as Verdict | null,
    createdByName: nameOf(names, r.created_by ?? null),
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const SELECT = `select a.*, c.version as case_version from deal_assessments a
  left join investment_cases c on c.case_id = a.case_id`;

/** Record one run. Returns the stored row, so the page shows what was written. */
export async function recordAssessment(session: Session, input: NewAssessment): Promise<StoredAssessment> {
  return withSession(session, (tx) => recordAssessmentOn(tx, session.userId, input));
}

/** The same insert inside a caller's transaction (the bulk script runs many in one). */
export async function recordAssessmentOn(tx: Queryable, userId: string, input: NewAssessment): Promise<StoredAssessment> {
  {
    const { rows } = await tx.query<{ assessment_id: string }>(
      `insert into deal_assessments
         (org_id, opportunity_id, case_id, tier, engine_version, inputs, results, assessment, model, verdict, created_by)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11)
       returning assessment_id`,
      [input.orgId, input.opportunityId, input.caseId, input.tier, input.engineVersion,
        JSON.stringify(input.inputs), JSON.stringify(input.results),
        input.assessment ? JSON.stringify(input.assessment) : null,
        input.model, input.assessment?.verdict ?? null, userId]);
    const back = await tx.query<Record<string, any>>(`${SELECT} where a.assessment_id = $1`, [rows[0].assessment_id]);
    const names = await staffNamesOn(tx, [back.rows[0].created_by]);
    return mapRow(back.rows[0], names);
  }
}

/** Runs for one opportunity, newest first. */
export async function listAssessments(session: Session, opportunityId: string, limit = 20): Promise<StoredAssessment[]> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<Record<string, any>>(
      `${SELECT} where a.opportunity_id = $1 order by a.created_at desc limit $2`, [opportunityId, limit]);
    const names = await staffNamesOn(tx, rows.map((r) => r.created_by));
    return rows.map((r) => mapRow(r, names));
  });
}
