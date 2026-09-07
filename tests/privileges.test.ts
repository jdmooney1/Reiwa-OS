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

  /**
   * SECURITY INVOKER is not an excuse. A function whose search_path is resolved
   * from the caller's session is a function the caller can redefine the meaning
   * of, so 0007 pins every one of them — trigger functions included.
   */
  it("pins an empty search_path on every function in app, not only the definers", async () => {
    const unpinned = await adminQuery<{ proname: string; config: string | null }>(`
      select p.proname, array_to_string(p.proconfig, ',') as config
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app'
         and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=%'`);
    expect(unpinned).toEqual([]);
  });

  it("lets neither anon nor PUBLIC execute anything in the public schema", async () => {
    // PostgREST exposes `public`; `app` is not in its exposed schemas. A
    // function reachable here would be callable as an unauthenticated HTTP RPC.
    const exposed = await adminQuery<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('public', p.oid, 'EXECUTE'))
       order by 1`);
    expect(exposed).toEqual([]);
  });
});

// ============================================================================
// P6 — the whole catalogue, not just the portal
// ----------------------------------------------------------------------------
// The P6 audit found `anon` holding full DML including TRUNCATE on every table
// migrations 0001-0004 created, and `authenticated` holding TRUNCATE,
// REFERENCES and TRIGGER everywhere. RLS was covering for both. These tests pin
// the corrected state so it cannot drift back.
// ============================================================================
describe("Table privileges across the whole schema", () => {
  it("grants anon nothing on any table, view or sequence in public", async () => {
    const leaked = await adminQuery<{ relname: string; privilege_type: string }>(`
      select c.relname, a.privilege_type
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join lateral aclexplode(c.relacl) a
       where n.nspname = 'public' and a.grantee = 'anon'::regrole
       order by 1, 2`);
    expect(leaked).toEqual([]);
  });

  it("grants PUBLIC nothing on any table, view or sequence in public", async () => {
    // grantee 0 is PUBLIC — a grant every present and future role inherits.
    const leaked = await adminQuery<{ relname: string; privilege_type: string }>(`
      select c.relname, a.privilege_type
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join lateral aclexplode(c.relacl) a
       where n.nspname = 'public' and a.grantee = 0
       order by 1, 2`);
    expect(leaked).toEqual([]);
  });

  /**
   * TRUNCATE is the important one: row level security does not filter it, so a
   * policy cannot stop it. REFERENCES and TRIGGER let a session attach
   * structure to a table it merely reads. The application needs none of them.
   */
  it("holds no TRUNCATE, REFERENCES or TRIGGER for authenticated anywhere", async () => {
    const structural = await adminQuery<{ relname: string; privilege_type: string }>(`
      select c.relname, a.privilege_type
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        cross join lateral aclexplode(c.relacl) a
       where n.nspname = 'public'
         and a.grantee = 'authenticated'::regrole
         and a.privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')
       order by 1, 2`);
    expect(structural).toEqual([]);
  });

  it("keeps row level security enabled on every table in public", async () => {
    // Extension-owned relations are excluded: they are Supabase's to manage,
    // not this application's, and nothing here should be altering them.
    const unprotected = await adminQuery<{ relname: string }>(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
         and not exists (select 1 from pg_depend d
                          where d.objid = c.oid and d.deptype = 'e')
       order by 1`);
    expect(unprotected).toEqual([]);
  });

  /**
   * Supabase's stock default privileges re-grant everything to `anon` on each
   * new table. Correcting today's catalogue without correcting the default just
   * re-introduces the problem with the next migration.
   */
  it("leaves no default privilege that would expose a future table to anon", async () => {
    const defaults = await adminQuery<{ grantor: string; objtype: string; acl: string }>(`
      select d.defaclrole::regrole::text as grantor,
             d.defaclobjtype::text as objtype,
             d.defaclacl::text as acl
        from pg_default_acl d
        join pg_namespace n on n.oid = d.defaclnamespace
       where n.nspname = 'public'`);
    for (const row of defaults) {
      expect({ ...row, exposesAnon: /\banon=/.test(row.acl) })
        .toEqual({ ...row, exposesAnon: false });
      expect({ ...row, exposesPublic: /(^|\s)=[a-zA-Z]+\//.test(row.acl) })
        .toEqual({ ...row, exposesPublic: false });
    }
  });

  it("proves a newly created table inherits nothing for anon", async () => {
    await adminQuery("create table if not exists public._p6_default_probe (id int)");
    try {
      const leaked = await adminQuery<{ privilege_type: string }>(`
        select a.privilege_type
          from pg_class c cross join lateral aclexplode(c.relacl) a
         where c.oid = 'public._p6_default_probe'::regclass
           and (a.grantee = 'anon'::regrole or a.grantee = 0)`);
      expect(leaked).toEqual([]);
    } finally {
      await adminQuery("drop table if exists public._p6_default_probe");
    }
  });
});

// ============================================================================
describe("The activity trail is append-only at the privilege layer", () => {
  it("gives authenticated INSERT and SELECT, and nothing else", async () => {
    const granted = await adminQuery<{ privilege_type: string }>(`
      select a.privilege_type
        from pg_class c cross join lateral aclexplode(c.relacl) a
       where c.oid = 'public.investor_activity_events'::regclass
         and a.grantee = 'authenticated'::regrole
       order by 1`);
    expect(granted.map((r) => r.privilege_type)).toEqual(["INSERT", "SELECT"]);
  });

  it("leaves no policy that would let anyone amend or erase history", async () => {
    // polcmd: 'r' select, 'a' insert, 'w' update, 'd' delete, '*' all.
    const policies = await adminQuery<{ polname: string; polcmd: string }>(`
      select polname, polcmd::text
        from pg_policy where polrelid = 'public.investor_activity_events'::regclass
       order by polname`);
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect({ policy: policy.polname, mutating: ["w", "d", "*"].includes(policy.polcmd) })
        .toEqual({ policy: policy.polname, mutating: false });
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
