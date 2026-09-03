import { describe, it, expect, beforeAll } from "vitest";
import { adminQuery, withSession } from "@/lib/db/client";
import { orgIdByName, orgUserSession, adminSession } from "./helpers";

let meiji: string;
let aoyama: string;

beforeAll(async () => {
  meiji = await orgIdByName("Meiji Shipping");
  aoyama = await orgIdByName("Aoyama Holdings");
});

describe("Organisation isolation (database RLS)", () => {
  it("Meiji user cannot retrieve Aoyama org's assets", async () => {
    // The Aoyama asset id, fetched on the privileged connection (bypasses RLS)
    // so the isolation test can target it directly.
    const aoyamaAssetId = (await adminQuery<{ asset_id: string }>(
      "select asset_id from assets where org_id = $1 limit 1", [aoyama],
    ))[0].asset_id;

    // Meiji user lists assets → only Meiji rows, never Aoyama.
    const meijiSees = await withSession(orgUserSession([meiji]), (tx) =>
      tx.query<{ asset_id: string; org_id: string }>("select asset_id, org_id from assets"));
    expect(meijiSees.rows.length).toBeGreaterThan(0);
    expect(meijiSees.rows.every((r) => r.org_id === meiji)).toBe(true);

    // Even targeting the Aoyama asset by its exact id returns nothing.
    const leak = await withSession(orgUserSession([meiji]), (tx) =>
      tx.query("select asset_id from assets where asset_id = $1", [aoyamaAssetId]));
    expect(leak.rows.length).toBe(0);

    // And the same for opportunities.
    const oppLeak = await withSession(orgUserSession([meiji]), (tx) =>
      tx.query("select opportunity_id from opportunities where org_id = $1", [aoyama]));
    expect(oppLeak.rows.length).toBe(0);
  });

  it("Reiwa admin sees every organisation's assets", async () => {
    const all = await withSession(adminSession, (tx) =>
      tx.query<{ org_id: string }>("select distinct org_id from assets"));
    expect(all.rows.length).toBeGreaterThanOrEqual(2);
  });

  it("Aoyama user cannot see Meiji opportunities", async () => {
    const seen = await withSession(orgUserSession([aoyama]), (tx) =>
      tx.query<{ org_id: string }>("select org_id from opportunities"));
    expect(seen.rows.every((r) => r.org_id === aoyama)).toBe(true);
    expect(seen.rows.some((r) => r.org_id === meiji)).toBe(false);
  });

  it("the session role and claims do not survive the transaction", async () => {
    await withSession(orgUserSession([meiji]), (tx) =>
      tx.query("select 1 as ok"));
    // The next borrower of a pooled connection is back to the privileged role
    // with no request claims installed.
    const after = await adminQuery<{ role: string; claims: string | null }>(
      "select current_user as role, nullif(current_setting('request.jwt.claims', true), '') as claims");
    expect(after[0].role).not.toBe("authenticated");
    expect(after[0].claims).toBeNull();
  });
});
