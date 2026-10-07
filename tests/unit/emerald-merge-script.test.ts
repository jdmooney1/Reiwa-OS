// ============================================================================
// The merge script and migration 0036, held by what they must never do.
// ----------------------------------------------------------------------------
// The behaviour is proved against Postgres in tests/emerald-merge.test.ts. These are the properties that
// must be true of the FILES themselves, so a later edit cannot quietly turn a reviewed dry run into a
// deletion or an auto-applied change.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const sqlCode = (rel: string) => read(rel).replace(/--.*$/gm, "");
const SCRIPT = "supabase/one-off/2026-10-07_merge_emerald_duplicate.sql";

describe("the merge script is reviewable and cannot run by accident", () => {
  it("lives outside supabase/migrations, so scripts/migrate.ts never applies it to a database", () => {
    expect(readdirSync(join(ROOT, "supabase/migrations")).filter((f) => /emerald|merge_emerald/i.test(f))).toEqual([]);
    // The only directory the migration runner reads is supabase/migrations.
    expect(read("src/lib/db/client.ts")).toMatch(/MIGRATIONS_DIR = join\(process\.cwd\(\), "supabase", "migrations"\)/);
    expect(read("src/lib/db/client.ts") + read("scripts/migrate.ts")).not.toMatch(/one-off/);
  });

  it("is a dry run until someone changes the switch", () => {
    expect(sqlCode(SCRIPT)).toMatch(/v_apply\s+boolean := false;/);
    expect(sqlCode(SCRIPT)).toMatch(/if not v_apply then\s+raise exception[^;]*DRY RUN - NOTHING WAS CHANGED/s);
  });

  it("is one DO block, so it is atomic: no transaction control inside it", () => {
    const code = sqlCode(SCRIPT);
    expect(code.match(/\bdo \$merge\$/g)).toHaveLength(1);
    expect(code).not.toMatch(/\b(begin transaction|commit|rollback|savepoint)\b/i);
  });

  it("never deletes, drops, truncates or alters anything", () => {
    const code = sqlCode(SCRIPT);
    expect(code).not.toMatch(/\b(delete\s+from|drop\s+|truncate|alter\s+table|create\s+table|disable\s+trigger)\b/i);
  });

  it("writes only to the five tables the plan names", () => {
    const code = sqlCode(SCRIPT);
    const written = new Set([...code.matchAll(/\b(?:update|insert\s+into)\s+public\.(\w+)/gi)].map((m) => m[1]));
    expect([...written].sort()).toEqual(["deal_load_rows", "investment_cases", "opportunities", "properties", "property_events"]);
  });

  it("names the two records of the incident and nothing else", () => {
    const ids = [...new Set(read(SCRIPT).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [])].sort();
    expect(ids).toEqual(["0f4d3e03-02ef-4957-918d-1ffb9d75bd48", "b5c09009-02e1-4350-b163-e6c62fb74714"]);
  });

  it("keeps the guards that make it stop on a surprise", () => {
    const code = sqlCode(SCRIPT);
    for (const guard of [
      "does not exist", "same record", "different organisations", "already merged", "not an active, unarchived record",
      "does not look like a deal-seed record", "is not newer than the survivor", "must be bound to a property",
      "dependent records this script does not handle", "underwriting cases (expected at most 1)",
      "only a draft or current case may be moved", "prices differ by more than 1%", "different broker firm",
      "POSTCONDITION FAILED",
    ]) expect(code, guard).toContain(guard);
  });

  it("fills only what is empty on the survivor", () => {
    const code = sqlCode(SCRIPT);
    for (const col of ["source_contact_name", "source", "deal_stage", "data_completeness", "size_sqft"]) {
      expect(code, col).toMatch(new RegExp(`${col}\\s*=\\s*coalesce\\(o\\.${col}, x\\.${col}\\)`));
    }
    expect(code).toMatch(/status = 'draft'/);
    expect(code).not.toMatch(/version = next_version, status = 'current'/);
  });

  it("has a read-only verify script beside it", () => {
    const verify = sqlCode("supabase/one-off/2026-10-07_merge_emerald_duplicate_verify.sql");
    expect(verify).not.toMatch(/\b(insert|update|delete|drop|alter|truncate|create)\b/i);
    expect(verify.match(/\bselect\b/gi)!.length).toBeGreaterThanOrEqual(6);
  });
});

describe("migration 0036", () => {
  const m = sqlCode("supabase/migrations/0036_merged_status.sql");
  it("admits merged, ties it to a pointer in both directions, and refuses self-merge", () => {
    expect(m).toMatch(/status in \('active', 'rejected', 'withdrawn', 'lost', 'converted', 'merged'\)/);
    expect(m).toMatch(/\(status = 'merged'\) = \(merged_into_opportunity_id is not null\)/);
    expect(m).toMatch(/merged_into_opportunity_id is distinct from opportunity_id/);
    expect(m).toMatch(/on delete restrict/);
  });
  it("changes no row and no policy", () => {
    expect(m).not.toMatch(/\b(insert\s+into|update\s+public|delete\s+from|create\s+policy|drop\s+policy|grant|revoke)\b/i);
  });
  it("the app knows the word: type, labels, and the two guards", () => {
    expect(read("src/lib/data/opportunity-types.ts")).toMatch(/"converted" \| "merged"/);
    expect(read("src/lib/workspace/labels.ts")).toMatch(/merged: "Merged"/);
    const o = read("src/lib/data/opportunities.ts");
    expect(o).toMatch(/status === "merged"\) throw new AppError\("A record can only be marked as merged/);
    expect(o).toMatch(/cannot be reactivated/);
    expect(read("src/components/opportunities/opportunity-pipeline.tsx")).toMatch(/triageProgress\(opportunities\.filter\(\(o\) => o\.status !== "merged"\)\)/);
  });
});
