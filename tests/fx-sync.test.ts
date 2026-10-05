// ============================================================================
// The daily ECB sync against real Postgres: it keeps fx_rates current without a
// person, and it never overwrites one.
// ============================================================================
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { adminQuery, type Queryable } from "@/lib/db/client";
import { applyEcbRates, loadEcbRates, runFxSync, type FxDb } from "@/lib/data/fx-sync";
import { ECB_AUTO_SOURCE } from "@/lib/fx-ecb";
import { listFxRates } from "@/lib/data/fx-rates";
import { adminSession, profileIdByEmail } from "./helpers";

interface Row { currency: string; rate_to_gbp: string; as_of_date: string; source: string; updated_by: string | null; updated_at: string | null }
let original: Row[];
let adminId: string;

const db: FxDb = { query: async <T,>(sql: string, params?: unknown[]) => ({ rows: await adminQuery<T>(sql, params ?? []) }) };
const xml = (date: string, usd = "1.1620", jpy = "172.80", gbp = "0.8710") => `<gesmes:Envelope><Cube><Cube time='${date}'>
  <Cube currency='USD' rate='${usd}'/><Cube currency='JPY' rate='${jpy}'/><Cube currency='GBP' rate='${gbp}'/></Cube></Cube></gesmes:Envelope>`;
const feedOf = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;
const row = async (c: string) => (await adminQuery<Row>("select currency, rate_to_gbp::text, as_of_date::text, source, updated_by, updated_at from fx_rates where currency = $1", [c]))[0];

beforeAll(async () => {
  original = await adminQuery<Row>("select currency, rate_to_gbp::text, as_of_date::text, source, updated_by, updated_at from fx_rates");
  adminId = await profileIdByEmail("admin@reiwa.com");
});
afterAll(async () => {
  for (const r of original) {
    await adminQuery(`update fx_rates set rate_to_gbp=$2, as_of_date=$3, source=$4, updated_by=$5, updated_at=$6 where currency=$1`,
      [r.currency, r.rate_to_gbp, r.as_of_date, r.source, r.updated_by, r.updated_at]);
  }
});
// Every test starts from the seeded demonstration state.
beforeEach(async () => {
  for (const [c, rate] of [["GBP", 1], ["EUR", 0.85], ["USD", 0.79], ["JPY", 0.0052]] as const) {
    await adminQuery(`update fx_rates set rate_to_gbp=$2, as_of_date='2026-08-27', source='Demo static rates', updated_by=null, updated_at=null where currency=$1`, [c, rate]);
  }
});

describe("the first run", () => {
  it("replaces the seeded demonstration rates with the ECB's, dated by the feed and sourced as automatic", async () => {
    const out = await runFxSync({ fetchImpl: feedOf(xml("2026-10-02")), today: "2026-10-05" });
    expect(out).toMatchObject({ status: "ok", asOf: "2026-10-02", deferred: [] });
    expect(out.written.sort()).toEqual(["EUR", "GBP", "JPY", "USD"]);
    expect(await row("EUR")).toMatchObject({ rate_to_gbp: "0.871000", as_of_date: "2026-10-02", source: ECB_AUTO_SOURCE, updated_by: null });
    expect(await row("USD")).toMatchObject({ rate_to_gbp: "0.749570", as_of_date: "2026-10-02" });
    expect(await row("JPY")).toMatchObject({ rate_to_gbp: "0.005041", as_of_date: "2026-10-02" });
    expect(await row("GBP")).toMatchObject({ rate_to_gbp: "1.000000", source: ECB_AUTO_SOURCE });
  });

  it("the settings card reads them as automatic", async () => {
    await runFxSync({ fetchImpl: feedOf(xml("2026-10-02")), today: "2026-10-05" });
    const rates = await listFxRates({ ...adminSession, userId: adminId });
    expect(rates.map((r) => r.mode)).toEqual(["auto", "auto", "auto", "auto"]);
  });

  it("an unmaintained seeded row is reported as such before the first run", async () => {
    const rates = await listFxRates({ ...adminSession, userId: adminId });
    expect(new Set(rates.map((r) => r.mode))).toEqual(new Set(["unmaintained"]));
  });
});

describe("a weekend or a holiday", () => {
  it("the same file again changes nothing material and keeps the feed's date, not today's", async () => {
    await runFxSync({ fetchImpl: feedOf(xml("2026-10-02")), today: "2026-10-03" });
    await runFxSync({ fetchImpl: feedOf(xml("2026-10-02")), today: "2026-10-05" });
    expect((await row("EUR")).as_of_date).toBe("2026-10-02");
  });

  it("a newer file moves the rates on", async () => {
    await runFxSync({ fetchImpl: feedOf(xml("2026-10-02")), today: "2026-10-05" });
    await runFxSync({ fetchImpl: feedOf(xml("2026-10-05", "1.1500", "170.00", "0.8650")), today: "2026-10-05" });
    expect(await row("EUR")).toMatchObject({ rate_to_gbp: "0.865000", as_of_date: "2026-10-05" });
  });

  it("an OLDER file never rolls an automatic rate back", async () => {
    await runFxSync({ fetchImpl: feedOf(xml("2026-10-05", "1.1500", "170.00", "0.8650")), today: "2026-10-06" });
    const out = await runFxSync({ fetchImpl: feedOf(xml("2026-10-02")), today: "2026-10-06" });
    expect(out.written).toEqual([]);
    expect(out.deferred.map((d) => d.currency).sort()).toEqual(["EUR", "GBP", "JPY", "USD"]);
    expect((await row("EUR")).as_of_date).toBe("2026-10-05");
  });
});

describe("a manual override survives the next run", () => {
  async function manualEur() {
    await adminQuery(
      `update fx_rates set rate_to_gbp = 0.9, as_of_date = '2026-10-01', source = 'Forward rate, 12 months', updated_by = $1, updated_at = now() where currency = 'EUR'`, [adminId]);
  }

  it("is deferred to, logged, and left exactly as the administrator wrote it, while the other currencies update", async () => {
    await manualEur();
    const before = await row("EUR");
    const out = await runFxSync({ fetchImpl: feedOf(xml("2026-10-05")), today: "2026-10-06" });
    expect(out.status).toBe("ok");
    expect(out.deferred).toEqual([{ currency: "EUR", reason: "a manual override is in force" }]);
    expect(out.written.sort()).toEqual(["GBP", "JPY", "USD"]);
    expect(await row("EUR")).toEqual(before);
    expect((await row("USD")).source).toBe(ECB_AUTO_SOURCE);
  });

  it("survives day after day, even when the feed is newer than the override", async () => {
    await manualEur();
    for (const d of ["2026-10-05", "2026-10-06", "2026-10-07"]) await runFxSync({ fetchImpl: feedOf(xml(d)), today: d });
    expect(await row("EUR")).toMatchObject({ rate_to_gbp: "0.900000", source: "Forward rate, 12 months", updated_by: adminId });
  });

  it("holds even if the override's source happens to be the auto string: it is the person that counts", async () => {
    await adminQuery(`update fx_rates set rate_to_gbp = 0.9, source = $2, updated_by = $1, updated_at = now() where currency = 'EUR'`, [adminId, ECB_AUTO_SOURCE]);
    await runFxSync({ fetchImpl: feedOf(xml("2026-10-05")), today: "2026-10-06" });
    expect((await row("EUR")).rate_to_gbp).toBe("0.900000");
  });

  it("the settings card says it is manual, and by whom", async () => {
    await manualEur();
    const eur = (await listFxRates({ ...adminSession, userId: adminId })).find((r) => r.currency === "EUR")!;
    expect(eur.mode).toBe("manual");
    expect(eur.updatedByName).toBeTruthy();
  });

  it("an administrator can hand the currency back, and the next run then owns it again", async () => {
    await manualEur();
    const rows = await loadEcbRates({ fetchImpl: feedOf(xml("2026-10-05")), today: "2026-10-06" });
    const done = await applyEcbRates(db, rows, { only: ["EUR"], takeOverManual: true });
    expect(done.written).toEqual(["EUR"]);
    expect(await row("EUR")).toMatchObject({ source: ECB_AUTO_SOURCE, updated_by: null, rate_to_gbp: "0.871000" });
    const out = await runFxSync({ fetchImpl: feedOf(xml("2026-10-06", "1.1", "170", "0.86")), today: "2026-10-06" });
    expect(out.written).toContain("EUR");
  });

  it("without takeOverManual the same call still defers", async () => {
    await manualEur();
    const rows = await loadEcbRates({ fetchImpl: feedOf(xml("2026-10-05")), today: "2026-10-06" });
    const done = await applyEcbRates(db, rows, { only: ["EUR"] });
    expect(done.written).toEqual([]);
    expect((await row("EUR")).source).toBe("Forward rate, 12 months");
  });
});

describe("a failed day writes nothing, so the staleness flag can do its job", () => {
  async function snapshot() { return JSON.stringify(await adminQuery("select * from fx_rates order by currency")); }

  it.each([
    ["the ECB answers 503", feedOf("down", 503)],
    ["the network fails", (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch],
    ["the body is not the feed", feedOf("<html>maintenance</html>")],
    ["a rate is garbage", feedOf(xml("2026-10-02", "abc"))],
    ["JPY is missing", feedOf(`<Cube><Cube time='2026-10-02'><Cube currency='USD' rate='1.1'/><Cube currency='GBP' rate='0.87'/></Cube></Cube>`)],
    ["the feed is dated in the future", feedOf(xml("2026-12-31"))],
  ])("%s: status failed, table byte-for-byte unchanged", async (_name, fetchImpl) => {
    const before = await snapshot();
    const out = await runFxSync({ fetchImpl, today: "2026-10-05" });
    expect(out.status).toBe("failed");
    expect(out.written).toEqual([]);
    expect(out.error).toBeTruthy();
    expect(await snapshot()).toBe(before);
  });

  it("an error message names a reference, never a stack or a connection string", async () => {
    const out = await runFxSync({ fetchImpl: feedOf("down", 503), today: "2026-10-05" });
    expect(out.error).toMatch(/\(ref [0-9a-f]{8}\)/);
    expect(out.error).not.toMatch(/postgres|password|stack/i);
  });
});

describe("the sync is bound by the same gate as a person", () => {
  it("the database refuses a blank source whoever writes it, so a bug here could not slip one in", async () => {
    await expect(adminQuery("update fx_rates set source = ' ' where currency = 'EUR'")).rejects.toThrow(/fx_rates_source_named/);
  });
});
