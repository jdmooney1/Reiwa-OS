// ============================================================================
// Seed — idempotent demonstration data (runs once, when organizations is empty).
// ----------------------------------------------------------------------------
// Two organisations so org isolation is provable end to end:
//   * Meiji Shipping   — pipeline opportunities + the two demo assets.
//   * Aoyama Holdings  — a separate asset that Meiji users must never see.
// Demo login password for every seeded user: "reiwa2026".
// ============================================================================
import type { PGlite } from "@electric-sql/pglite";
import { adminQueryOn, type Queryable } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";
import { getAssetFiles } from "@/lib/asset-intelligence/mock";
import type { AssetFile, BusinessPlan } from "@/lib/asset-intelligence/types";

const DEMO_PASSWORD = "reiwa2026";

export async function seedIfEmpty(db: PGlite): Promise<void> {
  const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    adminQueryOn<T>(db as unknown as Queryable, sql, params);
  // Inserts here always RETURNING a row; cast for ergonomics.
  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await q<T>(sql, params))[0] as T;

  const existing = await q<{ n: number }>("select count(*)::int as n from organizations");
  if ((existing[0]?.n ?? 0) > 0) return;

  // TRANSITIONAL: password hashes power the legacy dev sign-in only. On hosted
  // Supabase this step is replaced by an identity provider that calls the Auth
  // Admin API (SUPABASE_SECRET_KEY) to create auth users, then inserts the
  // matching `users` rows (no password_hash).
  const pwd = hashPassword(DEMO_PASSWORD);

  // ---- Organisations ----
  const meiji = await one<{ org_id: string }>(
    "insert into organizations(name, type) values ($1,'corporate') returning org_id", ["Meiji Shipping"]);
  const aoyama = await one<{ org_id: string }>(
    "insert into organizations(name, type) values ($1,'family_office') returning org_id", ["Aoyama Holdings"]);

  // ---- Identities (auth.users first, then staff profile) ----
  const newIdentity = async (email: string, name: string, role: "reiwa_admin" | "org_user") => {
    const authRow = await one<{ id: string }>(
      "insert into auth.users(id, email) values (gen_random_uuid(), $1) returning id", [email]);
    await q(
      "insert into users(user_id, email, name, global_role, password_hash) values ($1,$2,$3,$4,$5)",
      [authRow.id, email, name, role, pwd]);
    return authRow.id;
  };

  const adminId = await newIdentity("admin@reiwa.com", "Reiwa Admin", "reiwa_admin");
  const analystId = await newIdentity("analyst@meiji.com", "Meiji Analyst", "org_user");
  const viewerId = await newIdentity("viewer@meiji.com", "Meiji Viewer", "org_user");
  const aoyamaId = await newIdentity("user@aoyama.com", "Aoyama Manager", "org_user");
  void adminId; // admin needs no memberships: RLS is_admin() derives from users

  // Read-only access is a MEMBERSHIP role ('viewer'), not a global role.
  await q("insert into organization_members(org_id, user_id, role) values ($1,$2,'manager')", [meiji.org_id, analystId]);
  await q("insert into organization_members(org_id, user_id, role) values ($1,$2,'viewer')", [meiji.org_id, viewerId]);
  await q("insert into organization_members(org_id, user_id, role) values ($1,$2,'manager')", [aoyama.org_id, aoyamaId]);

  // ---- Portfolios ----
  const pfUk = await one<{ portfolio_id: string }>(
    "insert into portfolios(org_id, name, country, currency) values ($1,'UK Portfolio','United Kingdom','GBP') returning portfolio_id", [meiji.org_id]);
  const pfNl = await one<{ portfolio_id: string }>(
    "insert into portfolios(org_id, name, country, currency) values ($1,'Netherlands Portfolio','Netherlands','EUR') returning portfolio_id", [meiji.org_id]);
  const pfAoyama = await one<{ portfolio_id: string }>(
    "insert into portfolios(org_id, name, country, currency) values ($1,'Japan & Global','Japan','GBP') returning portfolio_id", [aoyama.org_id]);

  // ---- Meiji pipeline opportunities (not yet assets) ----
  const pipeline: [string, string, string, string, string, string, number, number, number][] = [
    // name, city, market, asset_type, strategy, stage, target_price, niy, target_irr
    ["58 Queens Gate", "London", "London", "residential", "value_add", "underwriting", 42500000, 2.1, 14.5],
    ["Magna Plaza", "Amsterdam", "Amsterdam", "mixed_use", "value_add", "screening", 85000000, 4.2, 15.5],
    ["120 Fenchurch Street", "London", "London", "office", "value_add", "ic", 96000000, 4.0, 13.8],
    ["Old Bond Street Retail", "London", "London", "retail", "core", "approved", 72000000, 3.9, 8.8],
    ["Herengracht 124", "Amsterdam", "Amsterdam", "office", "core", "new", 34000000, 4.8, 9.5],
  ];
  for (const [name, city, market, atype, strat, stage, price, niy, irr] of pipeline) {
    const prop = await one<{ property_id: string }>(
      "insert into properties(org_id, name, city, country, market, asset_type) values ($1,$2,$3,$4,$5,$6) returning property_id",
      [meiji.org_id, name, city, market === "London" ? "United Kingdom" : "Netherlands", market, atype]);
    await q(`insert into opportunities(org_id, property_id, name, market, asset_type, strategy, stage, status,
       currency, target_price, niy, target_irr, owner_user_id, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11,$12,$12)`,
      [meiji.org_id, prop.property_id, name, market, atype, strat, stage,
       market === "London" ? "GBP" : "EUR", price, niy, irr, analystId]);
  }
  // A rejected opportunity (alternate outcome)
  {
    const prop = await one<{ property_id: string }>(
      "insert into properties(org_id, name, city, country, market, asset_type) values ($1,'Clerkenwell Workspace','London','United Kingdom','London','office') returning property_id",
      [meiji.org_id]);
    await q(`insert into opportunities(org_id, property_id, name, market, asset_type, strategy, stage, status,
       currency, target_price, niy, target_irr, owner_user_id, created_by)
       values ($1,$2,'Clerkenwell Workspace','London','office','value_add','screening','rejected','GBP',38000000,3.4,13.0,$3,$3)`,
      [meiji.org_id, prop.property_id, analystId]);
  }

  // ---- The two demo assets, persisted through the full lifecycle chain ----
  const files = getAssetFiles();
  for (const f of files) {
    const portfolioId = f.asset.city === "Amsterdam" ? pfNl.portfolio_id : pfUk.portfolio_id;
    await seedAssetChain(q, one, meiji.org_id, portfolioId, analystId, f, true);
  }

  // ---- Aoyama isolation fixture (a separate org's asset) ----
  await seedStandaloneAsset(q, one, aoyama.org_id, pfAoyama.portfolio_id, aoyamaId);
}

type Q = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
type One = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T>;

const PLAN_COLS =
  "gross_rental_income, noi, operating_expenses, occupancy_pct, capex, valuation, yield_pct, debt, ltv_pct, cash_on_cash_pct, equity_multiple, irr_pct";
function planVals(p: BusinessPlan): unknown[] {
  return [p.gross_rental_income, p.noi, p.operating_expenses, p.occupancy_pct, p.capex, p.valuation,
    p.yield_pct, p.debt, p.ltv_pct, p.cash_on_cash_pct, p.equity_multiple, p.irr_pct];
}

/** Property → opportunity(acquired) → approved case → transaction → asset → plans/periods/risks/decisions/valuations. */
async function seedAssetChain(
  q: Q, one: One, orgId: string, portfolioId: string, userId: string, f: AssetFile, isDemo: boolean,
): Promise<string> {
  const a = f.asset;
  const country = a.country ?? (a.city === "Amsterdam" ? "Netherlands" : "United Kingdom");
  const prop = await one<{ property_id: string }>(
    "insert into properties(org_id, name, address, city, country, market, asset_type) values ($1,$2,$3,$4,$5,$6,$7) returning property_id",
    [orgId, a.name, a.address, a.city, country, a.market, a.asset_type]);

  const opp = await one<{ opportunity_id: string }>(
    `insert into opportunities(org_id, property_id, name, market, asset_type, strategy, stage, status, currency,
       target_price, owner_user_id, created_by)
     values ($1,$2,$3,$4,$5,$6,'acquired','converted',$7,$8,$9,$9) returning opportunity_id`,
    [orgId, prop!.property_id, a.name, a.market, a.asset_type, a.strategy, a.currency, a.acquisition_price, userId]);

  const uw = f.plans.find((p) => p.plan_type === "underwriting");
  const kase = await one<{ case_id: string }>(
    `insert into investment_cases(org_id, opportunity_id, version, status, approved_at,
       acquisition_price, acquisition_date, noi, occupancy_pct, erv, capex, debt, ltv_pct, valuation,
       target_irr, target_equity_multiple, thesis)
     values ($1,$2,1,'approved',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning case_id`,
    [orgId, opp!.opportunity_id, a.acquisition_date, a.acquisition_price, a.acquisition_date,
     uw?.noi ?? null, uw?.occupancy_pct ?? null, null, uw?.capex ?? null, uw?.debt ?? null,
     uw?.ltv_pct ?? null, uw?.valuation ?? null, uw?.irr_pct ?? null, uw?.equity_multiple ?? null, a.hold_thesis]);

  const txn = await one<{ transaction_id: string }>(
    `insert into transactions(org_id, opportunity_id, property_id, investment_case_id,
       acquisition_price, acquisition_date, equity_invested, debt)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning transaction_id`,
    [orgId, opp!.opportunity_id, prop!.property_id, kase!.case_id,
     a.acquisition_price, a.acquisition_date, a.equity_invested, uw?.debt ?? null]);

  const asset = await one<{ asset_id: string }>(
    `insert into assets(org_id, portfolio_id, property_id, opportunity_id, investment_case_id, transaction_id,
       name, lifecycle_stage, currency, acquisition_date, acquisition_price, equity_invested, hold_thesis, is_demo)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning asset_id`,
    [orgId, portfolioId, prop!.property_id, opp!.opportunity_id, kase!.case_id, txn!.transaction_id,
     a.name, a.lifecycle_stage, a.currency, a.acquisition_date, a.acquisition_price, a.equity_invested, a.hold_thesis, isDemo]);

  for (const p of f.plans) {
    await q(
      `insert into business_plans(org_id, asset_id, plan_type, version, as_of_date, label, ${PLAN_COLS})
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [orgId, asset!.asset_id, p.plan_type, p.version, p.as_of_date, p.label, ...planVals(p)]);
  }
  for (const p of f.periods) {
    await q(
      `insert into performance_periods(org_id, asset_id, period_label, period_end, status,
         gross_rental_income, noi, operating_expenses, occupancy_pct, capex, valuation, yield_pct, debt, ltv_pct, cash_on_cash_pct)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [orgId, asset!.asset_id, p.period_label, p.period_end, p.status,
       p.gross_rental_income, p.noi, p.operating_expenses, p.occupancy_pct, p.capex, p.valuation, p.yield_pct, p.debt, p.ltv_pct, p.cash_on_cash_pct]);
  }
  for (const r of f.risks) {
    await q(
      `insert into asset_risks(org_id, asset_id, title, category, description, probability, financial_impact, severity, mitigation, owner, deadline, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [orgId, asset!.asset_id, r.title, r.category, r.description, r.probability, r.financial_impact, r.severity, r.mitigation, r.owner, r.deadline, r.status]);
  }
  for (const d of f.decisions) {
    await q(
      `insert into asset_decisions(org_id, asset_id, title, issue, recommendation, financial_impact, decision_maker, deadline, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [orgId, asset!.asset_id, d.title, d.issue, d.recommendation, d.financial_impact, d.decision_maker, d.deadline, d.status]);
  }
  for (const v of f.valuations) {
    await q(
      `insert into valuations(org_id, asset_id, valuation_date, valuer, valuation, valuation_type, noi, yield_pct, erv)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [orgId, asset!.asset_id, v.valuation_date, v.valuer, v.valuation, v.valuation_type, v.noi, v.yield_pct, v.erv]);
  }
  return asset!.asset_id;
}

/** A minimal standalone asset for a second org (isolation fixture). */
async function seedStandaloneAsset(q: Q, one: One, orgId: string, portfolioId: string, userId: string): Promise<void> {
  const prop = await one<{ property_id: string }>(
    "insert into properties(org_id, name, address, city, country, market, asset_type) values ($1,'Roppongi Tower','1-1 Roppongi','Tokyo','Japan','Other','office') returning property_id", [orgId]);
  const opp = await one<{ opportunity_id: string }>(
    `insert into opportunities(org_id, property_id, name, market, asset_type, strategy, stage, status, currency, target_price, owner_user_id, created_by)
     values ($1,$2,'Roppongi Tower','Other','office','core','acquired','converted','GBP',110000000,$3,$3) returning opportunity_id`,
    [orgId, prop!.property_id, userId]);
  const kase = await one<{ case_id: string }>(
    `insert into investment_cases(org_id, opportunity_id, version, status, approved_at, acquisition_price, acquisition_date, noi, valuation, target_irr, thesis)
     values ($1,$2,1,'approved','2025-01-15',110000000,'2025-01-15',5200000,110000000,11.0,'Core Tokyo office (Aoyama Holdings — isolation fixture).') returning case_id`,
    [orgId, opp!.opportunity_id]);
  const txn = await one<{ transaction_id: string }>(
    `insert into transactions(org_id, opportunity_id, property_id, investment_case_id, acquisition_price, acquisition_date, equity_invested, debt)
     values ($1,$2,$3,$4,110000000,'2025-01-15',66000000,44000000) returning transaction_id`,
    [orgId, opp!.opportunity_id, prop!.property_id, kase!.case_id]);
  const asset = await one<{ asset_id: string }>(
    `insert into assets(org_id, portfolio_id, property_id, opportunity_id, investment_case_id, transaction_id, name, lifecycle_stage, currency, acquisition_date, acquisition_price, equity_invested, hold_thesis, is_demo)
     values ($1,$2,$3,$4,$5,$6,'Roppongi Tower','operating','GBP','2025-01-15',110000000,66000000,'Core Tokyo office.',true) returning asset_id`,
    [orgId, portfolioId, prop!.property_id, opp!.opportunity_id, kase!.case_id, txn!.transaction_id]);
  await q(`insert into business_plans(org_id, asset_id, plan_type, version, as_of_date, label, noi, valuation, occupancy_pct, debt, ltv_pct, irr_pct, equity_multiple)
     values ($1,$2,'underwriting',1,'2025-01-15','Acquisition underwriting',5200000,110000000,96,44000000,40,11.0,1.6)`, [orgId, asset!.asset_id]);
  await q(`insert into performance_periods(org_id, asset_id, period_label, period_end, status, noi, valuation, occupancy_pct, debt, ltv_pct)
     values ($1,$2,'Q2 2026','2026-06-30','closed',5300000,112000000,97,44000000,39.3)`, [orgId, asset!.asset_id]);
}
