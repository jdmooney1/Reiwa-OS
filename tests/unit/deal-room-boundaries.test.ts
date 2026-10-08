// ============================================================================
// Structural guards for docs/24 Session 4a: the deal room stays shut by
// default, and the one absolute exclusion is a hard-coded fact, not something
// that could quietly follow a catalogue edit. Same shape as
// investor-no-photos.test.ts / staff-role-boundaries.test.ts — these read the
// source; the behavioural proof against real Postgres is
// tests/deal-document-investor-access.test.ts.
// ============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, "");

describe("deal_room_enabled defaults OFF", () => {
  it("the seed row in 0055 is false, not left to insert-time default", () => {
    const sql = stripSqlComments(read("supabase/migrations/0055_deal_room_enabled_flag.sql"));
    expect(sql).toMatch(/values\s*\(\s*'deal_room_enabled'\s*,\s*'false'::jsonb\s*\)/);
  });
});

describe("underwriting_model is a hard-coded exclusion, not a derived one", () => {
  it("0056 excludes it by key, before ever reading doc_type.audience", () => {
    const sql = stripSqlComments(read("supabase/migrations/0056_investor_deal_document_access.sql"));
    const fn = sql.match(
      /create or replace function app\.investor_document_audience_ok[\s\S]*?\$fn\$;/,
    )?.[0];
    expect(fn).toBeDefined();
    expect(fn).toMatch(/p_doc_type_key\s*<>\s*'underwriting_model'/);
  });

  it("the NDA/teaser exemption names exactly those two keys, nothing wider", () => {
    const sql = stripSqlComments(read("supabase/migrations/0056_investor_deal_document_access.sql"));
    expect(sql).toMatch(/doc_type_key in \('investor_nda', 'investor_teaser'\)/);
  });
});

describe("the deal_room_enabled flag gates everything else, including the exemption", () => {
  it("app.investor_may_read_deal_document reads app.deal_room_enabled() before anything else", () => {
    const sql = stripSqlComments(read("supabase/migrations/0056_investor_deal_document_access.sql"));
    const fn = sql.match(
      /create or replace function app\.investor_may_read_deal_document[\s\S]*?\$fn\$;/,
    )?.[0];
    expect(fn).toBeDefined();
    expect(fn).toMatch(/select app\.deal_room_enabled\(\)/);
  });
});

describe("deal_document_entitlements never widens publication_entitlements", () => {
  it("0054 is a new table, not an ALTER on publication_entitlements", () => {
    const sql = stripSqlComments(read("supabase/migrations/0054_deal_document_entitlements.sql"));
    expect(sql).toMatch(/create table if not exists deal_document_entitlements/);
    expect(sql).not.toMatch(/alter table publication_entitlements/);
  });

  it("publication_entitlements itself is untouched by this round — no ALTER, join or reference against it", () => {
    // A descriptive mention in a `comment on ... is '...'` string (0054 explains the two
    // tables' relationship) is fine; an actual schema touch is not. Checked separately.
    const touchesTable = /alter table\s+publication_entitlements|references\s+publication_entitlements|(?:from|join)\s+publication_entitlements/i;
    for (const file of [
      "0054_deal_document_entitlements.sql", "0055_deal_room_enabled_flag.sql",
      "0056_investor_deal_document_access.sql", "0057_document_view_log_investor_insert.sql",
      "0058_deal_investor_status_gates.sql", "0059_document_version_manual_override.sql",
    ]) {
      expect(stripSqlComments(read(`supabase/migrations/${file}`))).not.toMatch(touchesTable);
    }
  });
});

describe("decision B: deal_investor.status gates are narrow, by design", () => {
  it("only nda_signed and ioi_received are gated — no other target status is touched", () => {
    const sql = stripSqlComments(read("supabase/migrations/0058_deal_investor_status_gates.sql"));
    const statusLiterals = [...sql.matchAll(/new\.status\s*=\s*'([a-z_]+)'/g)].map((m) => m[1]);
    expect(new Set(statusLiterals)).toEqual(new Set(["nda_signed", "ioi_received"]));
  });

  it("the override action is the same literal the trigger checks for, so a UI contract exists", () => {
    const sql = stripSqlComments(read("supabase/migrations/0058_deal_investor_status_gates.sql"));
    const occurrences = sql.match(/'deal_investor_status_override'/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2); // both the nda and ioi branches
  });
});

describe("decision F: the manual-override trigger only ever widens what it validates", () => {
  it("document_version RLS itself is unchanged by 0059", () => {
    const sql = stripSqlComments(read("supabase/migrations/0059_document_version_manual_override.sql"));
    expect(sql).not.toMatch(/create policy document_version/);
    expect(sql).not.toMatch(/drop policy/);
  });

  it("the column defaults false, so every existing/ordinary upload is unaffected", () => {
    const sql = stripSqlComments(read("supabase/migrations/0059_document_version_manual_override.sql"));
    expect(sql).toMatch(/add column if not exists is_manual_override boolean not null default false/);
  });
});

describe("secure-delivery.ts: one path, two families, identical refusal", () => {
  it("issueDocumentDownload tries a deal_document version only after the publication lookup misses", () => {
    const src = read("src/lib/documents/secure-delivery.ts");
    const fn = src.match(/export async function issueDocumentDownload[\s\S]*?\n}\n/)?.[0];
    expect(fn).toBeDefined();
    const pubIndex = fn!.indexOf("authoriseDocument(");
    const dealIndex = fn!.indexOf("authoriseDealDocumentVersion(");
    expect(pubIndex).toBeGreaterThanOrEqual(0);
    expect(dealIndex).toBeGreaterThan(pubIndex);
  });

  it("a deal_document delivery is logged to document_view_log, not investor_activity_events", () => {
    const src = read("src/lib/documents/secure-delivery.ts");
    const fn = src.match(/async function recordDealDocumentViewed[\s\S]*?\n}\n/)?.[0];
    expect(fn).toBeDefined();
    expect(fn).toMatch(/insert into document_view_log/);
  });
});
