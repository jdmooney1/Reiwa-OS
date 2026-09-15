// ============================================================================
// Opportunity → Asset conversion (the critical lifecycle bridge).
// ----------------------------------------------------------------------------
// Creates, atomically and with references (not duplication):
//   approved investment_case (immutable) → transaction (immutable) → asset →
//   underwriting business_plan v1 (immutable baseline), and marks the
//   opportunity acquired/converted. Idempotent: a second call returns the
//   asset already created for that opportunity.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";

export interface ConvertOptions {
  acquisitionDate?: string | null; // defaults to current_date
  equityInvested?: number | null;
  debt?: number | null;
}

export async function convertToAsset(
  session: Session, opportunityId: string, opts: ConvertOptions = {},
): Promise<{ assetId: string; alreadyExisted: boolean }> {
  return withSession(session, async (tx: Queryable) => {
    const existing = await tx.query<{ asset_id: string }>(
      "select asset_id from assets where opportunity_id = $1", [opportunityId]);
    if (existing.rows[0]) return { assetId: existing.rows[0].asset_id, alreadyExisted: true };

    const oppRes = await tx.query<Record<string, unknown>>(
      "select * from opportunities where opportunity_id = $1", [opportunityId]);
    const opp = oppRes.rows[0];
    if (!opp) throw new Error("Opportunity not found or not permitted");
    if (opp.stage !== "approved" && opp.stage !== "acquired") {
      throw new Error(`Opportunity must be Approved before conversion (stage: ${opp.stage})`);
    }

    const orgId = opp.org_id as string;
    const acqDate = opts.acquisitionDate ?? null;

    // The approved underwriting. Normally it already exists, because recording
    // an IC decision is what approves one; conversion only falls back when an
    // opportunity reached `approved` without going through committee in this
    // system (a legacy row, or a seeded fixture).
    let caseId: string;
    const caseRes = await tx.query<{ case_id: string }>(
      "select case_id from investment_cases where opportunity_id = $1 and status = 'approved' order by version desc limit 1",
      [opportunityId]);
    if (caseRes.rows[0]) {
      caseId = caseRes.rows[0].case_id;
    } else {
      // Prefer the working version's own figures over the opportunity's
      // projected headline columns: the case is the authoritative record, and
      // it carries fields (costs, debt, occupancy, exit) the projection drops.
      const working = await tx.query<Record<string, any>>(
        `select * from investment_cases where opportunity_id = $1
          order by (status = 'current') desc, version desc limit 1`, [opportunityId]);
      const w = working.rows[0];

      // Column and value are written as one pair so the two lists cannot drift
      // out of step — which they did, silently, when they were two literals.
      const carried: [string, unknown][] = [
        ["acquisition_price", w?.acquisition_price ?? opp.target_price ?? null],
        ["acquisition_costs", w?.acquisition_costs ?? null],
        ["noi", w?.noi ?? null],
        ["gross_rental_income", w?.gross_rental_income ?? opp.passing_rent ?? null],
        ["erv", w?.erv ?? opp.erv ?? null],
        ["capex", w?.capex ?? opp.capex_budget ?? null],
        ["equity", w?.equity ?? null],
        ["debt", w?.debt ?? null],
        ["ltv_pct", w?.ltv_pct ?? null],
        ["valuation", w?.valuation ?? w?.acquisition_price ?? opp.target_price ?? null],
        ["exit_value", w?.exit_value ?? null],
        ["entry_yield_pct", w?.entry_yield_pct ?? opp.niy ?? null],
        ["exit_yield_pct", w?.exit_yield_pct ?? opp.reversionary_yield ?? null],
        ["hold_period_years", w?.hold_period_years ?? null],
        ["occupancy_pct", w?.occupancy_pct ?? null],
        ["target_irr", w?.target_irr ?? opp.target_irr ?? null],
        ["target_equity_multiple", w?.target_equity_multiple ?? opp.equity_multiple ?? null],
        ["strategy", w?.strategy ?? opp.strategy ?? null],
        ["thesis", w?.thesis ?? opp.summary ?? null],
        ["business_plan_assumptions", w?.business_plan_assumptions ?? null],
        ["created_by", opp.created_by ?? null],
      ];
      // Fixed leading parameters: $1 org, $2 opportunity, $3 acquisition date,
      // $4 assumptions. Version is allocated in SQL — numbers are per
      // opportunity and never reused, so this may not be version 1.
      const lead = 4;
      const params: unknown[] = [
        orgId, opportunityId, acqDate,
        w?.assumptions ? JSON.stringify(w.assumptions) : null,
        ...carried.map(([, v]) => v),
      ];
      const ins = await tx.query<{ case_id: string }>(
        `insert into investment_cases
           (org_id, opportunity_id, version, status, approved_at, acquisition_date,
            assumptions, ${carried.map(([c]) => c).join(", ")})
         values ($1, $2,
           (select coalesce(max(version), 0) + 1 from investment_cases where opportunity_id = $2),
           'approved', now(), coalesce($3::date, current_date),
           coalesce($4::jsonb, '{}'::jsonb),
           ${carried.map((_, i) => `$${lead + i + 1}`).join(", ")})
         returning case_id`, params);
      caseId = ins.rows[0].case_id;
    }

    // Transaction (immutable).
    const txn = await tx.query<{ transaction_id: string; acquisition_date: string; acquisition_price: string | null; debt: string | null }>(
      `insert into transactions(org_id, opportunity_id, property_id, investment_case_id,
         acquisition_price, acquisition_date, equity_invested, debt)
       values ($1,$2,$3,$4,$5, coalesce($6::date, current_date), $7, $8)
       returning transaction_id, acquisition_date, acquisition_price, debt`,
      [orgId, opportunityId, opp.property_id ?? null, caseId, opp.target_price ?? null, acqDate,
       opts.equityInvested ?? null, opts.debt ?? null]);
    const transactionId = txn.rows[0].transaction_id;
    const acquisitionDate = txn.rows[0].acquisition_date;

    // Portfolio: prefer one matching the deal currency in this org.
    const pf = await tx.query<{ portfolio_id: string }>(
      `select portfolio_id from portfolios where org_id = $1
       order by (currency = $2) desc, created_at asc limit 1`, [orgId, opp.currency]);

    // Asset — the owned position, referencing property/opportunity/case/transaction.
    const asset = await tx.query<{ asset_id: string }>(
      `insert into assets(org_id, portfolio_id, property_id, opportunity_id, investment_case_id, transaction_id,
         name, lifecycle_stage, currency, acquisition_date, acquisition_price, equity_invested, hold_thesis, is_demo)
       values ($1,$2,$3,$4,$5,$6,$7,'operating',$8,$9,$10,$11,$12,false)
       returning asset_id`,
      [orgId, pf.rows[0]?.portfolio_id ?? null, opp.property_id ?? null, opportunityId, caseId, transactionId,
       opp.name, opp.currency, acquisitionDate, opp.target_price ?? null, opts.equityInvested ?? null, opp.summary ?? null]);
    const assetId = asset.rows[0].asset_id;

    // Underwriting business plan v1 — the immutable baseline (from the approved case).
    await tx.query(
      `insert into business_plans(org_id, asset_id, plan_type, version, as_of_date, label,
         noi, occupancy_pct, valuation, capex, debt, ltv_pct, irr_pct, equity_multiple)
       select $1, $2, 'underwriting', 1, coalesce($3::date, current_date), 'Acquisition underwriting',
         c.noi, c.occupancy_pct, c.valuation, c.capex, c.debt, c.ltv_pct, c.target_irr, c.target_equity_multiple
       from investment_cases c where c.case_id = $4`,
      [orgId, assetId, acquisitionDate, caseId]);

    // Mark the opportunity acquired & converted.
    await tx.query("update opportunities set stage = 'acquired', status = 'converted' where opportunity_id = $1", [opportunityId]);

    return { assetId, alreadyExisted: false };
  });
}
