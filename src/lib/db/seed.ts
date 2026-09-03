// ============================================================================
// Seed — idempotent demonstration data (runs once, when organizations is empty).
// ----------------------------------------------------------------------------
// Two organisations so org isolation is provable end to end:
//   * Meiji Shipping   — pipeline opportunities + the two demo assets.
//   * Aoyama Holdings  — a separate asset that Meiji users must never see.
//
// Identity is created in Supabase Auth through the Admin API (SUPABASE_SECRET_KEY),
// then mirrored into `profiles` over the privileged Postgres connection. The two
// credentials are used for their own jobs and never substituted for each other.
// Demo login password for every seeded user: "reiwa2026".
//
// The Investment Portal fixtures (three investor organisations, four contacts,
// four publications, deliberately unequal entitlements) are seeded last — see
// seedInvestorPortal() at the foot of this file.
// ============================================================================
import type { Pool } from "pg";
import { adminQueryOn, getPool, type Queryable } from "@/lib/db/client";
import { createSupabaseAdminClient, ensureAuthUser } from "@/lib/supabase/admin";
import { publishVersionOn } from "@/lib/data/investor-portal";
import { getAssetFiles } from "@/lib/asset-intelligence/mock";
import type { AssetFile, BusinessPlan } from "@/lib/asset-intelligence/types";

export const DEMO_PASSWORD = "reiwa2026";

export interface SeedStaffAccount {
  email: string;
  name: string;
  globalRole: "reiwa_admin" | "org_user" | "investor_viewer";
}

/** The staff accounts the demo environment provisions in Supabase Auth. */
export const SEED_ACCOUNTS: SeedStaffAccount[] = [
  { email: "admin@reiwa.com", name: "Reiwa Admin", globalRole: "reiwa_admin" },
  { email: "analyst@meiji.com", name: "Meiji Analyst", globalRole: "org_user" },
  { email: "viewer@meiji.com", name: "Meiji Investor", globalRole: "investor_viewer" },
  { email: "user@aoyama.com", name: "Aoyama Manager", globalRole: "org_user" },
];

export interface SeedInvestorAccount {
  email: string;
  name: string;
  title: string;
  /** Matches an entry in INVESTOR_ORG_FIXTURES by name. */
  org: string;
}

/**
 * Portal identities. Fictional people at fictional firms — the fixtures exist to
 * prove isolation, so they must never carry real client information.
 *
 * These accounts get a Supabase Auth user and an `investor_contacts` row and
 * NOTHING else: no `profiles` row, no `organization_members` row. That is what
 * makes every internal policy deny them by construction rather than by rule.
 */
export const SEED_INVESTOR_ACCOUNTS: SeedInvestorAccount[] = [
  { email: "principal@kitano-fo.example", name: "K. Arai", title: "Principal", org: "Kitano Family Office" },
  { email: "analyst@kitano-fo.example", name: "M. Oda", title: "Investment Analyst", org: "Kitano Family Office" },
  { email: "partner@sakura-cap.example", name: "T. Ishii", title: "Managing Partner", org: "Sakura Capital Partners" },
  { email: "director@hanabi-ven.example", name: "R. Kudo", title: "Director", org: "Hanabi Ventures" },
];

const INVESTOR_ORG_FIXTURES = ["Kitano Family Office", "Sakura Capital Partners", "Hanabi Ventures"];

/**
 * Provision the Supabase Auth users and their `profiles` rows. Safe to re-run:
 * existing accounts are reused and profiles are upserted.
 */
export async function seedIdentities(pool: Pool = getPool()): Promise<Record<string, string>> {
  const admin = createSupabaseAdminClient();
  const client = await pool.connect();
  const ids: Record<string, string> = {};
  try {
    for (const account of SEED_ACCOUNTS) {
      const userId = await ensureAuthUser(admin, {
        email: account.email,
        password: DEMO_PASSWORD,
        name: account.name,
      });
      ids[account.email] = userId;
      await client.query(
        `insert into profiles(user_id, email, name, global_role) values ($1,$2,$3,$4)
         on conflict (user_id) do update set email = excluded.email, name = excluded.name,
           global_role = excluded.global_role`,
        [userId, account.email, account.name, account.globalRole],
      );
    }
  } finally {
    client.release();
  }
  return ids;
}

/**
 * Provision the Supabase Auth users behind the portal contacts. Deliberately
 * separate from seedIdentities(): no `profiles` row is written, because a portal
 * investor is not a Reiwa OS user.
 */
export async function seedInvestorIdentities(): Promise<Record<string, string>> {
  const admin = createSupabaseAdminClient();
  const ids: Record<string, string> = {};
  for (const account of SEED_INVESTOR_ACCOUNTS) {
    ids[account.email] = await ensureAuthUser(admin, {
      email: account.email,
      password: DEMO_PASSWORD,
      name: account.name,
    });
  }
  return ids;
}

/**
 * Seed demonstration data. No-op when `organizations` already has rows.
 * Returns true when data was written.
 */
export async function seedIfEmpty(pool: Pool = getPool()): Promise<boolean> {
  const client = await pool.connect();
  try {
    const existing = await client.query<{ n: number }>("select count(*)::int as n from organizations");
    if ((existing.rows[0]?.n ?? 0) > 0) return false;
  } finally {
    client.release();
  }

  const userIds = await seedIdentities(pool);
  const investorUserIds = await seedInvestorIdentities();

  const conn = await pool.connect();
  const db: Queryable = {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const res = await conn.query(sql, params as unknown[]);
      return { rows: res.rows as T[] };
    },
    async exec(sql: string) {
      return conn.query(sql);
    },
  };
  const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    adminQueryOn<T>(db, sql, params);
  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await q<T>(sql, params))[0] as T;

  try {
    await conn.query("begin");

    // ---- Organisations ----
    const meiji = await one<{ org_id: string }>(
      "insert into organizations(name, type) values ($1,'corporate') returning org_id", ["Meiji Shipping"]);
    const aoyama = await one<{ org_id: string }>(
      "insert into organizations(name, type) values ($1,'family_office') returning org_id", ["Aoyama Holdings"]);

    // ---- Memberships (identities already exist in auth.users + profiles) ----
    const analystId = userIds["analyst@meiji.com"];
    const viewerId = userIds["viewer@meiji.com"];
    const aoyamaUserId = userIds["user@aoyama.com"];

    await q("insert into organization_members(org_id, user_id, role) values ($1,$2,'manager')", [meiji.org_id, analystId]);
    await q("insert into organization_members(org_id, user_id, role) values ($1,$2,'viewer')", [meiji.org_id, viewerId]);
    await q("insert into organization_members(org_id, user_id, role) values ($1,$2,'manager')", [aoyama.org_id, aoyamaUserId]);
    // reiwa_admin sees everything via RLS is_admin(); no membership rows required.

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
    await seedStandaloneAsset(q, one, aoyama.org_id, pfAoyama.portfolio_id, aoyamaUserId);

    // ---- Investment Portal fixtures (P1) ----
    await seedInvestorPortal(q, one, db, meiji.org_id, userIds["admin@reiwa.com"], investorUserIds);

    await conn.query("commit");
    return true;
  } catch (e) {
    await conn.query("rollback");
    throw e;
  } finally {
    conn.release();
  }
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

// ============================================================================
// Investment Portal fixtures (P1)
// ----------------------------------------------------------------------------
// Enough shape to prove isolation without any screens existing yet:
//
//   Kitano Family Office   featured: 58 Queens Gate (diligence documents)
//                          secondary: 120 Fenchurch Street (standard documents)
//                          entitled to a publication that was never published
//   Sakura Capital         featured: 120 Fenchurch Street (standard documents)
//                          a HIDDEN entitlement to Old Bond Street Retail
//   Hanabi Ventures        featured: Old Bond Street Retail (standard documents)
//
// So: Queens Gate is invisible to Sakura (no entitlement at all), Old Bond
// Street is invisible to Sakura (entitlement present but not visible) and
// visible to Hanabi, and every organisation sees a different portal.
//
// Queens Gate is published twice, so version 1 is superseded and only version 2
// is readable. Documents must be attached while a version is still a draft —
// once published, a version and its documents are an immutable snapshot.
// ============================================================================

/** Document set attached to every published version: one per access tier. */
const PORTAL_DOCUMENTS: [string, string, string, string][] = [
  // title, category, access_level, storage path (private bucket)
  ["Investment teaser", "teaser", "standard", "publications/%s/teaser.pdf"],
  ["Data room index", "data_room", "diligence", "publications/%s/data-room-index.pdf"],
  ["Internal IC memo", "other", "internal", "publications/%s/internal-ic-memo.pdf"],
];

async function seedPublicationDocuments(q: Q, versionId: string, adminId: string): Promise<void> {
  let order = 0;
  for (const [title, category, level, path] of PORTAL_DOCUMENTS) {
    await q(
      `insert into publication_documents(version_id, title, category, storage_path, file_name,
         mime_type, access_level, sort_order, created_by)
       values ($1,$2,$3,$4,$5,'application/pdf',$6,$7,$8)`,
      [versionId, title, category, path.replace("%s", versionId), `${title}.pdf`, level, order++, adminId]);
  }
}

/**
 * Take a draft version through the real boundary: the whitelist function
 * supplies every field carried over from the internal opportunity, and the
 * fingerprint is captured at the same moment — privately, in
 * publication_version_sources, never on the version row.
 */
async function seedDraftVersion(
  q: Q, one: One, publicationId: string, opportunityId: string, versionNumber: number,
  headline: string, highlights: string[], adminId: string,
): Promise<string> {
  const row = await one<{ version_id: string }>(
    `with src as (
       select app.opportunity_publication_source($2) as s)
     insert into publication_versions(
       publication_id, version_number, status,
       title, headline, overview, market, submarket, city, country,
       asset_type, strategy, currency, headline_price, target_niy, target_irr,
       target_equity_multiple, size_sqft, size_sqm, hold_period_years, highlights, created_by)
     select $1, $3, 'draft',
            coalesce(src.s ->> 'title', 'Untitled opportunity'),
            $4,
            src.s ->> 'overview',
            src.s ->> 'market', src.s ->> 'submarket', src.s ->> 'city', src.s ->> 'country',
            src.s ->> 'asset_type', src.s ->> 'strategy', coalesce(src.s ->> 'currency', 'GBP'),
            (src.s ->> 'headline_price')::numeric, (src.s ->> 'target_niy')::numeric,
            (src.s ->> 'target_irr')::numeric, (src.s ->> 'target_equity_multiple')::numeric,
            (src.s ->> 'size_sqft')::numeric, (src.s ->> 'size_sqm')::numeric,
            5, $5::jsonb, $6
       from src
     returning version_id`,
    [publicationId, opportunityId, versionNumber, headline, JSON.stringify(highlights), adminId]);
  await q(
    `insert into publication_version_sources(version_id, source_fingerprint)
     values ($1, app.opportunity_publication_fingerprint($2))`,
    [row!.version_id, opportunityId]);
  return row!.version_id;
}

async function seedInvestorPortal(
  q: Q, one: One, db: Queryable, internalOrgId: string, adminId: string,
  investorUserIds: Record<string, string>,
): Promise<void> {
  // ---- Investor organisations (separate tenancy from `organizations`) ----
  const orgIds: Record<string, string> = {};
  for (const name of INVESTOR_ORG_FIXTURES) {
    const row = await one<{ investor_org_id: string }>(
      `insert into investor_organizations(name, status, linked_internal_organization_id, notes)
       values ($1, 'active', null, $2) returning investor_org_id`,
      [name, "Demonstration fixture — fictional firm."]);
    orgIds[name] = row!.investor_org_id;
  }

  // ---- Contacts, each bound to its Supabase Auth user ----
  const contactIds: Record<string, string> = {};
  for (const account of SEED_INVESTOR_ACCOUNTS) {
    const row = await one<{ investor_contact_id: string }>(
      `insert into investor_contacts(investor_org_id, email, name, title, auth_user_id, is_active)
       values ($1,$2,$3,$4,$5,true) returning investor_contact_id`,
      [orgIds[account.org], account.email, account.name, account.title, investorUserIds[account.email]]);
    contactIds[account.email] = row!.investor_contact_id;
  }

  // ---- Publications, drawn from Meiji's pipeline ----
  const opportunityId = async (name: string): Promise<string> => {
    const row = await one<{ opportunity_id: string }>(
      "select opportunity_id from opportunities where org_id = $1 and name = $2",
      [internalOrgId, name]);
    if (!row) throw new Error(`Seed opportunity "${name}" not found`);
    return row.opportunity_id;
  };
  // The publication row carries no internal identifier; the link is recorded in
  // the admin-only mapping alongside it.
  const publication = async (name: string): Promise<{ id: string; opportunityId: string }> => {
    const oppId = await opportunityId(name);
    const row = await one<{ publication_id: string }>(
      "insert into investor_publications(status, created_by) values ('draft',$1) returning publication_id",
      [adminId]);
    await q("insert into publication_sources(publication_id, opportunity_id, linked_by) values ($1,$2,$3)",
      [row!.publication_id, oppId, adminId]);
    return { id: row!.publication_id, opportunityId: oppId };
  };

  // 58 Queens Gate — published twice, so v1 is superseded and only v2 is live.
  const queensGate = await publication("58 Queens Gate");
  const qgV1 = await seedDraftVersion(q, one, queensGate.id, queensGate.opportunityId, 1,
    "Prime South Kensington residential conversion",
    ["Grade II listed stucco terrace", "Vacant possession on completion"], adminId);
  await seedPublicationDocuments(q, qgV1, adminId);
  await publishVersionOn(db, qgV1, adminId);

  const qgV2 = await seedDraftVersion(q, one, queensGate.id, queensGate.opportunityId, 2,
    "Prime South Kensington residential conversion",
    ["Grade II listed stucco terrace", "Vacant possession on completion",
     "Planning consent granted for 11 lateral apartments"], adminId);
  await seedPublicationDocuments(q, qgV2, adminId);
  await publishVersionOn(db, qgV2, adminId);

  // A third version left in draft, so a live publication also has open work.
  await seedDraftVersion(q, one, queensGate.id, queensGate.opportunityId, 3,
    "Prime South Kensington residential conversion", ["Draft — not for release"], adminId);

  // 120 Fenchurch Street — a single published version.
  const fenchurch = await publication("120 Fenchurch Street");
  const fcV1 = await seedDraftVersion(q, one, fenchurch.id, fenchurch.opportunityId, 1,
    "City of London office repositioning",
    ["EPC B on completion of the capex programme", "WAULT 4.2 years to break"], adminId);
  await seedPublicationDocuments(q, fcV1, adminId);
  await publishVersionOn(db, fcV1, adminId);

  // Old Bond Street Retail — a single published version.
  const bondStreet = await publication("Old Bond Street Retail");
  const bsV1 = await seedDraftVersion(q, one, bondStreet.id, bondStreet.opportunityId, 1,
    "Mayfair prime retail, core income",
    ["Flagship frontage", "Index-linked lease to 2034"], adminId);
  await seedPublicationDocuments(q, bsV1, adminId);
  await publishVersionOn(db, bsV1, adminId);

  // Herengracht 124 — submitted for review but never published. Kitano holds a
  // visible entitlement to it, which must still show them nothing.
  const herengracht = await publication("Herengracht 124");
  const hgV1 = await seedDraftVersion(q, one, herengracht.id, herengracht.opportunityId, 1,
    "Amsterdam canal-district office", ["Awaiting approval"], adminId);
  await q(`update publication_versions set status = 'in_review', submitted_at = now(), submitted_by = $2
           where version_id = $1`, [hgV1, adminId]);

  // ---- Entitlements (default deny; each organisation sees a different portal) ----
  const entitle = async (
    org: string, publicationId: string, visible: boolean, placement: string,
    sortOrder: number, docLevel: string, note: string | null,
  ): Promise<void> => {
    await q(
      `insert into publication_entitlements(investor_org_id, publication_id, is_visible, placement,
         sort_order, investor_note, document_access_level, granted_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [orgIds[org], publicationId, visible, placement, sortOrder, note, docLevel, adminId]);
  };

  await entitle("Kitano Family Office", queensGate.id, true, "featured", 0, "diligence",
    "Shared ahead of the December committee.");
  await entitle("Kitano Family Office", fenchurch.id, true, "secondary", 1, "standard", null);
  await entitle("Kitano Family Office", herengracht.id, true, "secondary", 2, "standard", null);

  await entitle("Sakura Capital Partners", fenchurch.id, true, "featured", 0, "standard", null);
  // Present but hidden — the entitlement exists and grants nothing.
  await entitle("Sakura Capital Partners", bondStreet.id, false, "secondary", 1, "diligence", null);

  await entitle("Hanabi Ventures", bondStreet.id, true, "featured", 0, "standard", null);

  // ---- One contact's saved state, to prove saves are per contact ----
  await q("insert into investor_saved(investor_contact_id, publication_id) values ($1,$2)",
    [contactIds["principal@kitano-fo.example"], queensGate.id]);
}
