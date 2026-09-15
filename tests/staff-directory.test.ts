// ============================================================================
// The internal staff directory (migration 0011), through real Postgres.
// ----------------------------------------------------------------------------
// `app.staff_names()` is SECURITY DEFINER: its body runs as the owner, past RLS.
// That is the whole reason it exists and the whole reason it is dangerous, so
// every clause of its authorisation is asserted here against a real database
// rather than reasoned about. Nothing below mocks a session or routes around a
// policy — each case presents a session and reads what the function returns.
//
// What the function must never become is a way to enumerate the firm. The tests
// that matter most are therefore the refusals: a colleague in another
// organisation, a portal investor, and `anon`.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { adminQuery, withSession, withInvestorSession, type Session } from "@/lib/db/client";
import { staffNames } from "@/lib/data/directory";
import { createOpportunity } from "@/lib/data/opportunities";
import { createVersion, listVersions } from "@/lib/data/underwriting";
import {
  adminSession, orgIdByName, orgUserSession, viewerSession,
  profileIdByEmail, investorAuthUserId,
} from "./helpers";

let meiji: string;
let aoyama: string;
let analyst: string;   // analyst@meiji.com  — org_user, member of Meiji
let viewer: string;    // viewer@meiji.com   — investor_viewer, member of Meiji
let aoyamaUser: string; // user@aoyama.com   — org_user, member of Aoyama only
let adminId: string;   // admin@reiwa.com    — reiwa_admin
let meijiSession: Session;

/** Call the function directly under a given session, bypassing the wrapper. */
async function callAs(session: Session, ids: string[]): Promise<Map<string, string>> {
  return withSession(session, async (tx) => {
    const { rows } = await tx.query<{ user_id: string; display_name: string }>(
      "select user_id, display_name from app.staff_names($1::uuid[])", [ids]);
    return new Map(rows.map((r) => [r.user_id, r.display_name]));
  });
}

beforeAll(async () => {
  [meiji, aoyama] = await Promise.all([
    orgIdByName("Meiji Shipping"), orgIdByName("Aoyama Holdings"),
  ]);
  [analyst, viewer, aoyamaUser, adminId] = await Promise.all([
    profileIdByEmail("analyst@meiji.com"), profileIdByEmail("viewer@meiji.com"),
    profileIdByEmail("user@aoyama.com"), profileIdByEmail("admin@reiwa.com"),
  ]);
  meijiSession = orgUserSession([meiji], analyst);
});

// ---------------------------------------------------------------------------
describe("An internal user resolves an authorised colleague", () => {
  it("names a colleague in a shared organisation", async () => {
    // The analyst and the viewer are both members of Meiji, and neither is an
    // administrator. Before 0011 this returned nothing at all.
    const names = await callAs(meijiSession, [viewer]);
    expect(names.get(viewer)).toBeTruthy();
  });

  it("still names the caller themselves", async () => {
    const names = await callAs(meijiSession, [analyst]);
    expect(names.get(analyst)).toBeTruthy();
  });

  it("resolves a batch in one call, and ignores ids it may not have", async () => {
    // The batch contains one colleague and one outsider. The outsider is simply
    // absent from the result — there is no error to tell them apart by.
    const names = await callAs(meijiSession, [analyst, viewer, aoyamaUser]);
    expect(names.has(analyst)).toBe(true);
    expect(names.has(viewer)).toBe(true);
    expect(names.has(aoyamaUser)).toBe(false);
  });

  it("returns only a user id and a name — never an email or a role", async () => {
    const columns = await adminQuery<{ column_name: string }>(
      `select p.column_name
         from information_schema.parameters p
        where p.specific_schema = 'app'
          and p.specific_name like 'staff_names%'
          and p.parameter_mode = 'OUT'
        order by p.ordinal_position`);
    expect(columns.map((c) => c.column_name)).toEqual(["user_id", "display_name"]);
  });

  it("never falls back to the email address when no name is recorded", async () => {
    const [before] = await adminQuery<{ name: string | null }>(
      "select name from profiles where user_id = $1", [viewer]);
    await adminQuery("update profiles set name = null where user_id = $1", [viewer]);
    try {
      const names = await callAs(meijiSession, [viewer]);
      // No row at all, rather than a row carrying the email address.
      expect(names.has(viewer)).toBe(false);
    } finally {
      // Restore whatever was actually there: this database is shared by every
      // test file in the run, and a fixture left mutated fails somebody else.
      await adminQuery("update profiles set name = $2 where user_id = $1",
        [viewer, before.name]);
    }
  });
});

// ---------------------------------------------------------------------------
describe("The colleague's name reaches the workspace", () => {
  it("names the author of an underwriting version written by somebody else", async () => {
    // Written by the VIEWER's colleague is not the point; written by someone
    // other than the reader is. The version is authored by the analyst and read
    // back by the Meiji investor_viewer, who is a different user.
    const opportunityId = await createOpportunity(meijiSession, {
      orgId: meiji, name: "Directory Author", assetType: "office", currency: "GBP",
    });
    await createVersion(meijiSession, opportunityId, { acquisitionPrice: 5_000_000 });

    const asColleague = viewerSession([meiji], viewer);
    const versions = await listVersions(asColleague, opportunityId);
    expect(versions).toHaveLength(1);
    expect(versions[0].createdBy).toBe(analyst);
    // The assertion the old `left join profiles` could never satisfy.
    expect(versions[0].createdByName).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe("It cannot be used to enumerate the firm", () => {
  it("refuses a profile in an organisation the caller does not share", async () => {
    const names = await callAs(meijiSession, [aoyamaUser]);
    expect(names.size).toBe(0);
  });

  it("refuses in both directions", async () => {
    const aoyamaSession = orgUserSession([aoyama], aoyamaUser);
    const names = await callAs(aoyamaSession, [analyst, viewer]);
    expect(names.size).toBe(0);
  });

  it("cannot be widened by asking for every profile at once", async () => {
    const everyone = await adminQuery<{ user_id: string }>("select user_id from profiles");
    expect(everyone.length).toBeGreaterThan(3);

    const names = await callAs(meijiSession, everyone.map((r) => r.user_id));
    // Only Meiji's own members come back, never the whole table.
    for (const [id] of names) {
      const shared = await adminQuery<{ n: string }>(
        `select count(*) as n from organization_members
          where user_id = $1 and org_id = $2`, [id, meiji]);
      expect(Number(shared[0].n)).toBeGreaterThan(0);
    }
    expect(names.has(aoyamaUser)).toBe(false);
  });

  it("ignores a claimed org the caller is not actually a member of", async () => {
    // A session asserting Aoyama's org id while being the Meiji analyst. Org
    // membership is read from organization_members keyed on auth.uid(), not
    // from the claim, so the lie buys nothing.
    const lying: Session = { userId: analyst, orgIds: [meiji, aoyama], role: "org_user", canWrite: true };
    const names = await callAs(lying, [aoyamaUser]);
    expect(names.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe("Portal investors get nothing", () => {
  it("returns no staff name to an investor session", async () => {
    const kitano = await investorAuthUserId("principal@kitano-fo.example");
    const everyone = await adminQuery<{ user_id: string }>("select user_id from profiles");

    const rows = await withInvestorSession(kitano, async (tx) => {
      const { rows } = await tx.query(
        "select user_id, display_name from app.staff_names($1::uuid[])",
        [everyone.map((r) => r.user_id)]);
      return rows;
    });

    // A portal contact holds no `profiles` row, so the caller-is-staff clause
    // denies the whole directory by construction rather than by rule.
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("Administrators", () => {
  it("resolve anyone without holding an organization_members row", async () => {
    const membership = await adminQuery<{ n: string }>(
      "select count(*) as n from organization_members where user_id = $1", [adminId]);
    // The premise of the test: the administrator is in no organisation at all.
    expect(Number(membership[0].n)).toBe(0);

    const names = await callAs(adminSession, [analyst, viewer, aoyamaUser]);
    expect(names.has(analyst)).toBe(true);
    expect(names.has(viewer)).toBe(true);
    expect(names.has(aoyamaUser)).toBe(true);
  });

  it("is decided by app.is_admin(), not by a second rule of its own", async () => {
    // Same user id, without the admin claim: the JWT is what app.is_admin()
    // reads, so stripping it drops the caller back to their memberships — of
    // which this user has none.
    const demoted: Session = { userId: adminId, orgIds: [], role: "org_user", canWrite: true };
    const names = await callAs(demoted, [analyst, aoyamaUser]);
    expect(names.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The catalogue-level guarantees. tests/privileges.test.ts asserts these across
// every function in `app`; they are restated here against this one because they
// are the properties that make the SECURITY DEFINER acceptable at all.
describe("The function's own privileges", () => {
  it("pins an empty search_path", async () => {
    const [fn] = await adminQuery<{ config: string | null; secdef: boolean }>(`
      select array_to_string(p.proconfig, ',') as config, p.prosecdef as secdef
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'staff_names'`);
    expect(fn.secdef).toBe(true);
    expect(fn.config).toBe('search_path=""');
  });

  it("grants EXECUTE to authenticated and to nobody else", async () => {
    const [acl] = await adminQuery<{
      pub: boolean; anon: boolean; auth: boolean;
    }>(`
      select has_function_privilege('public', p.oid, 'EXECUTE')        as pub,
             has_function_privilege('anon', p.oid, 'EXECUTE')          as anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'staff_names'`);
    expect(acl).toEqual({ pub: false, anon: false, auth: true });
  });

  it("keeps anon out of schema app entirely", async () => {
    const [usage] = await adminQuery<{ usage: boolean }>(
      "select has_schema_privilege('anon', 'app', 'USAGE') as usage");
    expect(usage.usage).toBe(false);
  });

  it("leaves profiles_self exactly as migration 0001 wrote it", async () => {
    // The point of 0011 is that this policy did NOT have to be broadened. If a
    // later change widens it, the directory has become pointless and this fails.
    const policies = await adminQuery<{ policyname: string; qual: string; cmd: string }>(`
      select policyname, qual, cmd from pg_policies
       where schemaname = 'public' and tablename = 'profiles'
       order by policyname`);
    expect(policies).toHaveLength(1);
    expect(policies[0].policyname).toBe("profiles_self");
    expect(policies[0].cmd).toBe("SELECT");
    expect(policies[0].qual.replace(/\s+/g, " "))
      .toBe("(app.is_admin() OR ((user_id)::text = app.current_user_id()))");
  });

  it("still denies a direct read of a colleague's profile row", async () => {
    // The directory resolves the NAME. It must not have made the table readable.
    const rows = await withSession(meijiSession, async (tx) => {
      const { rows } = await tx.query(
        "select user_id, email, global_role from profiles where user_id = $1", [viewer]);
      return rows;
    });
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("The application wrapper", () => {
  it("asks for nothing when there is nothing to ask for", async () => {
    // An empty id list must not become `= any('{}')` against the whole table.
    expect((await staffNames(meijiSession, [])).size).toBe(0);
    expect((await staffNames(meijiSession, [null, undefined])).size).toBe(0);
  });

  it("de-duplicates before asking", async () => {
    const names = await staffNames(meijiSession, [analyst, analyst, analyst]);
    expect(names.size).toBe(1);
  });
});
