// ============================================================================
// Pre-finalisation reviews (migration 0030) against real Postgres.
// ----------------------------------------------------------------------------
// Three things are being proved here, and only the database can prove them:
//
//   1. ONE ROW PER REVIEW, holding exactly the findings that came back. The
//      question this table exists to answer - "was this memo reviewed before it
//      went out, and what did the review say" - is only answerable if a run
//      leaves exactly one record and that record is faithful.
//   2. THE REVIEW CANNOT TOUCH THE MEMO. Recording one leaves the memos row
//      byte-identical, and the memo finalises afterwards exactly as it would
//      have otherwise. A review is advice held beside the document, not a
//      change to it and not a gate on it.
//   3. ADMINISTRATOR ONLY, AND APPEND-ONLY. Staff who are not Reiwa
//      administrators can neither read nor write a review, and nobody can edit
//      or delete one through the application connection.
//
// The MODEL IS NEVER CALLED from this file. runReview() is not imported: these
// tests exercise the data layer and the database with findings written by hand,
// so the suite costs nothing to run, is deterministic, and still proves the
// storage contract. What the model may return is constrained by the schema and
// covered in tests/unit/memo-review-prompt.test.ts.
//
// The fixture is read positionally (the first opportunity with an org) rather
// than by organisation name, so this file names no counterparty.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminQuery, type Session } from "@/lib/db/client";
import { recordReview, listReviews } from "@/lib/data/memo-reviews";
import { reviewRefusalReason } from "@/lib/memo-review/eligibility";
import type { Finding } from "@/lib/memo-review/findings";
import { adminSession, orgUserSession, seededUserId } from "./helpers";

const CONTENT = '{"currency":"GBP","assetName":"Fixture","basis":{"kind":"none","caseId":null,"version":null,"caseStatus":null},"sections":{}}';

const FINDINGS: Finding[] = [
  {
    category: "numeric_inconsistency",
    label: "Net initial yield differs between sections",
    sections: ["key_metrics", "financial_analysis"],
    reason: "The two sections state different net initial yields for the same case.",
  },
  {
    category: "unresolved_gap",
    label: "Gap marker left in Further DD",
    sections: ["further_dd"],
    reason: "The section still carries a not-yet-captured placeholder.",
  },
];

let orgId: string;
let opportunityId: string;
let analyst: string;
let draftMemo: string;
let finalMemo: string;
let staff: Session;

/** A memo row inserted on the privileged connection: no RLS, no data layer. */
async function rawMemo(version: number, status: "draft" | "final"): Promise<string> {
  const stamp = status === "final" ? `, '${analyst}', now()` : ", null, null";
  const rows = await adminQuery<{ memo_id: string }>(
    `insert into memos (org_id, opportunity_id, version, status, content, overrides, created_by, finalized_by, finalized_at)
     values ($1, $2, $3, $4, $5::jsonb, '{}'::jsonb, $6 ${stamp}) returning memo_id`,
    [orgId, opportunityId, version, status, CONTENT, analyst]);
  return rows[0].memo_id;
}

beforeAll(async () => {
  const opp = await adminQuery<{ opportunity_id: string; org_id: string }>(
    "select opportunity_id, org_id from opportunities order by opportunity_id limit 1");
  opportunityId = opp[0].opportunity_id;
  orgId = opp[0].org_id;
  analyst = seededUserId("analyst");
  staff = orgUserSession([orgId], analyst);

  // A clean slate for this opportunity: the suite shares one database.
  await adminQuery("alter table memos disable trigger trg_memos_guard");
  await adminQuery("delete from memos where opportunity_id = $1", [opportunityId]);
  await adminQuery("alter table memos enable trigger trg_memos_guard");

  draftMemo = await rawMemo(1, "draft");
  finalMemo = await rawMemo(2, "final");
});

afterAll(async () => {
  await adminQuery("delete from memo_ai_reviews where memo_id = any($1::uuid[])", [[draftMemo, finalMemo]]);
  await adminQuery("alter table memos disable trigger trg_memos_guard");
  await adminQuery("delete from memos where opportunity_id = $1", [opportunityId]);
  await adminQuery("alter table memos enable trigger trg_memos_guard");
});

describe("one row per review, holding what came back", () => {
  it("records exactly one row, with the findings stored as returned", async () => {
    const before = await adminQuery<{ n: string }>(
      "select count(*)::text as n from memo_ai_reviews where memo_id = $1", [draftMemo]);

    const stored = await recordReview(adminSession, draftMemo, "claude-opus-5", FINDINGS);

    const after = await adminQuery<{ n: string }>(
      "select count(*)::text as n from memo_ai_reviews where memo_id = $1", [draftMemo]);
    expect(Number(after[0].n) - Number(before[0].n)).toBe(1);

    expect(stored.model).toBe("claude-opus-5");
    expect(stored.findings).toEqual(FINDINGS);
    expect(stored.memoId).toBe(draftMemo);
  });

  it("stores the findings verbatim in the column, not a rendering of them", async () => {
    const rows = await adminQuery<{ findings: unknown; model: string; created_by: string }>(
      "select findings, model, created_by from memo_ai_reviews where memo_id = $1 order by created_at desc limit 1",
      [draftMemo]);
    expect(rows[0].findings).toEqual(FINDINGS);
    expect(rows[0].created_by).toBe(adminSession.userId);
  });

  it("an empty review is a real record, distinct from never having run one", async () => {
    const stored = await recordReview(adminSession, draftMemo, "claude-opus-5", []);
    expect(stored.findings).toEqual([]);
    const rows = await adminQuery<{ findings: unknown }>(
      "select findings from memo_ai_reviews where review_id = $1", [stored.reviewId]);
    expect(rows[0].findings).toEqual([]);
  });

  it("a second run is a second row: a review is never overwritten", async () => {
    // Two runs have been recorded by the tests above (one with findings, one empty).
    const all = await listReviews(adminSession, draftMemo);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(new Set(all.map((r) => r.reviewId)).size).toBe(all.length);
  });

  it("lists newest first, and names who ran each one", async () => {
    const all = await listReviews(adminSession, draftMemo);
    const times = all.map((r) => Date.parse(r.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(all[0].createdByName).toBeTruthy();
  });

  it("findings are rejected by the column type if they are not a list", async () => {
    await expect(adminQuery(
      `insert into memo_ai_reviews (memo_id, model, findings) values ($1, 'm', '{"a":1}'::jsonb)`,
      [draftMemo])).rejects.toThrow();
  });
});

describe("a review changes nothing about the memo", () => {
  it("the memos row is identical before and after a review is recorded", async () => {
    const snapshot = async () => (await adminQuery<Record<string, unknown>>(
      `select content::text, overrides::text, status, composed_at, finalized_at, finalized_by
         from memos where memo_id = $1`, [draftMemo]))[0];

    const before = await snapshot();
    await recordReview(adminSession, draftMemo, "claude-opus-5", FINDINGS);
    expect(await snapshot()).toEqual(before);
  });

  it("a draft with open findings still finalises, and the review survives it", async () => {
    const reviews = await listReviews(adminSession, draftMemo);
    expect(reviews.some((r) => r.findings.length > 0)).toBe(true);

    // Exactly the update the finalise path makes. No finding blocks it.
    const done = await adminQuery<{ memo_id: string }>(
      `update memos set status = 'final', finalized_by = $2, finalized_at = now()
        where memo_id = $1 and status = 'draft' returning memo_id`, [draftMemo, analyst]);
    expect(done).toHaveLength(1);

    const after = await listReviews(adminSession, draftMemo);
    expect(after.map((r) => r.reviewId).sort()).toEqual(reviews.map((r) => r.reviewId).sort());
  });
});

describe("only a draft is reviewable", () => {
  it("the rule refuses a final memo and allows a draft", () => {
    expect(reviewRefusalReason("final")).toMatch(/Only a draft memo can be reviewed/);
    expect(reviewRefusalReason("draft")).toBeNull();
  });

  it("the memo the fixture finalised really is final, so the refusal is not hypothetical", async () => {
    const rows = await adminQuery<{ status: string }>(
      "select status from memos where memo_id = $1", [finalMemo]);
    expect(rows[0].status).toBe("final");
    expect(reviewRefusalReason(rows[0].status as "draft" | "final")).toBeTruthy();
  });
});

describe("administrator only, and append-only", () => {
  it("staff who are not Reiwa administrators cannot read a review", async () => {
    expect(await listReviews(staff, draftMemo)).toEqual([]);
  });

  it("staff who are not Reiwa administrators cannot record one", async () => {
    await expect(recordReview(staff, draftMemo, "claude-opus-5", FINDINGS)).rejects.toThrow();
  });

  it("`authenticated` holds no update, delete or truncate on the table", async () => {
    const rows = await adminQuery<{ priv: string }>(
      `select privilege_type as priv from information_schema.role_table_grants
        where table_name = 'memo_ai_reviews' and grantee = 'authenticated'`);
    expect(rows.map((r) => r.priv).sort()).toEqual(["INSERT", "SELECT"]);
  });

  it("`anon` holds nothing at all", async () => {
    const rows = await adminQuery<{ priv: string }>(
      `select privilege_type as priv from information_schema.role_table_grants
        where table_name = 'memo_ai_reviews' and grantee = 'anon'`);
    expect(rows).toEqual([]);
  });

  it("row level security is on, and every policy requires app.is_staff()", async () => {
    const [{ enabled }] = await adminQuery<{ enabled: boolean }>(
      "select relrowsecurity as enabled from pg_class where relname = 'memo_ai_reviews'");
    expect(enabled).toBe(true);

    const policies = await adminQuery<{ cmd: string; qual: string | null; withcheck: string | null }>(
      `select cmd, qual::text, with_check::text as withcheck from pg_policies
        where tablename = 'memo_ai_reviews'`);
    expect(policies.length).toBeGreaterThan(0);
    for (const p of policies) {
      // Internal staff (admin or staff, 0035), and only for a memo the caller can already see.
      const text = `${p.qual ?? ""}${p.withcheck ?? ""}`;
      expect(text).toContain("is_staff");
      expect(text).toContain("memos");
      expect(["SELECT", "INSERT"]).toContain(p.cmd);
    }
  });
});
