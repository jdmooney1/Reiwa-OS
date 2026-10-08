// ============================================================================
// Investor mandates (0050), against real Postgres.
// ----------------------------------------------------------------------------
// The table is staff-only: ONE policy, Reiwa admin, and no investor policy at all. Proved here for
// an investor, a staff user and an organisation user (none can read or write), for anon/PUBLIC
// (no privilege), and by listing the policies. Also: the table's own CHECKs, the upsert, the
// cascade from the organisation, and that the matching read-models give what the pure matcher
// gives over the same facts. Fixtures: ZZTEST organisations and deals created here, removed after.
// ============================================================================
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { adminQuery, withInvestorSession, withSession } from "@/lib/db/client";
import { createInvestorOrganization } from "@/lib/data/investor-portal";
import {
  getInvestorMandate, saveInvestorMandate, clearInvestorMandate, listActiveMandates,
  matchingDealsForInvestor, matchingInvestorsForOpportunity,
} from "@/lib/data/investor-mandates";
import { seedDeal, type SeedContext } from "@/lib/data/deal-seed";
import { parseDealSeed, type SeedDeal } from "@/lib/ingestion/deal-seed";
import { EMPTY_MANDATE, type Mandate } from "@/lib/mandate/mandate";
import { adminSession, orgUserSession, createStaffSession, investorAuthUserId, orgIdByName } from "./helpers";

const created: string[] = [];
let n = 0;
async function org(label: string, status = "active"): Promise<string> {
  const id = await createInvestorOrganization(adminSession, { name: `ZZTEST Mandate ${label} ${++n}`, status: status as "active" });
  created.push(id);
  return id;
}
const M = (over: Partial<Mandate>): Mandate => ({ ...EMPTY_MANDATE, ...over });

// ---- deal fixtures ---------------------------------------------------------
let ctx: SeedContext;
const dealIds: string[] = [];
const RUN = String(Date.now()).slice(-6);
const letters = (k: number) => [...`${RUN}${String(k).padStart(2, "0")}`].map((c) => "abcdefghij"[Number(c)]).join("");
const parse = (d: unknown): SeedDeal => parseDealSeed({ note: "fixture", deals: [d] })[0];
async function deal(opts: { market: string; assetType: string; price: number; niy: number; live: boolean; totalCost?: number; noPrice?: boolean }): Promise<string> {
  const tag = `ZZTEST${letters(++n)}`;
  const d = parse({
    opportunity: { name: `${tag} Hall`, address: `${tag} Hall, 1 ${tag} Street`, market: opts.market, asset_type: opts.assetType, off_market: false, deal_stage: "guided", sourcing: "Broker email, Example Partners (Pat Example)" },
    asset_snapshot: { size_sq_ft: 1000 }, deal_terms: { guide_price_gbp: opts.price, niy_percent: opts.niy, currency: "GBP" }, data_completeness: "full",
  });
  const r = await withSession(adminSession, (tx) => seedDeal(tx, ctx, d));
  const id = r.opportunityId!;
  dealIds.push(id);
  if (opts.live) await adminQuery("update opportunities set triage_status = 'live' where opportunity_id = $1", [id]);
  // total_cost is generated (price + costs + capex): set the costs so the total comes out as asked.
  if (opts.totalCost) await adminQuery("update investment_cases set acquisition_costs = $2 where opportunity_id = $1", [id, opts.totalCost - opts.price]);
  // A deal with no price has no total cost yet.
  if (opts.noPrice) await adminQuery("update investment_cases set acquisition_price = null where opportunity_id = $1", [id]);
  return id;
}

beforeAll(async () => {
  ctx = { orgId: await orgIdByName("Meiji Shipping"), userId: adminSession.userId, allowExisting: false };
});
afterAll(async () => {
  await adminQuery("delete from investor_organizations where investor_org_id = any($1::uuid[])", [created]);
  if (dealIds.length) await adminQuery("delete from opportunities where opportunity_id = any($1::uuid[])", [dealIds]);
});

describe("storing a mandate", () => {
  it("round-trips, replaces on a second save, and records who saved it", async () => {
    const id = await org("store");
    expect((await getInvestorMandate(adminSession, id)).stored).toBeNull();

    await saveInvestorMandate(adminSession, id, M({
      markets: ["London"], assetTypes: ["office", "mixed_use"], strategies: ["core_plus"],
      dealSizeMin: 10_000_000, dealSizeMax: 40_000_000, minEntryYieldPct: 6.25,
    }), adminSession.userId);
    const first = (await getInvestorMandate(adminSession, id)).stored!;
    expect(first.mandate).toEqual({
      markets: ["London"], assetTypes: ["office", "mixed_use"], strategies: ["core_plus"],
      dealSizeMin: 10_000_000, dealSizeMax: 40_000_000, currency: "GBP", minEntryYieldPct: 6.25,
    });
    const row = (await adminQuery<{ updated_by: string }>("select updated_by from investor_mandates where investor_org_id = $1", [id]))[0];
    expect(row.updated_by).toBe(adminSession.userId);

    await saveInvestorMandate(adminSession, id, M({ markets: ["Amsterdam"] }), adminSession.userId);
    expect((await getInvestorMandate(adminSession, id)).stored!.mandate).toEqual(M({ markets: ["Amsterdam"] }));
    expect(await adminQuery("select 1 from investor_mandates where investor_org_id = $1", [id])).toHaveLength(1);
  });

  it("clears", async () => {
    const id = await org("clear");
    await saveInvestorMandate(adminSession, id, M({ markets: ["London"] }), null);
    await clearInvestorMandate(adminSession, id);
    expect((await getInvestorMandate(adminSession, id)).stored).toBeNull();
  });

  it("goes with the organisation when it is deleted", async () => {
    const id = await org("cascade");
    await saveInvestorMandate(adminSession, id, M({ markets: ["London"] }), null);
    await adminQuery("delete from investor_organizations where investor_org_id = $1", [id]);
    expect(await adminQuery("select 1 from investor_mandates where investor_org_id = $1", [id])).toHaveLength(0);
  });

  it.each([
    ["a minimum above the maximum", { deal_size_min: 50, deal_size_max: 10 }],
    ["a negative size", { deal_size_min: -1 }],
    ["a yield above 100", { min_entry_yield_pct: 100.5 }],
    ["an unknown currency", { currency: "XXX" }],
    ["more than 12 markets", { markets: Array.from({ length: 13 }, (_, i) => `M${i}`) }],
  ])("the table itself refuses %s", async (_label, cols) => {
    const id = await org("check");
    const keys = Object.keys(cols);
    await expect(adminQuery(
      `insert into investor_mandates(investor_org_id, ${keys.join(", ")}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")})`,
      [id, ...Object.values(cols)])).rejects.toMatchObject({ code: "23514" });
  });
});

describe("only a Reiwa admin can reach it", () => {
  let id: string;
  beforeAll(async () => {
    id = await org("rls");
    await saveInvestorMandate(adminSession, id, M({ markets: ["London"] }), null);
  });

  it("an investor reads no row from it, whichever columns they ask for, and cannot write", async () => {
    const uid = await investorAuthUserId("principal@kitano-fo.example");
    for (const sql of ["select * from investor_mandates", "select markets from investor_mandates", "select count(*)::int as c from investor_mandates"]) {
      const { rows } = await withInvestorSession(uid, (tx) => tx.query<Record<string, unknown>>(sql));
      expect(rows.length === 0 || rows[0].c === 0, sql).toBe(true);
    }
    await expect(withInvestorSession(uid, (tx) =>
      tx.query("insert into investor_mandates(investor_org_id, markets) values ($1, '{London}')", [id]))).rejects.toThrow();
    await expect(withInvestorSession(uid, (tx) =>
      tx.query("update investor_mandates set markets = '{Paris}'"))).resolves.toBeTruthy(); // matches no row it can see
    expect((await getInvestorMandate(adminSession, id)).stored!.mandate.markets).toEqual(["London"]);
  });

  it("a Reiwa staff user (not admin) reads nothing and writes nothing", async () => {
    const staff = await createStaffSession("zztest.mandate.staff@example.invalid", "ZZTEST Staff", [await orgIdByName("Meiji Shipping")]);
    expect((await withSession(staff, (tx) => tx.query("select * from investor_mandates"))).rows).toEqual([]);
    const other = await org("staffwrite");
    await expect(withSession(staff, (tx) =>
      tx.query("insert into investor_mandates(investor_org_id, markets) values ($1, '{Paris}')", [other]))).rejects.toThrow();
    // ...and through the application's own read, which is how the screens would reach it.
    expect((await getInvestorMandate(staff, id)).stored).toBeNull();
  });

  it("an organisation user reads nothing", async () => {
    const analyst = orgUserSession([await orgIdByName("Meiji Shipping")]);
    expect((await withSession(analyst, (tx) => tx.query("select * from investor_mandates"))).rows).toEqual([]);
  });

  it("anon and PUBLIC hold no privilege on it", async () => {
    const g = await adminQuery<{ grantee: string }>(
      "select grantee from information_schema.role_table_grants where table_name = 'investor_mandates' and grantee in ('anon','PUBLIC')");
    expect(g).toEqual([]);
  });

  it("its only policy is the admin one", async () => {
    const pol = await adminQuery<{ policyname: string; qual: string | null }>(
      "select policyname, qual from pg_policies where tablename = 'investor_mandates' order by 1");
    expect(pol.map((p) => p.policyname)).toEqual(["investor_mandates_admin"]);
    expect(pol[0].qual).toContain("is_admin");
  });

  it("nothing the investor side reads is a view over it", async () => {
    const v = await adminQuery("select 1 from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class v on v.oid = r.ev_class where d.refobjid = 'public.investor_mandates'::regclass and v.relkind = 'v'");
    expect(v).toHaveLength(0);
  });
});

describe("matching, end to end", () => {
  it("lists the live deals that suit one investor, best first, and leaves out the rest", async () => {
    const fit = await deal({ market: "London", assetType: "Office", price: 20_000_000, niy: 6.5, live: true, totalCost: 21_000_000 });
    const lowYield = await deal({ market: "London", assetType: "Office", price: 20_000_000, niy: 4, live: true, totalCost: 21_000_000 });
    const wrongMarket = await deal({ market: "Paris", assetType: "Office", price: 20_000_000, niy: 6.5, live: true, totalCost: 21_000_000 });
    const notLive = await deal({ market: "London", assetType: "Office", price: 20_000_000, niy: 6.5, live: false, totalCost: 21_000_000 });
    const noSize = await deal({ market: "London", assetType: "Office", price: 20_000_000, niy: 6.5, live: true, noPrice: true });

    const id = await org("deals");
    await saveInvestorMandate(adminSession, id, M({
      markets: ["London"], assetTypes: ["office"], dealSizeMin: 15_000_000, dealSizeMax: 30_000_000, minEntryYieldPct: 6,
    }), null);
    const r = await matchingDealsForInvestor(adminSession, id);
    expect(r).toMatchObject({ available: true, hasMandate: true });
    const byId = new Map(r.deals.map((d) => [d.opportunityId, d]));
    expect(byId.get(fit)?.verdict).toBe("fit");
    expect(byId.get(noSize)?.verdict).toBe("possible"); // nothing contradicts it; total cost is missing
    expect(byId.get(noSize)!.checks.find((c) => c.criterion === "dealSize")?.outcome).toBe("unknown");
    for (const out of [lowYield, wrongMarket, notLive]) expect(byId.has(out), out).toBe(false);
    // fit before possible
    const order = r.deals.map((d) => d.opportunityId);
    expect(order.indexOf(fit)).toBeLessThan(order.indexOf(noSize));
  });

  it("says there is no mandate rather than listing every deal", async () => {
    const id = await org("nomandate");
    expect(await matchingDealsForInvestor(adminSession, id)).toEqual({ available: true, hasMandate: false, deals: [] });
  });

  it("lists the active investors whose mandate suits one deal, and only active ones", async () => {
    const d = await deal({ market: "Amsterdam", assetType: "Office", price: 12_000_000, niy: 7, live: true, totalCost: 13_000_000 });
    const good = await org("good");
    const suspended = await org("suspended", "suspended");
    const wrong = await org("wrong");
    const blank = await org("blank");
    await saveInvestorMandate(adminSession, good, M({ markets: ["Amsterdam"], minEntryYieldPct: 6 }), null);
    await saveInvestorMandate(adminSession, suspended, M({ markets: ["Amsterdam"] }), null);
    await saveInvestorMandate(adminSession, wrong, M({ markets: ["Dublin"] }), null);
    await saveInvestorMandate(adminSession, blank, EMPTY_MANDATE, null);

    const r = await matchingInvestorsForOpportunity(adminSession, d);
    const ids = r.investors.map((i) => i.investorOrgId);
    expect(ids).toContain(good);
    for (const out of [suspended, wrong, blank]) expect(ids, out).not.toContain(out);
    expect(r.investors.find((i) => i.investorOrgId === good)!.verdict).toBe("fit");
    expect((await listActiveMandates(adminSession)).investors.map((i) => i.investorOrgId)).not.toContain(blank);
  });

  it("a non-admin gets nothing from the matching either", async () => {
    const staff = await createStaffSession("zztest.mandate.staff@example.invalid", "ZZTEST Staff", [await orgIdByName("Meiji Shipping")]);
    expect((await listActiveMandates(staff)).investors).toEqual([]);
  });
});
