// ============================================================================
// FX rates (migration 0025) against real Postgres.
// ----------------------------------------------------------------------------
// Readable by every signed-in member of staff, writable by a Reiwa administrator
// and by nobody else, and never without a source. Seeded data as elsewhere.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminQuery, withSession, withInvestorSession, type Session } from "@/lib/db/client";
import { listFxRates, saveFxRate } from "@/lib/data/fx-rates";
import { loadMemoSource } from "@/lib/data/memos";
import { composeMemo } from "@/lib/memo/compose";
import { adminSession, investorAuthUserId, orgIdByName, orgUserSession, profileIdByEmail, viewerSession } from "./helpers";

interface Row { currency: string; rate_to_gbp: string; as_of_date: string; source: string }
let original: Row[];
let admin: Session;
let writer: Session;
let viewer: Session;

const row = async (c: string) =>
  (await adminQuery<Row>("select currency, rate_to_gbp::text, as_of_date::text, source from fx_rates where currency = $1", [c]))[0];

beforeAll(async () => {
  original = await adminQuery<Row>("select currency, rate_to_gbp::text, as_of_date::text, source from fx_rates");
  const meiji = await orgIdByName("Meiji Shipping");
  admin = { ...adminSession, userId: await profileIdByEmail("admin@reiwa.com") };
  writer = orgUserSession([meiji], await profileIdByEmail("analyst@meiji.com"));
  viewer = viewerSession([meiji], await profileIdByEmail("viewer@meiji.com"));
});

afterAll(async () => {
  await adminQuery("delete from fx_rates where currency <> all($1)", [original.map((r) => r.currency)]);
  for (const r of original) {
    await adminQuery("update fx_rates set rate_to_gbp = $2, as_of_date = $3, source = $4, updated_by = null, updated_at = null where currency = $1",
      [r.currency, r.rate_to_gbp, r.as_of_date, r.source]);
  }
});

describe("reading", () => {
  it("any member of staff can read the four rates; an investor reads none", async () => {
    for (const s of [admin, writer, viewer]) {
      expect((await listFxRates(s)).map((r) => r.currency)).toEqual(["GBP", "EUR", "USD", "JPY"]);
    }
    const uid = await investorAuthUserId("principal@kitano-fo.example");
    const n = await withInvestorSession(uid, (tx) => tx.query("select count(*)::int as n from fx_rates"));
    expect((n.rows[0] as { n: number }).n).toBe(0);
  });
});

describe("an administrator updating a rate", () => {
  it("changes the rate, source and date, and records who and when", async () => {
    await saveFxRate(admin, { currency: "EUR", rate: 0.8731, source: "ECB euro reference rate", asOf: "2026-10-02" });
    expect(await row("EUR")).toEqual({ currency: "EUR", rate_to_gbp: "0.873100", as_of_date: "2026-10-02", source: "ECB euro reference rate" });
    const eur = (await listFxRates(admin)).find((r) => r.currency === "EUR")!;
    expect(eur).toMatchObject({ rateToGbp: 0.8731, asOf: "2026-10-02", source: "ECB euro reference rate" });
    expect(eur.updatedByName).toBeTruthy();
    expect(eur.updatedAt).toBeTruthy();
  });

  it("can put back a currency whose row is missing (upsert), but there is no delete grant", async () => {
    await adminQuery("delete from fx_rates where currency = 'USD'");
    await saveFxRate(admin, { currency: "USD", rate: 0.76, source: "Bloomberg close", asOf: "2026-10-02" });
    expect((await row("USD")).source).toBe("Bloomberg close");
    await expect(withSession(admin, (tx) => tx.query("delete from fx_rates where currency = 'USD'"))).rejects.toThrow(/permission denied/);
    expect((await row("USD")).source).toBe("Bloomberg close");
  });
});

describe("nobody else can write a rate", () => {
  it("staff who can write, and read-only staff, change nothing: the update matches no row", async () => {
    const before = await row("JPY");
    for (const s of [writer, viewer]) {
      const r = await withSession(s, (tx) => tx.query("update fx_rates set rate_to_gbp = 9, source = 'Somebody' where currency = 'JPY' returning currency"));
      expect(r.rows).toHaveLength(0);
    }
    expect(await row("JPY")).toEqual(before);
  });

  it("insert is refused by policy for them, and the data-layer call fails rather than succeeding quietly", async () => {
    await adminQuery("delete from fx_rates where currency = 'JPY'");
    for (const s of [writer, viewer]) {
      await expect(saveFxRate(s, { currency: "JPY", rate: 0.0052, source: "Anyone", asOf: "2026-10-02" })).rejects.toBeTruthy();
    }
    expect(await adminQuery("select 1 from fx_rates where currency = 'JPY'")).toHaveLength(0);
    await adminQuery("insert into fx_rates (currency, rate_to_gbp, as_of_date, source) values ($1,$2,$3,$4)",
      [original.find((r) => r.currency === "JPY")!.currency, original.find((r) => r.currency === "JPY")!.rate_to_gbp,
       original.find((r) => r.currency === "JPY")!.as_of_date, original.find((r) => r.currency === "JPY")!.source]);
  });

  it("an investor session cannot write one either", async () => {
    const uid = await investorAuthUserId("principal@kitano-fo.example");
    await expect(withInvestorSession(uid, (tx) =>
      tx.query("insert into fx_rates (currency, rate_to_gbp, as_of_date, source) values ('CHF', 1, '2026-10-02', 'x')"))).rejects.toBeTruthy();
  });
});

describe("the database holds the line on a source and a sane rate", () => {
  it("refuses a blank source even from an administrator", async () => {
    await expect(withSession(admin, (tx) => tx.query("update fx_rates set source = '   ' where currency = 'EUR'"))).rejects.toThrow(/fx_rates_source_named/);
    await expect(withSession(admin, (tx) => tx.query("update fx_rates set source = '' where currency = 'EUR'"))).rejects.toThrow(/fx_rates_source_named/);
  });

  it("refuses a zero or negative rate", async () => {
    await expect(withSession(admin, (tx) => tx.query("update fx_rates set rate_to_gbp = 0 where currency = 'EUR'"))).rejects.toThrow(/fx_rates_rate_positive/);
    await expect(withSession(admin, (tx) => tx.query("update fx_rates set rate_to_gbp = -1 where currency = 'EUR'"))).rejects.toThrow(/fx_rates_rate_positive/);
  });

  it("has exactly one select, insert and update policy, and no delete policy or anon access", async () => {
    const p = await adminQuery<{ cmd: string }>("select cmd from pg_policies where tablename = 'fx_rates' order by cmd");
    expect(p.map((x) => x.cmd)).toEqual(["INSERT", "SELECT", "UPDATE"]);
    const g = await adminQuery<{ g: string; p: string }>(
      "select grantee g, privilege_type p from information_schema.role_table_grants where table_name = 'fx_rates' and grantee in ('anon','PUBLIC','authenticated') order by 1, 2");
    expect(g).toEqual([{ g: "authenticated", p: "INSERT" }, { g: "authenticated", p: "SELECT" }, { g: "authenticated", p: "UPDATE" }]);
  });
});

describe("a memo composes against the maintained rate", () => {
  it("a rate dated more than 30 days before the memo says so; a fresh one does not", async () => {
    const opp = (await adminQuery<{ opportunity_id: string; currency: string }>(
      "select opportunity_id, currency from opportunities where name = 'Magna Plaza'"))[0];
    const stale = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
    await adminQuery("update fx_rates set as_of_date = $2, source = 'Test source' where currency = $1", [opp.currency, stale]);
    const old = composeMemo((await loadMemoSource(writer, opp.opportunity_id))!).sections.fx_sensitivity;
    expect(old.flags.join(" ")).toMatch(/This rate is 45 days old/);

    const fresh = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    await adminQuery("update fx_rates set as_of_date = $2 where currency = $1", [opp.currency, fresh]);
    const ok = composeMemo((await loadMemoSource(writer, opp.opportunity_id))!).sections.fx_sensitivity;
    expect(ok.flags.join(" ")).not.toMatch(/days old/);
  });
});
