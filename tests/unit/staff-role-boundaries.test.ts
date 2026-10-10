// ============================================================================
// Structural guards for reiwa_staff (migration 0035): the boundary lives in the database, and
// nothing in the application quietly widens it. These read the source, as the earlier
// boundary tests do (tests/unit/investor-no-photos.test.ts, memo-review-boundaries.test.ts);
// the behavioural proof against real Postgres is tests/staff-role.test.ts.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    if (statSync(join(root, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, "");
const MIGRATIONS = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
const NEW = "0035_staff_role.sql";

describe("the role is a database fact", () => {
  it("the type and the profile constraint both know reiwa_staff", () => {
    expect(read("src/lib/db/client.ts")).toMatch(/GlobalRole = "reiwa_admin" \| "reiwa_staff" \| "org_user" \| "investor_viewer"/);
    expect(stripSqlComments(read(`supabase/migrations/${NEW}`)))
      .toMatch(/check \(global_role in \('reiwa_admin', 'reiwa_staff', 'org_user', 'investor_viewer'\)\)/);
  });

  it("is_admin still means reiwa_admin and nothing else; has_org is not widened", () => {
    const all = MIGRATIONS.map((f) => stripSqlComments(read(`supabase/migrations/${f}`))).join("\n");
    expect(all).toMatch(/create or replace function app\.is_admin\(\)[\s\S]*?app\.current_global_role\(\) = 'reiwa_admin'/);
    const hasOrg = [...all.matchAll(/create or replace function app\.has_org\(target uuid\)[\s\S]*?\$\$;/g)];
    expect(hasOrg).toHaveLength(1);
    expect(hasOrg[0][0]).toContain("app.is_admin()");
    expect(hasOrg[0][0]).not.toContain("is_staff");
  });
});

describe("staff is admitted in exactly two places, and nowhere investor-facing", () => {
  const files = MIGRATIONS.map((f) => ({ f, sql: stripSqlComments(read(`supabase/migrations/${f}`)) }));

  it("app.is_staff() appears in no migration but 0035", () => {
    for (const { f, sql } of files.filter((x) => x.f !== NEW)) expect(sql, f).not.toContain("is_staff");
  });

  it("and in 0035 it is the function, its grant, and policies on the two memo drafting aids only", () => {
    const sql = files.find((x) => x.f === NEW)!.sql;
    const policies = [...sql.matchAll(/create policy (\w+) on public\.(\w+) for (\w+)[\s\S]*?;\s*(?=\n|$)/g)];
    const admitting = policies.filter((p) => p[0].includes("is_staff"));
    expect(admitting.length).toBeGreaterThan(0);
    for (const p of admitting) expect(["memo_ai_reviews", "memo_translation_drafts"], p[1]).toContain(p[2]);
    // Every one of them asks the memos table, which applies the caller's own organisation policy.
    for (const p of admitting) expect(p[0], p[1]).toMatch(/exists \(\s*select 1 from public\.memos m where m\.memo_id =/);
    // No policy in 0035 touches an investor-facing table.
    expect(sql).not.toMatch(/on public\.(investor_|publication_|deal_share|fx_rates)/);
  });

  it("no policy on an investor-facing or prospect-facing table mentions staff", () => {
    for (const { f, sql } of files) {
      for (const m of sql.matchAll(/create policy \w+ on (?:public\.)?(investor_\w+|publication_\w+|deal_shares|deal_share_views|fx_rates)\b[\s\S]*?;/g)) {
        expect(m[0], `${f} ${m[1]}`).not.toContain("is_staff");
      }
    }
  });

  it("administrators-only write policies on the portal tables are untouched: 0005 still gates them on is_admin", () => {
    const sql = files.find((x) => x.f === "0005_investor_portal.sql")!.sql;
    expect(sql).toMatch(/create policy %I_admin on %I for all to authenticated\s+using \(app\.is_admin\(\)\) with check \(app\.is_admin\(\)\)/);
  });
});

describe("managing users and clients is not a session act", () => {
  const sql = stripSqlComments(read(`supabase/migrations/${NEW}`));
  it("withdraws every write privilege on membership and profiles, underneath the policies", () => {
    expect(sql).toMatch(/revoke insert, update, delete, truncate, references, trigger\s+on public\.organization_members from authenticated/);
    expect(sql).toMatch(/revoke all on public\.profiles from authenticated;\s*grant select on public\.profiles to authenticated/);
  });

  it("client organisations are writable by administrators only", () => {
    expect(sql).toMatch(/drop policy if exists orgs_write on public\.organizations/);
    expect(sql).toMatch(/create policy orgs_admin_write on public\.organizations for all to authenticated\s+using \(app\.is_admin\(\)\) with check \(app\.is_admin\(\)\)/);
  });

  it("no application code writes profiles, roles or memberships; only the seed does", () => {
    const writers = walk("src").filter((f) => /\b(insert into|update|delete from)\s+(public\.)?(profiles|organization_members)\b/i.test(read(f)));
    expect(writers).toEqual(["src/lib/db/seed.ts"]);
  });
});

describe("the application layer agrees with the database, and is never the only gate", () => {
  /** The first `await` in each exported action: the identity check has to come before everything. */
  function firstAwaits(file: string): [string, string][] {
    const src = read(file);
    return src.split(/(?=export async function )/).slice(1).map((chunk) => {
      const name = chunk.match(/export async function (\w+)/)![1];
      const first = chunk.slice(chunk.indexOf("{", chunk.indexOf(")") ) ).match(/await ([\w.]+\(\))/);
      return [name, first ? first[1] : "(none)"];
    });
  }

  it.each([
    "src/app/actions/admin-portal.ts", "src/app/actions/admin-invites.ts",
    "src/app/actions/admin-activity.ts", "src/app/actions/deal-shares.ts",
  ])("every exported action in %s checks requireAdminSession() before anything else", (file) => {
    const actions = firstAwaits(file);
    expect(actions.length).toBeGreaterThan(0);
    for (const [name, first] of actions) expect(first, `${file} ${name}`).toBe("requireAdminSession()");
    expect(read(file)).not.toContain("requireStaffSession");
  });

  it("publishing: the admin check precedes the confirmation gate, which precedes the publish", () => {
    const a = read("src/app/actions/admin-portal.ts");
    const block = a.slice(a.indexOf("export async function publishVersionAction("), a.indexOf("export async function saveInvestorOverviewAction"));
    const [admin, gate, publish] = ["requireAdminSession()", "assertPublishConfirmed(", "await publishVersion("].map((s) => block.indexOf(s));
    expect(admin).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(admin);
    expect(publish).toBeGreaterThan(gate);
  });

  it("exchange rates refuse a non-administrator before writing, as well as in the database (0025)", () => {
    const fx = read("src/app/actions/fx.ts");
    expect((fx.match(/isPortalAdmin\(session\)/g) ?? []).length).toBe(2);
  });

  it("requireStaffSession is used by the three memo drafting actions and the deal assessment, nothing else", () => {
    // The deal assessment (docs/28) is a pre-investor staff tool, like the memo aids:
    // it reads the underwriting and records a run, and touches no investor-facing table.
    const users = walk("src").filter((f) => f !== "src/lib/auth/admin.ts" && read(f).includes("requireStaffSession()"));
    expect(users.sort()).toEqual([
      "src/app/actions/deal-assessment.ts",
      "src/app/actions/memo-review.ts", "src/app/actions/memo-translation-accept.ts", "src/app/actions/memo-translation.ts",
    ]);
  });

  it("isInternalStaff is used by that gate, the memo page's two offers and the assessment's run button, nowhere else", () => {
    const users = walk("src").filter((f) => f !== "src/lib/auth/admin.ts" && /isInternalStaff\(/.test(read(f)));
    expect(users.sort()).toEqual([
      "src/app/(app)/opportunities/[opportunityId]/assessment/page.tsx",
      "src/app/(app)/opportunities/[opportunityId]/memo/page.tsx",
    ]);
  });

  it("the investor admin area, the sharing control and the investor Overview editor stay admin-only", () => {
    expect(read("src/app/(app)/admin/layout.tsx")).toContain("requireAdminAuth");
    const memoPage = read("src/app/(app)/opportunities/[opportunityId]/memo/page.tsx");
    expect(memoPage).toMatch(/canShare=\{auth\.role === "reiwa_admin"\}/);
    expect(read("src/app/(app)/opportunities/[opportunityId]/publication/page.tsx")).toContain("isPortalAdmin(auth)");
    expect(read("src/components/layout/sidebar.tsx").match(/user\.role === "reiwa_admin"/g)?.length).toBe(2);
  });
});
