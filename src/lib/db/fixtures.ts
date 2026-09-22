// ============================================================================
// Reiwa Capital fixtures — the firm's own four reference deals.
// ----------------------------------------------------------------------------
// This is what `npm run db:seed` and `npm run db:reset` put into a fresh
// database. It is Reiwa Capital and nobody else: the fictional counterparties
// and investor organisations used to prove row-level isolation live in
// src/lib/db/seed.ts and are seeded only by the integration test harness.
//
// EVERY FIGURE HERE IS DELIBERATELY ABSENT.
//
// Guide price, NIY, rent, ERV, areas, IRR and dates are all null and every
// record is labelled TBC. Reiwa OS must never show a number the firm did not
// enter, and a fixture is the easiest place for an invented figure to become
// folklore. Fill these in from the real deal files, in the application.
//
// Two of the four are passes. They are seeded as rejected opportunities with
// the reason recorded in the decision log. The structured pass-reason taxonomy
// (revisit trigger, guide price vs our view of value, introducer, outcome if
// known) arrives with the pass log in a later phase; when it does, these two
// rows are the first records to migrate onto it.
// ============================================================================
import type { Pool } from "pg";
import { adminQueryOn, getPool, type Queryable } from "@/lib/db/client";
import { createSupabaseAdminClient, ensureAuthUser } from "@/lib/supabase/admin";

/** The one account a fresh Reiwa OS is provisioned with. */
export const REIWA_ADMIN_EMAIL = "admin@reiwa-capital.com";
export const REIWA_ADMIN_NAME = "Reiwa Admin";

/**
 * Development sign-in password for the seeded admin account. Only ever used
 * against a development or test project; production accounts are provisioned
 * through Supabase Auth directly and never through a seed.
 */
export const FIXTURE_PASSWORD = "reiwa2026";

export const REIWA_ORG_NAME = "Reiwa Capital";

type OppStatus = "active" | "rejected";

export interface ReiwaFixture {
  /** Working name, as the firm refers to the deal. */
  name: string;
  city: string;
  country: string;
  /** Free text; drives the default due diligence framework only. */
  market: string;
  assetType: string;
  stage: "new" | "screening" | "underwriting" | "ic" | "approved" | "acquired";
  status: OppStatus;
  /** What the record is, and what still has to be established. */
  summary: string;
  /** Recorded in the decision log for the two passes. */
  pass?: { decision: string; rationale: string };
}

const TBC =
  "Placeholder fixture. No figures have been entered: guide price, NIY, " +
  "passing rent, ERV, areas, tenure and dates are all TBC and must be taken " +
  "from the deal file before this record is relied on.";

export const REIWA_FIXTURES: ReiwaFixture[] = [
  {
    name: "58 Queen's Gate",
    city: "London",
    country: "United Kingdom",
    market: "London",
    assetType: "residential",
    stage: "underwriting",
    status: "active",
    summary: `QG58. Active. ${TBC} Stage shown is a placeholder - set it from the live position.`,
  },
  {
    name: "28 Pavilion Road",
    city: "London",
    country: "United Kingdom",
    market: "London",
    assetType: "mixed_use",
    stage: "screening",
    status: "active",
    summary: `Assessed, not progressed to underwriting. ${TBC}`,
  },
  {
    name: "Queens Hotel, Brighton",
    city: "Brighton",
    country: "United Kingdom",
    market: "Brighton",
    assetType: "hotel",
    stage: "screening",
    status: "rejected",
    summary: `Passed on entry price. ${TBC}`,
    pass: {
      decision: "Passed",
      rationale:
        "Price discipline. Entry price could not be reconciled to our view of " +
        "value. Guide price, our view of value and any revisit trigger are TBC.",
    },
  },
  {
    name: "Dyke Road Avenue, Brighton",
    city: "Brighton",
    country: "United Kingdom",
    market: "Brighton",
    assetType: "residential",
    stage: "screening",
    status: "rejected",
    summary: `Passed as off-strategy. ${TBC}`,
    pass: {
      decision: "Passed",
      rationale:
        "Off-strategy. Outside the mandate on asset type and/or location. " +
        "Guide price and any revisit trigger are TBC.",
    },
  },
];

/**
 * Seed Reiwa Capital and its four reference deals. Idempotent at the level the
 * caller needs: seedIfEmpty() only calls this when `organizations` is empty.
 */
export async function seedReiwaFixtures(pool: Pool = getPool()): Promise<void> {
  const admin = createSupabaseAdminClient();
  const adminUserId = await ensureAuthUser(admin, {
    email: REIWA_ADMIN_EMAIL,
    password: FIXTURE_PASSWORD,
    name: REIWA_ADMIN_NAME,
  });

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

    await q(
      `insert into profiles(user_id, email, name, global_role)
       values ($1,$2,$3,'reiwa_admin')
       on conflict (user_id) do update set email = excluded.email, name = excluded.name`,
      [adminUserId, REIWA_ADMIN_EMAIL, REIWA_ADMIN_NAME]);

    const org = await one<{ org_id: string }>(
      "insert into organizations(name, type) values ($1,'corporate') returning org_id",
      [REIWA_ORG_NAME]);

    await q(
      "insert into organization_members(org_id, user_id, role) values ($1,$2,'owner')",
      [org.org_id, adminUserId]);

    await q(
      `insert into portfolios(org_id, name, country, currency)
       values ($1,'UK Portfolio','United Kingdom','GBP')`,
      [org.org_id]);

    for (const f of REIWA_FIXTURES) {
      const prop = await one<{ property_id: string }>(
        `insert into properties(org_id, name, city, country, market, asset_type)
         values ($1,$2,$3,$4,$5,$6) returning property_id`,
        [org.org_id, f.name, f.city, f.country, f.market, f.assetType]);

      // Every numeric column is left null on purpose. See the file header.
      const opp = await one<{ opportunity_id: string }>(
        `insert into opportunities(org_id, property_id, name, market, asset_type,
           stage, status, currency, summary, owner_user_id, created_by, archived_at)
         values ($1,$2,$3,$4,$5,$6,$7,'GBP',$8,$9,$9,
                 case when $7 = 'rejected' then now() else null end)
         returning opportunity_id`,
        [org.org_id, prop.property_id, f.name, f.market, f.assetType,
         f.stage, f.status, f.summary, adminUserId]);

      if (f.pass) {
        await q(
          `insert into decision_log(org_id, opportunity_id, decision_type,
             decision, rationale, author)
           values ($1,$2,'screening',$3,$4,$5)`,
          [org.org_id, opp.opportunity_id, f.pass.decision, f.pass.rationale,
           REIWA_ADMIN_NAME]);
      }
    }

    await conn.query("commit");
  } catch (e) {
    await conn.query("rollback");
    throw e;
  } finally {
    conn.release();
  }
}
