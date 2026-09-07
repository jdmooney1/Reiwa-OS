// ============================================================================
// Investment Portal — investor-facing authorisation, through real Postgres RLS.
// ----------------------------------------------------------------------------
// Every assertion here runs inside withInvestorSession(), which presents nothing
// but the Supabase Auth user id and lets the database derive the rest. No
// permission function is mocked and no query is routed around a policy: a leak
// in migration 0005 fails these tests.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { adminQuery, withInvestorSession, withSession } from "@/lib/db/client";
import {
  adminSession, investorAuthUserId, investorContactIdByEmail, investorOrgIdByName,
  orgIdByName, orgUserSession, publicationByOpportunityName,
} from "./helpers";

const KITANO = "principal@kitano-fo.example";     // featured: Queens Gate, diligence tier
const KITANO_ANALYST = "analyst@kitano-fo.example";
const SAKURA = "partner@sakura-cap.example";      // featured: Fenchurch, standard tier
const HANABI = "director@hanabi-ven.example";     // featured: Old Bond Street

let kitanoUid: string;
let kitanoAnalystUid: string;
let sakuraUid: string;
let hanabiUid: string;

let queensGate: Awaited<ReturnType<typeof publicationByOpportunityName>>;
let fenchurch: Awaited<ReturnType<typeof publicationByOpportunityName>>;
let bondStreet: Awaited<ReturnType<typeof publicationByOpportunityName>>;
let herengracht: Awaited<ReturnType<typeof publicationByOpportunityName>>;

beforeAll(async () => {
  [kitanoUid, kitanoAnalystUid, sakuraUid, hanabiUid] = await Promise.all([
    investorAuthUserId(KITANO), investorAuthUserId(KITANO_ANALYST),
    investorAuthUserId(SAKURA), investorAuthUserId(HANABI),
  ]);
  queensGate = await publicationByOpportunityName("58 Queens Gate");
  fenchurch = await publicationByOpportunityName("120 Fenchurch Street");
  bondStreet = await publicationByOpportunityName("Old Bond Street Retail");
  herengracht = await publicationByOpportunityName("Herengracht 124");
});

/** Publication ids this investor can actually read. */
async function visiblePublications(uid: string): Promise<string[]> {
  const { rows } = await withInvestorSession(uid, (tx) =>
    tx.query<{ publication_id: string }>("select publication_id from investor_publications"));
  return rows.map((r) => r.publication_id);
}

describe("Investor identity is derived in the database", () => {
  it("resolves the session's organisation from auth.uid() alone", async () => {
    const { rows } = await withInvestorSession(kitanoUid, (tx) =>
      tx.query<{ org: string | null; contact: string | null }>(
        "select app.current_investor_org_id() as org, app.current_investor_contact_id() as contact"));
    expect(rows[0].org).toBe(await investorOrgIdByName("Kitano Family Office"));
    expect(rows[0].contact).toBe(await investorContactIdByEmail(KITANO));
  });

  it("gives an investor no internal role and no internal organisation scope", async () => {
    const { rows } = await withInvestorSession(kitanoUid, (tx) =>
      tx.query<{ admin: boolean; write: boolean; orgs: string[] }>(
        "select app.is_admin() as admin, app.can_write() as write, app.current_org_ids() as orgs"));
    expect(rows[0].admin).toBe(false);
    expect(rows[0].write).toBe(false);
    expect(rows[0].orgs).toEqual([]);
  });
});

describe("Investors have zero access to internal Reiwa OS data", () => {
  const INTERNAL_TABLES = [
    "organizations", "organization_members", "profiles", "properties", "portfolios",
    "opportunities", "investment_cases", "transactions", "assets", "business_plans",
    "performance_periods", "asset_risks", "asset_decisions", "valuations", "fx_rates",
  ];

  it("reads nothing from any internal table", async () => {
    for (const table of INTERNAL_TABLES) {
      const { rows } = await withInvestorSession(kitanoUid, (tx) =>
        tx.query<{ n: number }>(`select count(*)::int as n from ${table}`));
      expect({ table, n: rows[0].n }).toEqual({ table, n: 0 });
    }
  });

  it("cannot reach the provenance mapping that holds the internal link", async () => {
    // The relationship exists — on the admin side only.
    const mapping = await adminQuery<{ opportunity_id: string }>(
      "select opportunity_id from publication_sources where publication_id = $1",
      [queensGate.publicationId]);
    expect(mapping[0].opportunity_id).toBe(queensGate.opportunityId);

    // The investor reads nothing from either provenance table, including the
    // rows for the very publication they are entitled to.
    for (const table of ["publication_sources", "publication_version_sources"]) {
      const { rows } = await withInvestorSession(kitanoUid, (tx) =>
        tx.query(`select * from ${table}`));
      expect({ table, rows: rows.length }).toEqual({ table, rows: 0 });
    }

    const targeted = await withInvestorSession(kitanoUid, (tx) =>
      tx.query("select * from publication_sources where publication_id = $1",
               [queensGate.publicationId]));
    expect(targeted.rows.length).toBe(0);
  });

  it("cannot traverse into the internal record even holding the id from elsewhere", async () => {
    // Handed the internal id directly (which no investor surface supplies), the
    // opportunity and everything hanging off it still read as empty.
    const { rows: leak } = await withInvestorSession(kitanoUid, (tx) =>
      tx.query("select * from opportunities where opportunity_id = $1", [queensGate.opportunityId]));
    expect(leak.length).toBe(0);

    const { rows: chain } = await withInvestorSession(kitanoUid, (tx) =>
      tx.query(`select 1 from investment_cases where opportunity_id = $1
                union all select 1 from assets where opportunity_id = $1
                union all select 1 from transactions where opportunity_id = $1`,
               [queensGate.opportunityId]));
    expect(chain.length).toBe(0);
  });

  it("cannot write to internal tables", async () => {
    await expect(
      withInvestorSession(kitanoUid, (tx) =>
        tx.query("insert into organizations(name, type) values ('Investor Attempt','corporate')")),
    ).rejects.toThrow();
  });
});

describe("No investor-readable surface carries an internal identifier", () => {
  /** Every table and view an investor may select from. */
  const INVESTOR_SURFACES = [
    "investor_organizations", "investor_contacts", "investor_publications",
    "publication_versions", "publication_documents", "publication_entitlements",
    "investor_saved", "investor_activity_events", "investor_requests",
    "investor_feed",
  ];

  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

  it("declares no column that names an internal opportunity", async () => {
    const columns = await adminQuery<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and table_name = any($1::text[])
          and (column_name like '%opportunity%' or column_name like '%source%'
               or column_name like '%property%' or column_name like '%asset_id%'
               or column_name = 'org_id')`,
      [INVESTOR_SURFACES]);
    expect(columns).toEqual([]);
  });

  it("returns no internal id in any row any investor can read", async () => {
    // Every identifier on the internal side of the boundary.
    const internal = await adminQuery<{ id: string }>(
      `select opportunity_id::text as id from opportunities
       union all select property_id::text from properties
       union all select org_id::text from organizations
       union all select asset_id::text from assets
       union all select case_id::text from investment_cases
       union all select transaction_id::text from transactions
       union all select portfolio_id::text from portfolios`);
    const internalIds = new Set(internal.map((r) => r.id));
    expect(internalIds.size).toBeGreaterThan(0);

    let rowsInspected = 0;
    for (const uid of [kitanoUid, kitanoAnalystUid, sakuraUid, hanabiUid]) {
      for (const surface of INVESTOR_SURFACES) {
        const { rows } = await withInvestorSession(uid, (tx) =>
          tx.query<{ body: string }>(`select to_jsonb(t)::text as body from ${surface} t`));
        rowsInspected += rows.length;
        for (const row of rows) {
          for (const candidate of row.body.match(UUID) ?? []) {
            expect({ surface, leaked: internalIds.has(candidate) })
              .toEqual({ surface, leaked: false });
          }
        }
      }
    }
    // Guard against a vacuous pass: the investors really did read rows.
    expect(rowsInspected).toBeGreaterThan(0);
  });
});

describe("Entitlement isolation between investor organisations", () => {
  it("investor org A cannot read investor org B's entitlements", async () => {
    const kitanoOrg = await investorOrgIdByName("Kitano Family Office");
    const sakuraOrg = await investorOrgIdByName("Sakura Capital Partners");

    const { rows } = await withInvestorSession(kitanoUid, (tx) =>
      tx.query<{ investor_org_id: string }>("select investor_org_id from publication_entitlements"));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.investor_org_id === kitanoOrg)).toBe(true);

    // Even asking for Sakura's rows by their exact organisation id.
    const { rows: targeted } = await withInvestorSession(kitanoUid, (tx) =>
      tx.query("select * from publication_entitlements where investor_org_id = $1", [sakuraOrg]));
    expect(targeted.length).toBe(0);
  });

  it("investor org A cannot read a publication only org B is entitled to", async () => {
    // Old Bond Street belongs to Hanabi's portal; Kitano has no entitlement.
    const kitanoSees = await visiblePublications(kitanoUid);
    expect(kitanoSees).not.toContain(bondStreet.publicationId);

    const hanabiSees = await visiblePublications(hanabiUid);
    expect(hanabiSees).toContain(bondStreet.publicationId);
    expect(hanabiSees).not.toContain(queensGate.publicationId);
  });

  it("an investor cannot read another organisation's contacts", async () => {
    const { rows } = await withInvestorSession(kitanoUid, (tx) =>
      tx.query<{ email: string }>("select email from investor_contacts"));
    // Only their own contact record — not even their colleague at the same firm.
    expect(rows.map((r) => r.email)).toEqual([KITANO]);
  });

  it("an investor sees only their own investor organisation row", async () => {
    const { rows } = await withInvestorSession(sakuraUid, (tx) =>
      tx.query<{ name: string }>("select name from investor_organizations"));
    expect(rows.map((r) => r.name)).toEqual(["Sakura Capital Partners"]);
  });
});

describe("Publication visibility", () => {
  it("an unentitled publication is invisible", async () => {
    // Sakura holds no entitlement of any kind to Queens Gate.
    const sakuraSees = await visiblePublications(sakuraUid);
    expect(sakuraSees).not.toContain(queensGate.publicationId);

    const { rows } = await withInvestorSession(sakuraUid, (tx) =>
      tx.query("select * from investor_publications where publication_id = $1",
               [queensGate.publicationId]));
    expect(rows.length).toBe(0);
  });

  it("a hidden entitlement is invisible", async () => {
    // Sakura DOES hold an entitlement to Old Bond Street — with is_visible false.
    const stored = await adminQuery<{ is_visible: boolean }>(
      `select is_visible from publication_entitlements
        where investor_org_id = $1 and publication_id = $2`,
      [await investorOrgIdByName("Sakura Capital Partners"), bondStreet.publicationId]);
    expect(stored[0].is_visible).toBe(false);

    expect(await visiblePublications(sakuraUid)).not.toContain(bondStreet.publicationId);

    // The entitlement row itself is hidden too.
    const { rows } = await withInvestorSession(sakuraUid, (tx) =>
      tx.query("select * from publication_entitlements where publication_id = $1",
               [bondStreet.publicationId]));
    expect(rows.length).toBe(0);
  });

  it("an entitlement to a publication that was never published shows nothing", async () => {
    // Kitano is entitled to Herengracht, but it has never been published.
    const entitlement = await adminQuery<{ is_visible: boolean }>(
      `select is_visible from publication_entitlements
        where investor_org_id = $1 and publication_id = $2`,
      [await investorOrgIdByName("Kitano Family Office"), herengracht.publicationId]);
    expect(entitlement[0].is_visible).toBe(true);

    expect(await visiblePublications(kitanoUid)).not.toContain(herengracht.publicationId);
  });
});

describe("Version visibility", () => {
  it("only the active published version is readable", async () => {
    const all = await adminQuery<{ version_id: string; status: string; version_number: number }>(
      "select version_id, status, version_number from publication_versions where publication_id = $1 order by version_number",
      [queensGate.publicationId]);
    expect(all.map((v) => v.status)).toEqual(["superseded", "published", "draft"]);

    const { rows } = await withInvestorSession(kitanoUid, (tx) =>
      tx.query<{ version_id: string }>(
        "select version_id from publication_versions where publication_id = $1",
        [queensGate.publicationId]));
    expect(rows.map((r) => r.version_id)).toEqual([queensGate.activeVersionId]);
  });

  it("a superseded version is not readable, even by id", async () => {
    const superseded = (await adminQuery<{ version_id: string }>(
      "select version_id from publication_versions where publication_id = $1 and status = 'superseded'",
      [queensGate.publicationId]))[0].version_id;

    const { rows } = await withInvestorSession(kitanoUid, (tx) =>
      tx.query("select * from publication_versions where version_id = $1", [superseded]));
    expect(rows.length).toBe(0);
  });

  it("draft and in-review versions are not readable, even by id", async () => {
    const draft = (await adminQuery<{ version_id: string }>(
      "select version_id from publication_versions where publication_id = $1 and status = 'draft'",
      [queensGate.publicationId]))[0].version_id;
    const inReview = (await adminQuery<{ version_id: string }>(
      "select version_id from publication_versions where publication_id = $1 and status = 'in_review'",
      [herengracht.publicationId]))[0].version_id;

    for (const versionId of [draft, inReview]) {
      const { rows } = await withInvestorSession(kitanoUid, (tx) =>
        tx.query("select * from publication_versions where version_id = $1", [versionId]));
      expect(rows.length).toBe(0);
    }
  });
});

describe("Document tiers", () => {
  async function readableDocuments(uid: string, publicationId: string): Promise<string[]> {
    const { rows } = await withInvestorSession(uid, (tx) =>
      tx.query<{ access_level: string }>(
        `select d.access_level from publication_documents d
           join publication_versions v on v.version_id = d.version_id
          where v.publication_id = $1 order by d.access_level`,
        [publicationId]));
    return rows.map((r) => r.access_level);
  }

  it("a standard entitlement cannot reach a diligence document", async () => {
    // Sakura holds Fenchurch at the standard tier.
    expect(await readableDocuments(sakuraUid, fenchurch.publicationId)).toEqual(["standard"]);

    const diligenceDoc = (await adminQuery<{ document_id: string }>(
      `select d.document_id from publication_documents d
         join publication_versions v on v.version_id = d.version_id
        where v.publication_id = $1 and d.access_level = 'diligence'`,
      [fenchurch.publicationId]))[0].document_id;

    const { rows } = await withInvestorSession(sakuraUid, (tx) =>
      tx.query("select * from publication_documents where document_id = $1", [diligenceDoc]));
    expect(rows.length).toBe(0);
  });

  it("a diligence entitlement reaches standard and diligence documents", async () => {
    // Kitano holds Queens Gate at the diligence tier.
    expect(await readableDocuments(kitanoUid, queensGate.publicationId))
      .toEqual(["diligence", "standard"]);
  });

  it("internal documents are never readable at any tier", async () => {
    const internalDocs = await adminQuery<{ document_id: string }>(
      "select document_id from publication_documents where access_level = 'internal'");
    expect(internalDocs.length).toBeGreaterThan(0);

    for (const uid of [kitanoUid, sakuraUid, hanabiUid]) {
      const { rows } = await withInvestorSession(uid, (tx) =>
        tx.query<{ n: number }>(
          "select count(*)::int as n from publication_documents where access_level = 'internal'"));
      expect(rows[0].n).toBe(0);
    }

    // ...and not by id either, at the highest investor tier.
    const { rows } = await withInvestorSession(kitanoUid, (tx) =>
      tx.query("select * from publication_documents where document_id = any($1::uuid[])",
               [internalDocs.map((d) => d.document_id)]));
    expect(rows.length).toBe(0);
  });

  it("documents of a superseded version are unreachable", async () => {
    const superseded = (await adminQuery<{ version_id: string }>(
      "select version_id from publication_versions where publication_id = $1 and status = 'superseded'",
      [queensGate.publicationId]))[0].version_id;

    const { rows } = await withInvestorSession(kitanoUid, (tx) =>
      tx.query("select * from publication_documents where version_id = $1", [superseded]));
    expect(rows.length).toBe(0);
  });
});

describe("Investor-generated records", () => {
  it("saved opportunities are specific to the contact, not the organisation", async () => {
    const principal = await withInvestorSession(kitanoUid, (tx) =>
      tx.query<{ publication_id: string }>("select publication_id from investor_saved"));
    expect(principal.rows.map((r) => r.publication_id)).toEqual([queensGate.publicationId]);

    // Same firm, same entitlements — but the colleague's save is not theirs.
    const analyst = await withInvestorSession(kitanoAnalystUid, (tx) =>
      tx.query("select * from investor_saved"));
    expect(analyst.rows.length).toBe(0);
  });

  it("an investor may save only a publication they can read, and only as themselves", async () => {
    const analystContact = await investorContactIdByEmail(KITANO_ANALYST);

    // A publication they cannot see cannot be saved.
    await expect(
      withInvestorSession(kitanoAnalystUid, (tx) =>
        tx.query("insert into investor_saved(investor_contact_id, publication_id) values ($1,$2)",
                 [analystContact, bondStreet.publicationId])),
    ).rejects.toThrow();

    // Nor can they save on a colleague's behalf.
    const principalContact = await investorContactIdByEmail(KITANO);
    await expect(
      withInvestorSession(kitanoAnalystUid, (tx) =>
        tx.query("insert into investor_saved(investor_contact_id, publication_id) values ($1,$2)",
                 [principalContact, fenchurch.publicationId])),
    ).rejects.toThrow();

    // Their own save of a visible publication succeeds, and is theirs alone.
    await withInvestorSession(kitanoAnalystUid, (tx) =>
      tx.query("insert into investor_saved(investor_contact_id, publication_id) values ($1,$2)",
               [analystContact, fenchurch.publicationId]));
    const saved = await withInvestorSession(kitanoAnalystUid, (tx) =>
      tx.query<{ publication_id: string }>("select publication_id from investor_saved"));
    expect(saved.rows.map((r) => r.publication_id)).toEqual([fenchurch.publicationId]);

    await withInvestorSession(kitanoAnalystUid, (tx) =>
      tx.query("delete from investor_saved where investor_contact_id = $1", [analystContact]));
  });

  it("activity events are append-only and scoped to the acting contact", async () => {
    const contact = await investorContactIdByEmail(KITANO);
    const org = await investorOrgIdByName("Kitano Family Office");

    await withInvestorSession(kitanoUid, (tx) =>
      tx.query(`insert into investor_activity_events
                  (investor_contact_id, investor_org_id, event_type, publication_id)
                values ($1,$2,'opportunity_viewed',$3)`,
               [contact, org, queensGate.publicationId]));

    const mine = await withInvestorSession(kitanoUid, (tx) =>
      tx.query<{ event_type: string }>("select event_type from investor_activity_events"));
    expect(mine.rows.map((r) => r.event_type)).toContain("opportunity_viewed");

    // A colleague at the same firm cannot read it.
    const theirs = await withInvestorSession(kitanoAnalystUid, (tx) =>
      tx.query("select * from investor_activity_events"));
    expect(theirs.rows.length).toBe(0);

    // Events cannot be rewritten or removed. Since P6 the UPDATE and DELETE
    // privileges are withdrawn from `authenticated` entirely, so PostgreSQL
    // refuses before row level security is consulted — stronger than a policy
    // that simply matches no rows.
    await expect(withInvestorSession(kitanoUid, (tx) =>
      tx.query("update investor_activity_events set event_type = 'login'")))
      .rejects.toThrow(/permission denied/i);
    await expect(withInvestorSession(kitanoUid, (tx) =>
      tx.query("delete from investor_activity_events")))
      .rejects.toThrow(/permission denied/i);
  });

  it("a request may be raised only against a readable publication, and not triaged by the investor", async () => {
    const contact = await investorContactIdByEmail(KITANO);
    const org = await investorOrgIdByName("Kitano Family Office");

    await expect(
      withInvestorSession(kitanoUid, (tx) =>
        tx.query(`insert into investor_requests
                    (investor_contact_id, investor_org_id, publication_id, request_type, message)
                  values ($1,$2,$3,'information','Not entitled to this one.')`,
                 [contact, org, bondStreet.publicationId])),
    ).rejects.toThrow();

    await withInvestorSession(kitanoUid, (tx) =>
      tx.query(`insert into investor_requests
                  (investor_contact_id, investor_org_id, publication_id, request_type, message)
                values ($1,$2,$3,'information','Please send the tenancy schedule.')`,
               [contact, org, queensGate.publicationId]));

    const mine = await withInvestorSession(kitanoUid, (tx) =>
      tx.query<{ status: string }>("select status from investor_requests"));
    expect(mine.rows.length).toBe(1);
    expect(mine.rows[0].status).toBe("new");

    // Triage is an admin action.
    const triaged = await withInvestorSession(kitanoUid, (tx) =>
      tx.query("update investor_requests set status = 'closed' returning request_id"));
    expect(triaged.rows.length).toBe(0);
  });
});

describe("Portal helpers cannot be turned into a privilege", () => {
  it("exposes no publication lifecycle function for an investor to call", async () => {
    // Publishing and withdrawal are statement sequences in the data layer's own
    // transaction, not database functions — so there is nothing here that would
    // have to be granted to `authenticated`, the role an investor arrives on.
    const lifecycle = await adminQuery<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app'
          and p.proname in ('publish_publication_version', 'supersede_active_version',
                            'is_privileged_connection')`);
    expect(lifecycle).toEqual([]);
  });

  it("cannot publish, supersede or repoint a publication by direct statement", async () => {
    // Their OWN entitled publication — the most favourable case for a caller.
    const superseded = await withInvestorSession(kitanoUid, (tx) =>
      tx.query(`update publication_versions set status = 'superseded'
                 where version_id = $1 returning version_id`, [queensGate.activeVersionId]));
    expect(superseded.rows.length).toBe(0);

    const repointed = await withInvestorSession(kitanoUid, (tx) =>
      tx.query(`update investor_publications set active_version_id = null, status = 'withdrawn'
                 where publication_id = $1 returning publication_id`, [queensGate.publicationId]));
    expect(repointed.rows.length).toBe(0);

    const promoted = await withInvestorSession(kitanoUid, (tx) =>
      tx.query(`update publication_versions set status = 'published'
                 where publication_id = $1 and status = 'draft' returning version_id`,
               [queensGate.publicationId]));
    expect(promoted.rows.length).toBe(0);

    // And the publication is untouched.
    const after = await adminQuery<{ status: string; active_version_id: string }>(
      "select status, active_version_id from investor_publications where publication_id = $1",
      [queensGate.publicationId]);
    expect(after[0].status).toBe("published");
    expect(after[0].active_version_id).toBe(queensGate.activeVersionId);
  });

  it("returns nothing when a derivation helper is handed another organisation's ids", async () => {
    // Every publication Kitano is not entitled to, asked for by exact id.
    const foreign = await adminQuery<{ publication_id: string }>(
      `select p.publication_id from investor_publications p
        where p.publication_id <> all($1::uuid[])`,
      [[queensGate.publicationId, fenchurch.publicationId, herengracht.publicationId]]);
    expect(foreign.length).toBeGreaterThan(0);

    for (const row of foreign) {
      const { rows } = await withInvestorSession(kitanoUid, (tx) =>
        tx.query<{ can: boolean; version: string | null }>(
          `select app.investor_can_read_publication($1) as can,
                  app.investor_active_version_id($1) as version`, [row.publication_id]));
      expect(rows[0]).toEqual({ can: false, version: null });
    }

    // And `internal` is refused for every published version in the database,
    // including the one they are entitled to at the diligence tier.
    const published = await adminQuery<{ version_id: string }>(
      "select version_id from publication_versions where status = 'published'");
    for (const row of published) {
      const { rows } = await withInvestorSession(kitanoUid, (tx) =>
        tx.query<{ internal: boolean }>(
          "select app.investor_can_read_document($1, 'internal') as internal", [row.version_id]));
      expect(rows[0].internal).toBe(false);
    }
  });

  it("does not expose the app schema to anon or as an HTTP RPC", async () => {
    const reach = await adminQuery<{ rolname: string; usage: boolean }>(
      `select rolname, has_schema_privilege(rolname, 'app', 'USAGE') as usage
         from pg_roles where rolname in ('anon', 'authenticated')`);
    expect(reach.find((r) => r.rolname === "anon")!.usage).toBe(false);
    expect(reach.find((r) => r.rolname === "authenticated")!.usage).toBe(true);

    // EXECUTE was revoked from PUBLIC, so no future role inherits it.
    const publicExecute = await adminQuery<{ proname: string }>(
      `select p.proname from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app'
          and has_function_privilege('public', p.oid, 'EXECUTE')`);
    expect(publicExecute).toEqual([]);

    // Every SECURITY DEFINER helper pins an empty search_path, and none lives
    // in an exposed schema.
    const definers = await adminQuery<{ proname: string; nspname: string; config: string | null }>(
      `select p.proname, n.nspname, array_to_string(p.proconfig, ',') as config
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef and n.nspname in ('app', 'public')`);
    expect(definers.length).toBeGreaterThan(0);
    for (const fn of definers) {
      expect({ fn: fn.proname, schema: fn.nspname, config: fn.config })
        .toEqual({ fn: fn.proname, schema: "app", config: 'search_path=""' });
    }
  });

  it("grants anon no privilege on any portal table", async () => {
    const anonGrants = await adminQuery<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'v')
          and c.relname like any (array['investor%', 'publication%'])
          and (has_table_privilege('anon', c.oid, 'SELECT')
            or has_table_privilege('anon', c.oid, 'INSERT')
            or has_table_privilege('anon', c.oid, 'UPDATE')
            or has_table_privilege('anon', c.oid, 'DELETE'))`);
    expect(anonGrants).toEqual([]);
  });
});

describe("The internal side of the boundary", () => {
  const PORTAL_TABLES = [
    "investor_organizations", "investor_contacts", "investor_publications",
    "publication_sources", "publication_version_sources",
    "publication_versions", "publication_documents", "publication_entitlements",
    "investor_saved", "investor_activity_events", "investor_requests",
  ];

  it("an internal organisation user sees no portal data at all", async () => {
    const meiji = await orgIdByName("Meiji Shipping");
    for (const table of PORTAL_TABLES) {
      const { rows } = await withSession(orgUserSession([meiji]), (tx) =>
        tx.query<{ n: number }>(`select count(*)::int as n from ${table}`));
      expect({ table, n: rows[0].n }).toEqual({ table, n: 0 });
    }
    // Publishing is not something an internal org user can start either.
    await expect(
      withSession(orgUserSession([meiji]), (tx) =>
        tx.query("insert into investor_organizations(name) values ('Self-service Attempt')")),
    ).rejects.toThrow();
  });

  it("a Reiwa admin can read and write every portal record", async () => {
    // Every table the seed populates is fully visible to an admin.
    for (const table of ["investor_organizations", "investor_contacts", "investor_publications",
                         "publication_sources", "publication_version_sources",
                         "publication_versions", "publication_documents",
                         "publication_entitlements", "investor_saved"]) {
      const { rows } = await withSession(adminSession, (tx) =>
        tx.query<{ n: number }>(`select count(*)::int as n from ${table}`));
      expect({ table, seen: rows[0].n > 0 }).toEqual({ table, seen: true });
    }
    // Including the rows a single investor may never see: drafts, superseded
    // versions and internal documents.
    const hidden = await withSession(adminSession, (tx) =>
      tx.query<{ n: number }>(
        `select (select count(*) from publication_versions where status <> 'published')
              + (select count(*) from publication_documents where access_level = 'internal')
              + (select count(*) from publication_entitlements where not is_visible) as n`));
    expect(Number(hidden.rows[0].n)).toBeGreaterThan(0);

    // And writes are theirs alone.
    const org = await investorOrgIdByName("Hanabi Ventures");
    await withSession(adminSession, (tx) =>
      tx.query("update investor_organizations set notes = $2 where investor_org_id = $1",
               [org, "Touched by the admin data layer."]));
  });
});

describe("The investor_feed projection carries the same guarantees", () => {
  it("shows each organisation only its own visible, published publications", async () => {
    const kitano = await withInvestorSession(kitanoUid, (tx) =>
      tx.query<{ publication_id: string; placement: string }>(
        "select publication_id, placement from investor_feed order by placement"));
    expect(kitano.rows.map((r) => r.publication_id).sort())
      .toEqual([queensGate.publicationId, fenchurch.publicationId].sort());
    expect(kitano.rows.filter((r) => r.placement === "featured").length).toBe(1);

    const sakura = await withInvestorSession(sakuraUid, (tx) =>
      tx.query<{ publication_id: string }>("select publication_id from investor_feed"));
    expect(sakura.rows.map((r) => r.publication_id)).toEqual([fenchurch.publicationId]);
  });
});
