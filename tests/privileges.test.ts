// ============================================================================
// The EXECUTE privilege matrix for schema `app`, asserted against the catalogue.
// ----------------------------------------------------------------------------
// `create function` grants EXECUTE to PUBLIC by default and `grant ... on all
// functions` re-broadens the schema in one line, so least privilege here is
// easy to lose by accident. This test pins the whole matrix: every function in
// `app` must appear in EXPECTED with a deliberate decision, so adding one
// without classifying it fails rather than silently inheriting a grant.
// ============================================================================
import { describe, it, expect } from "vitest";
import { adminQuery } from "@/lib/db/client";

/**
 * Does `authenticated` need EXECUTE? Both internal staff and portal investors
 * arrive on that one Postgres role, so anything true here is reachable by an
 * investor — which is why the list is as short as it is.
 */
const EXPECTED: Record<string, { authenticated: boolean; why: string }> = {
  // ---- P0 tenancy helpers, evaluated inside RLS policies --------------------
  current_user_id:      { authenticated: true,  why: "profiles_self policy" },
  current_global_role:  { authenticated: true,  why: "called from app.is_admin() (INVOKER body)" },
  current_org_ids:      { authenticated: true,  why: "called from app.has_org() (INVOKER body)" },
  is_admin:             { authenticated: true,  why: "policy predicate on 12 tables" },
  can_write:            { authenticated: true,  why: "write policies on 12 internal tables" },
  has_org:              { authenticated: true,  why: "tenancy predicate on 13 internal tables" },

  // ---- P1 portal authorisation, evaluated inside RLS policies ---------------
  is_investor:                   { authenticated: true, why: "fx_rates policy" },
  current_investor_contact_id:   { authenticated: true, why: "policies on 4 portal tables" },
  current_investor_org_id:       { authenticated: true, why: "policies on 4 portal tables" },
  investor_can_read_publication: { authenticated: true, why: "investor_publications policy" },
  investor_active_version_id:    { authenticated: true, why: "publication_versions policy" },
  investor_can_read_document:    { authenticated: true, why: "publication_documents policy" },

  // ---- Called directly by the admin data layer, which runs as authenticated -
  opportunity_publication_source:      { authenticated: true, why: "publication prefill; SECURITY INVOKER, RLS-gated" },
  opportunity_publication_fingerprint: { authenticated: true, why: "drift detection; SECURITY INVOKER, RLS-gated" },

  // ---- Reached only from a SECURITY DEFINER body (runs as the owner) --------
  document_tier: { authenticated: false, why: "only called inside app.investor_can_read_document()" },

  // ---- Trigger functions: EXECUTE is checked at CREATE TRIGGER, not at fire -
  touch_updated_at:           { authenticated: false, why: "trigger function" },
  touch_asset_updated:        { authenticated: false, why: "trigger function" },
  block_if_approved_case:     { authenticated: false, why: "trigger function" },
  block_transaction_change:   { authenticated: false, why: "trigger function" },
  block_underwriting_plan:    { authenticated: false, why: "trigger function" },
  guard_publication_version:  { authenticated: false, why: "trigger function" },
  guard_publication_document: { authenticated: false, why: "trigger function" },
};

interface FunctionAcl {
  proname: string;
  signature: string;
  security: "DEFINER" | "INVOKER";
  pub: boolean;
  anon: boolean;
  auth: boolean;
  privileged: boolean;
}

async function functionMatrix(): Promise<FunctionAcl[]> {
  return adminQuery<FunctionAcl>(`
    select p.proname,
           p.oid::regprocedure::text as signature,
           case p.prosecdef when true then 'DEFINER' else 'INVOKER' end as security,
           has_function_privilege('public', p.oid, 'EXECUTE')        as pub,
           has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
           has_function_privilege('postgres', p.oid, 'EXECUTE')      as privileged
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
     order by p.proname`);
}

describe("EXECUTE privileges on schema app", () => {
  it("classifies every function — no unreviewed function exists", async () => {
    const actual = (await functionMatrix()).map((f) => f.proname).sort();
    expect(actual).toEqual(Object.keys(EXPECTED).sort());
  });

  it("grants authenticated exactly the functions it needs, and no others", async () => {
    for (const fn of await functionMatrix()) {
      const expected = EXPECTED[fn.proname];
      expect({ fn: fn.proname, granted: fn.auth })
        .toEqual({ fn: fn.proname, granted: expected.authenticated });
    }
  });

  it("grants PUBLIC and anon nothing at all", async () => {
    for (const fn of await functionMatrix()) {
      expect({ fn: fn.proname, pub: fn.pub, anon: fn.anon })
        .toEqual({ fn: fn.proname, pub: false, anon: false });
    }
    // anon cannot even enter the schema, so the revoke is belt and braces.
    const usage = await adminQuery<{ rolname: string; usage: boolean }>(
      `select rolname, has_schema_privilege(rolname, 'app', 'USAGE') as usage
         from pg_roles where rolname in ('anon', 'authenticated', 'service_role')`);
    expect(usage.find((r) => r.rolname === "anon")!.usage).toBe(false);
    expect(usage.find((r) => r.rolname === "service_role")!.usage).toBe(false);
    expect(usage.find((r) => r.rolname === "authenticated")!.usage).toBe(true);
  });

  it("keeps the privileged connection able to run migrations and seeding", async () => {
    for (const fn of await functionMatrix()) {
      expect({ fn: fn.proname, privileged: fn.privileged })
        .toEqual({ fn: fn.proname, privileged: true });
    }
  });

  it("declares no ALTER DEFAULT PRIVILEGES that would grant future app functions", async () => {
    const defaults = await adminQuery<{ schema: string; objtype: string; acl: string }>(`
      select n.nspname as schema, d.defaclobjtype::text as objtype, d.defaclacl::text as acl
        from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace
       where n.nspname = 'app'`);
    expect(defaults).toEqual([]);
  });

  it("pins an empty search_path on every SECURITY DEFINER function", async () => {
    const definers = await adminQuery<{ proname: string; config: string | null }>(`
      select p.proname, array_to_string(p.proconfig, ',') as config
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef and n.nspname in ('app', 'public')`);
    expect(definers.length).toBe(5);
    for (const fn of definers) {
      expect({ fn: fn.proname, config: fn.config })
        .toEqual({ fn: fn.proname, config: 'search_path=""' });
    }
  });
});

describe("Table privileges on the portal", () => {
  it("grants anon nothing on any portal table or view", async () => {
    const leaked = await adminQuery<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'v')
         and c.relname like any (array['investor%', 'publication%'])
         and (has_table_privilege('anon', c.oid, 'SELECT')
           or has_table_privilege('anon', c.oid, 'INSERT')
           or has_table_privilege('anon', c.oid, 'UPDATE')
           or has_table_privilege('anon', c.oid, 'DELETE'))`);
    expect(leaked).toEqual([]);
  });

  it("keeps row level security enabled on every portal table", async () => {
    const unprotected = await adminQuery<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and c.relname like any (array['investor%', 'publication%'])
         and not c.relrowsecurity`);
    expect(unprotected).toEqual([]);
  });
});
