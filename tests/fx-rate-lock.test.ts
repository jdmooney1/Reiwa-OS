// ============================================================================
// The FX rate is locked when the committee approves (migration 0026), against
// real Postgres. The snapshot is taken by app.apply_ic_decision() in the same
// statement that flips the case to approved, and the existing immutability trigger
// (app.block_if_approved_case) is what keeps it. Nothing here goes through the UI.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminQuery, withSession, type Session } from "@/lib/db/client";
import { createOpportunity } from "@/lib/data/opportunities";
import { createVersion } from "@/lib/data/underwriting";
import { recordDecision } from "@/lib/data/ic-decisions";
import { loadMemoSource } from "@/lib/data/memos";
import { composeMemo } from "@/lib/memo/compose";
import { orgIdByName, orgUserSession, profileIdByEmail } from "./helpers";

interface Row { currency: string; rate_to_gbp: string; as_of_date: string; source: string; updated_by: string | null; updated_at: string | null }
let original: Row[];
let session: Session;
let meiji: string;

const setRate = (currency: string, rate: number, asOf: string, source: string) => adminQuery(
  `insert into fx_rates (currency, rate_to_gbp, as_of_date, source) values ($1,$2,$3,$4)
   on conflict (currency) do update set rate_to_gbp = excluded.rate_to_gbp, as_of_date = excluded.as_of_date, source = excluded.source`,
  [currency, rate, asOf, source]);

const lockOf = async (caseId: string) => (await adminQuery<{ rate: string | null; source: string | null; as_of: string | null; status: string }>(
  `select fx_rate_to_gbp_at_approval::text rate, fx_rate_source_at_approval source, fx_rate_as_of_at_approval::text as_of, status
     from investment_cases where case_id = $1`, [caseId]))[0];

let n = 0;
async function deal(currency: string, price = 10_000_000) {
  const opp = await createOpportunity(session, {
    orgId: meiji, name: `FX Lock ${++n} ${currency}`, city: "Amsterdam", country: "Netherlands",
    market: "Amsterdam", assetType: "office", strategy: "value_add", currency,
  });
  const caseId = await createVersion(session, opp, { acquisitionPrice: price, targetIrr: 14 });
  return { opp, caseId };
}

beforeAll(async () => {
  original = await adminQuery<Row>("select currency, rate_to_gbp::text, as_of_date::text, source, updated_by, updated_at from fx_rates");
  meiji = await orgIdByName("Meiji Shipping");
  session = orgUserSession([meiji], await profileIdByEmail("analyst@meiji.com"));
  await setRate("EUR", 0.86, "2026-09-20", "ECB reference rate (auto)");
});

afterAll(async () => {
  await adminQuery("delete from fx_rates where currency <> all($1)", [original.map((r) => r.currency)]);
  for (const r of original) {
    await adminQuery(`update fx_rates set rate_to_gbp=$2, as_of_date=$3, source=$4, updated_by=$5, updated_at=$6 where currency=$1`,
      [r.currency, r.rate_to_gbp, r.as_of_date, r.source, r.updated_by, r.updated_at]);
  }
});

describe("approving a case locks the rate live at that moment", () => {
  it("a draft case has none of the three", async () => {
    const { caseId } = await deal("EUR");
    expect(await lockOf(caseId)).toMatchObject({ rate: null, source: null, as_of: null });
  });

  it("approval snapshots the rate, its source and its date, from the fx_rates row for the deal's currency", async () => {
    const { opp, caseId } = await deal("EUR");
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved" });
    expect(await lockOf(caseId)).toEqual({ rate: "0.860000", source: "ECB reference rate (auto)", as_of: "2026-09-20", status: "approved" });
  });

  it("is taken from the case's own currency, not whichever rate happens to be first", async () => {
    await setRate("USD", 0.75, "2026-09-21", "Bloomberg close");
    const { opp, caseId } = await deal("USD");
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved_with_conditions", conditions: "Subject to survey." });
    expect(await lockOf(caseId)).toMatchObject({ rate: "0.750000", source: "Bloomberg close", as_of: "2026-09-21" });
  });

  it("locks GBP at 1 like any other", async () => {
    const { opp, caseId } = await deal("GBP");
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved" });
    expect((await lockOf(caseId)).rate).toBe("1.000000");
  });

  it("a deferral or a rejection locks nothing and leaves the case unapproved", async () => {
    for (const outcome of ["deferred", "rejected"] as const) {
      const { opp, caseId } = await deal("EUR");
      await recordDecision(session, opp, { investmentCaseId: caseId, outcome });
      expect(await lockOf(caseId), outcome).toMatchObject({ rate: null, source: null, as_of: null, status: "current" });
    }
  });

  it("with no rate for the currency, the case is still approved and the lock stays NULL (nothing is invented)", async () => {
    const { opp, caseId } = await deal("CHF");
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved" });
    expect(await lockOf(caseId)).toEqual({ rate: null, source: null, as_of: null, status: "approved" });
  });
});

describe("nothing later changes the lock", () => {
  it("a change to fx_rates afterwards does not touch the approved case", async () => {
    const { opp, caseId } = await deal("EUR");
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved" });
    const before = await lockOf(caseId);
    await setRate("EUR", 0.91, "2026-10-01", "Some other source");
    expect(await lockOf(caseId)).toEqual(before);
    await setRate("EUR", 0.86, "2026-09-20", "ECB reference rate (auto)");
  });

  it("a second approving decision on an already-approved case does not re-lock at the new rate", async () => {
    await setRate("EUR", 0.86, "2026-09-20", "ECB reference rate (auto)");
    const { opp, caseId } = await deal("EUR");
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved" });
    await setRate("EUR", 0.95, "2026-10-02", "ECB reference rate (auto)");
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved_with_conditions", conditions: "Revisit." });
    expect((await lockOf(caseId)).rate).toBe("0.860000");
    await setRate("EUR", 0.86, "2026-09-20", "ECB reference rate (auto)");
  });

  it.each([
    ["fx_rate_to_gbp_at_approval", "0.5"],
    ["fx_rate_source_at_approval", "'Edited'"],
    ["fx_rate_as_of_at_approval", "'2020-01-01'"],
  ])("a direct update of %s on an approved case is refused by the trigger, even for the privileged connection", async (col, value) => {
    const { opp, caseId } = await deal("EUR");
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved" });
    await expect(adminQuery(`update investment_cases set ${col} = ${value} where case_id = $1`, [caseId])).rejects.toThrow(/immutable/);
    await expect(withSession(session, (tx) => tx.query(`update investment_cases set ${col} = ${value} where case_id = $1`, [caseId]))).rejects.toThrow();
  });

  it("clearing the lock is refused as well", async () => {
    const { opp, caseId } = await deal("EUR");
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved" });
    await expect(adminQuery(
      `update investment_cases set fx_rate_to_gbp_at_approval = null, fx_rate_source_at_approval = null, fx_rate_as_of_at_approval = null where case_id = $1`,
      [caseId])).rejects.toThrow(/immutable/);
  });

  it("the immutability trigger covers the new columns by default: it names what MAY move, not what may not", async () => {
    const { rows } = await adminQuery<{ src: string }>("select pg_get_functiondef('app.block_if_approved_case'::regproc) as src").then((r) => ({ rows: r }));
    expect(rows[0].src).toContain("to_jsonb(old) - 'status' - 'superseded_at' - 'total_cost'");
    expect(rows[0].src).not.toMatch(/fx_rate/);
  });

  it("superseding a case by approving a later version keeps the old lock and locks the new one at its own moment", async () => {
    await setRate("EUR", 0.86, "2026-09-20", "ECB reference rate (auto)");
    const { opp, caseId: v1 } = await deal("EUR");
    await recordDecision(session, opp, { investmentCaseId: v1, outcome: "approved" });
    await setRate("EUR", 0.9, "2026-10-01", "ECB reference rate (auto)");
    const v2 = await createVersion(session, opp, { acquisitionPrice: 12_000_000, targetIrr: 13 });
    await recordDecision(session, opp, { investmentCaseId: v2, outcome: "approved" });
    expect(await lockOf(v1)).toMatchObject({ rate: "0.860000", as_of: "2026-09-20", status: "superseded" });
    expect(await lockOf(v2)).toMatchObject({ rate: "0.900000", as_of: "2026-10-01", status: "approved" });
    await setRate("EUR", 0.86, "2026-09-20", "ECB reference rate (auto)");
  });
});

describe("the lock is all-or-nothing and only for approved cases", () => {
  it("refuses a partial lock", async () => {
    const { caseId } = await deal("EUR");
    await expect(adminQuery("update investment_cases set fx_rate_to_gbp_at_approval = 0.8 where case_id = $1", [caseId])).rejects.toThrow(/investment_cases_fx_lock/);
  });

  it("refuses a lock on a case that has not been approved", async () => {
    const { caseId } = await deal("EUR");
    await expect(adminQuery(
      `update investment_cases set fx_rate_to_gbp_at_approval = 0.8, fx_rate_source_at_approval = 'x', fx_rate_as_of_at_approval = '2026-09-01' where case_id = $1`,
      [caseId])).rejects.toThrow(/investment_cases_fx_lock_only_when_approved/);
  });
});

describe("the memo shows the locked rate and the current rate as two figures", () => {
  it("loads the lock for an approved basis and composes both, labelled", async () => {
    await setRate("EUR", 0.86, "2026-09-20", "ECB reference rate (auto)");
    const { opp, caseId } = await deal("EUR");
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved" });
    await setRate("EUR", 0.9, "2026-10-01", "ECB reference rate (auto)");

    const src = (await loadMemoSource(session, opp))!;
    expect(src.basis.kind).toBe("approved");
    expect(src.fxLock).toMatchObject({ rateToGbp: 0.86, source: "ECB reference rate (auto)", asOf: "2026-09-20" });
    expect(src.fxLock!.approvedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(src.fx).toMatchObject({ rateToGbp: 0.9, asOf: "2026-10-01" });

    const s = composeMemo(src).sections.fx_sensitivity;
    const t = JSON.stringify(s.blocks);
    expect(t).toContain("Rate locked at approval (EUR to GBP)");
    expect(t).toContain("Current rate (live): EUR to GBP");
    expect(t).toContain("Movement since approval");
    await setRate("EUR", 0.86, "2026-09-20", "ECB reference rate (auto)");
  });

  it("a working (unapproved) basis has no lock", async () => {
    const { opp } = await deal("EUR");
    const src = (await loadMemoSource(session, opp))!;
    expect(src.fxLock).toBeNull();
  });

  it("an approved case with no recorded lock loads as null, and with no rate at all the section is empty rather than invented", async () => {
    const { opp, caseId } = await deal("CHF");
    await recordDecision(session, opp, { investmentCaseId: caseId, outcome: "approved" });
    const src = (await loadMemoSource(session, opp))!;
    expect(src.fxLock).toBeNull();
    const s = composeMemo(src).sections.fx_sensitivity;
    expect(s.status).toBe("empty");
    expect(s.emptyReason).toMatch(/no exchange rate/);
  });
});
