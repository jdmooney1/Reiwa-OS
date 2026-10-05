// ============================================================================
// Investment Scores (migration 0024) against real Postgres.
// ----------------------------------------------------------------------------
// Org-scoped, write-gated, append-only by convention, and never a verdict from
// half the criteria. Seeded data (Meiji Shipping / Aoyama Holdings) as elsewhere.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminQuery, withInvestorSession, type Session } from "@/lib/db/client";
import { saveScore, listScores, latestScore, latestCompleteScore } from "@/lib/data/scores";
import { loadMemoSource } from "@/lib/data/memos";
import { composeMemo } from "@/lib/memo/compose";
import { SCORE_CATEGORIES } from "@/lib/scoring/model";
import type { CategoryScore } from "@/lib/scoring/score";
import { investorAuthUserId, orgIdByName, orgUserSession, viewerSession, profileIdByEmail } from "./helpers";

let meiji: string;
let analyst: string;
let writer: Session;
let viewer: Session;
let otherOrg: Session;
let opp: string;

const full = (score: number, over: Record<string, Partial<CategoryScore>> = {}): CategoryScore[] =>
  SCORE_CATEGORIES.map((d) => ({ key: d.key, score, commentary: "", riskFlag: false, ...over[d.key] }));

async function wipe() {
  await adminQuery("delete from investment_scores where opportunity_id = $1", [opp]);
}

beforeAll(async () => {
  meiji = await orgIdByName("Meiji Shipping");
  analyst = await profileIdByEmail("analyst@meiji.com");
  writer = orgUserSession([meiji], analyst);
  viewer = viewerSession([meiji], await profileIdByEmail("viewer@meiji.com"));
  otherOrg = orgUserSession([await orgIdByName("Aoyama Holdings")], await profileIdByEmail("user@aoyama.com"));
  opp = (await adminQuery<{ opportunity_id: string }>("select opportunity_id from opportunities where name = 'Magna Plaza'"))[0].opportunity_id;
  await wipe();
});
afterAll(async () => { await wipe(); });

describe("recording a score", () => {
  it("a part-finished score is saved with NO overall and NO recommendation", async () => {
    const id = await saveScore(writer, opp, [{ key: "location_quality", score: 9, commentary: "Prime", riskFlag: false }]);
    const h = (await adminQuery<{ overall: string | null; recommendation: string | null; version: number }>(
      "select overall, recommendation, version from investment_scores where score_id = $1", [id]))[0];
    expect(h).toEqual({ overall: null, recommendation: null, version: 1 });
    const cats = await adminQuery("select 1 from investment_score_categories where score_id = $1", [id]);
    expect(cats).toHaveLength(1);                       // only scored criteria get a row
    const s = (await latestScore(writer, opp))!;
    expect(s.view).toMatchObject({ complete: false, overall: null, scored: 1 });
    expect(await latestCompleteScore(writer, opp)).toBeNull();
  });

  it("a complete score stores the overall and band computed through the model, as the next version", async () => {
    await saveScore(writer, opp, full(8, { capex_risk: { score: 4, commentary: "Wide QS range", riskFlag: true } }));
    const s = (await latestScore(writer, opp))!;
    expect(s.version).toBe(2);
    expect(s.view).toMatchObject({ complete: true, overall: 76, recommendation: "proceed", flagged: ["capex_risk"] });
    expect(s.recordedOverall).toBe(76);
    expect(s.recordedRecommendation).toBe("proceed");
    expect(s.drift).toBe(false);
    expect(s.categories).toHaveLength(11);
    expect(s.categories.find((c) => c.key === "capex_risk")).toMatchObject({ score: 4, commentary: "Wide QS range", riskFlag: true });
  });

  it("every save is a NEW version: earlier ones are kept exactly as recorded", async () => {
    await saveScore(writer, opp, full(6));
    const all = await listScores(writer, opp);
    expect(all.map((s) => [s.version, s.view.overall])).toEqual([[3, 60], [2, 76], [1, null]]);
    expect(all[1].categories.find((c) => c.key === "capex_risk")?.score).toBe(4);
  });

  it("the newest COMPLETE score is not a newer part-finished one", async () => {
    await saveScore(writer, opp, [{ key: "location_quality", score: 2, commentary: "", riskFlag: false }]);   // v4, partial
    expect((await latestScore(writer, opp))!.version).toBe(4);
    expect((await latestCompleteScore(writer, opp))!.version).toBe(3);
  });

  it("a read recomputes through TODAY's model and flags drift from what was recorded", async () => {
    const v3 = (await listScores(writer, opp)).find((s) => s.version === 3)!;
    await adminQuery("update investment_scores set overall = 99.9, recommendation = 'strong_proceed' where score_id = $1", [v3.scoreId]);
    const again = (await listScores(writer, opp)).find((s) => s.version === 3)!;
    expect(again.view.overall).toBe(60);                // not the stored 99.9
    expect(again.recordedOverall).toBe(99.9);
    expect(again.drift).toBe(true);
  });
});

describe("the database keeps scores well-formed", () => {
  let id: string;
  beforeAll(async () => { id = (await listScores(writer, opp))[0].scoreId; });
  const cat = (over: Record<string, unknown>) => adminQuery(
    `insert into investment_score_categories (score_id, org_id, category_key, score, commentary, risk_flag)
     values ($1, $2, $3, $4, $5, $6)`,
    [over.score_id ?? id, over.org_id ?? meiji, over.key ?? "strategic_fit", over.score ?? 5, over.commentary ?? null, over.flag ?? false]);

  it("scores are 1 to 10 in half points", async () => {
    for (const bad of [0, 0.5, 10.5, 7.3, 11]) await expect(cat({ score: bad }), String(bad)).rejects.toMatchObject({ code: "23514" });
  });

  it("a flag without an explanation is refused", async () => {
    await expect(cat({ flag: true, commentary: "  " })).rejects.toMatchObject({ code: "23514" });
    await expect(cat({ flag: true })).rejects.toMatchObject({ code: "23514" });
  });

  it("overall and recommendation exist together or not at all", async () => {
    await expect(adminQuery(
      `insert into investment_scores (org_id, opportunity_id, version, overall, scored_by) values ($1, $2, 90, 50, $3)`,
      [meiji, opp, analyst])).rejects.toMatchObject({ code: "23514" });
  });

  it("a criterion is scored once per version, and a category row cannot carry another organisation's id", async () => {
    await cat({ key: "strategic_fit" });
    await expect(cat({ key: "strategic_fit" })).rejects.toMatchObject({ code: "23505" });
    await expect(cat({ key: "capex_risk", org_id: "00000000-0000-4000-8000-000000000000" })).rejects.toMatchObject({ code: "23503" });
  });

  it("a version number is used once, and there is no summary column", async () => {
    await expect(adminQuery(
      `insert into investment_scores (org_id, opportunity_id, version, scored_by) values ($1, $2, 1, $3)`, [meiji, opp, analyst])).rejects.toMatchObject({ code: "23505" });
    const cols = await adminQuery<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'investment_scores'");
    expect(cols.map((c) => c.column_name)).not.toContain("summary");
    expect(cols.map((c) => c.column_name)).not.toEqual(expect.arrayContaining(["weight"]));
  });
});

describe("who can read and write", () => {
  it("a read-only session can read scores but cannot record one", async () => {
    expect((await listScores(viewer, opp)).length).toBeGreaterThan(0);
    await expect(saveScore(viewer, opp, full(5))).rejects.toBeTruthy();
  });

  it("another organisation sees no score of this one, and cannot record against its opportunity", async () => {
    expect(await listScores(otherOrg, opp)).toEqual([]);
    await expect(saveScore(otherOrg, opp, full(5))).rejects.toThrow(/could not be found/);
  });

  it("an investor session reads no score and cannot write one, at any tier", async () => {
    for (const email of ["principal@kitano-fo.example", "partner@sakura-cap.example"]) {
      const uid = await investorAuthUserId(email);
      for (const t of ["investment_scores", "investment_score_categories"]) {
        const n = await withInvestorSession(uid, (tx) => tx.query(`select count(*)::int as n from ${t}`));
        expect((n.rows[0] as { n: number }).n, `${email} ${t}`).toBe(0);
      }
      await expect(withInvestorSession(uid, (tx) => tx.query(
        "insert into investment_scores (org_id, opportunity_id, version, scored_by) values ($1, $2, 91, $3)", [meiji, opp, analyst]))).rejects.toBeTruthy();
    }
  });

  it("has the four standard policies on each table, all organisation-scoped, and nothing for anon", async () => {
    for (const t of ["investment_scores", "investment_score_categories"]) {
      const pol = await adminQuery<{ policyname: string; qual: string | null; with_check: string | null }>(
        "select policyname, qual, with_check from pg_policies where tablename = $1 order by 1", [t]);
      expect(pol.map((p) => p.policyname)).toEqual([`${t}_delete`, `${t}_insert`, `${t}_select`, `${t}_update`]);
      for (const p of pol) expect(`${p.qual ?? ""}${p.with_check ?? ""}`).toContain("has_org");
      const anon = await adminQuery<{ n: string }>("select count(*)::text n from information_schema.role_table_grants where table_name = $1 and grantee in ('anon', 'PUBLIC')", [t]);
      expect(anon[0].n).toBe("0");
    }
  });
});

describe("the memo reads the score", () => {
  it("the Recommendation section composes from the newest COMPLETE score, ignoring a newer part-finished one", async () => {
    const src = (await loadMemoSource(writer, opp))!;
    expect(src.score).toMatchObject({ version: 3, overall: 60, recommendationLabel: "Proceed with Caution" });
    expect(src.score!.categories).toHaveLength(11);
    const rec = composeMemo(src).sections.recommendation;
    expect(rec.status).toBe("composed");
    expect(rec.flags).toContain("No investment committee decision is recorded");
  });

  it("with no complete score at all the section is empty again, naming both gaps", async () => {
    await adminQuery("delete from investment_scores where opportunity_id = $1 and version in (2, 3)", [opp]);
    const src = (await loadMemoSource(writer, opp))!;
    expect(src.score).toBeNull();
    expect(composeMemo(src).sections.recommendation.emptyReason).toMatch(/No Investment Score and no investment committee decision/);
  });
});
