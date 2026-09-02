import { describe, it, expect } from "vitest";
import { withSessionOn } from "@/lib/db/client";
import { freshDb, orgIdByName, sessionFor } from "./helpers";

describe("Organisation isolation (database RLS via auth.uid())", () => {
  it("Meiji user cannot retrieve Aoyama org's assets", async () => {
    const db = await freshDb();
    const meiji = await orgIdByName(db, "Meiji Shipping");
    const aoyama = await orgIdByName(db, "Aoyama Holdings");
    const meijiSession = await sessionFor(db, "analyst@meiji.com");

    const aoyamaAssetId = (await db.query<{ asset_id: string }>(
      "select asset_id from assets where org_id = $1 limit 1", [aoyama],
    )).rows[0].asset_id;

    const meijiSees = await withSessionOn(db, meijiSession, (tx) =>
      tx.query<{ asset_id: string; org_id: string }>("select asset_id, org_id from assets"));
    expect(meijiSees.rows.length).toBeGreaterThan(0);
    expect(meijiSees.rows.every((r) => r.org_id === meiji)).toBe(true);

    // Even targeting the Aoyama asset by its exact id returns nothing.
    const leak = await withSessionOn(db, meijiSession, (tx) =>
      tx.query("select asset_id from assets where asset_id = $1", [aoyamaAssetId]));
    expect(leak.rows.length).toBe(0);

    const oppLeak = await withSessionOn(db, meijiSession, (tx) =>
      tx.query("select opportunity_id from opportunities where org_id = $1", [aoyama]));
    expect(oppLeak.rows.length).toBe(0);

    await db.close();
  });

  it("Reiwa admin sees every organisation's assets", async () => {
    const db = await freshDb();
    const admin = await sessionFor(db, "admin@reiwa.com");
    const all = await withSessionOn(db, admin, (tx) =>
      tx.query<{ org_id: string }>("select distinct org_id from assets"));
    expect(all.rows.length).toBeGreaterThanOrEqual(2);
    await db.close();
  });

  it("Aoyama user cannot see Meiji opportunities", async () => {
    const db = await freshDb();
    const meiji = await orgIdByName(db, "Meiji Shipping");
    const aoyama = await orgIdByName(db, "Aoyama Holdings");
    const aoyamaSession = await sessionFor(db, "user@aoyama.com");
    const seen = await withSessionOn(db, aoyamaSession, (tx) =>
      tx.query<{ org_id: string }>("select org_id from opportunities"));
    expect(seen.rows.every((r) => r.org_id === aoyama)).toBe(true);
    expect(seen.rows.some((r) => r.org_id === meiji)).toBe(false);
    await db.close();
  });

  it("a session with a fabricated user id sees nothing", async () => {
    const db = await freshDb();
    const ghost = { kind: "internal" as const, userId: "99999999-9999-4999-8999-999999999999", role: "org_user" as const, canWrite: true };
    const rows = await withSessionOn(db, ghost, (tx) => tx.query("select org_id from opportunities"));
    expect(rows.rows.length).toBe(0);
    await db.close();
  });
});
