// ============================================================================
// loadEcbRates: a failed day writes nothing. applyEcbRates against a fake db is
// in tests/fx-sync.test.ts (real Postgres), where the manual-override rule lives.
// ============================================================================
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { loadEcbRates } from "@/lib/data/fx-sync";
import { EcbFeedError, ECB_FEED_URL } from "@/lib/fx-ecb";

const XML = `<gesmes:Envelope><Cube><Cube time='2026-10-02'>
  <Cube currency='USD' rate='1.1620'/><Cube currency='JPY' rate='172.80'/><Cube currency='GBP' rate='0.8710'/>
</Cube></Cube></gesmes:Envelope>`;

const reply = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;

describe("loadEcbRates", () => {
  it("returns the four validated rows, GBP forced to 1, dated by the feed", async () => {
    const rows = await loadEcbRates({ fetchImpl: reply(XML), today: "2026-10-05" });
    expect(rows.map((r) => [r.currency, r.rate, r.asOf, r.source])).toEqual([
      ["GBP", 1, "2026-10-02", "ECB reference rate (auto)"],
      ["EUR", 0.871, "2026-10-02", "ECB reference rate (auto)"],
      ["USD", 0.74957, "2026-10-02", "ECB reference rate (auto)"],
      ["JPY", 0.005041, "2026-10-02", "ECB reference rate (auto)"],
    ]);
  });

  it("asks the ECB's daily file", async () => {
    let url = "";
    await loadEcbRates({ fetchImpl: (async (u: string) => { url = u; return new Response(XML); }) as unknown as typeof fetch, today: "2026-10-05" });
    expect(url).toBe(ECB_FEED_URL);
    expect(url).toMatch(/^https:\/\/www\.ecb\.europa\.eu\//);
  });

  it("throws, rather than return anything, on a non-200, a network error, or a malformed body", async () => {
    await expect(loadEcbRates({ fetchImpl: reply("down", 503), today: "2026-10-05" })).rejects.toThrow(/answered 503/);
    await expect(loadEcbRates({ fetchImpl: (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch, today: "2026-10-05" })).rejects.toThrow(/could not be fetched/);
    await expect(loadEcbRates({ fetchImpl: reply("<html>nope</html>"), today: "2026-10-05" })).rejects.toBeInstanceOf(EcbFeedError);
    await expect(loadEcbRates({ fetchImpl: reply(XML.replace("0.8710", "-1")), today: "2026-10-05" })).rejects.toBeInstanceOf(EcbFeedError);
  });

  it("refuses a feed dated in the future, which the validator will not accept for a rate", async () => {
    await expect(loadEcbRates({ fetchImpl: reply(XML), today: "2026-10-01" })).rejects.toThrow(/future/);
  });
});

describe("the cron is wired", () => {
  it("vercel.json schedules the route once a day, and that route exists", () => {
    const cfg = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(cfg.crons).toHaveLength(1);
    const [c] = cfg.crons;
    expect(c.path).toBe("/api/cron/fx-sync");
    expect(c.schedule.split(" ")).toHaveLength(5);
    expect(c.schedule).toMatch(/^\d+ \d+ \* \* \*$/);          // once a day
    expect(existsSync(`src/app${c.path}/route.ts`)).toBe(true);
  });

  it("the route checks the cron secret before it does anything else", () => {
    const src = readFileSync("src/app/api/cron/fx-sync/route.ts", "utf8");
    expect(src.indexOf("authorizeCron")).toBeGreaterThan(-1);
    expect(src.indexOf("authorizeCron(")).toBeLessThan(src.indexOf("runFxSync()"));
  });
});
