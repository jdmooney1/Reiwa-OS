// ============================================================================
// Taking a deal off the pipeline, and restoring it, against real Postgres.
// ----------------------------------------------------------------------------
// Removal archives: status becomes an outcome, archived_at is stamped, why is kept on the deal and on
// the property's timeline, and nothing is deleted. Sold and Withdrawn both mean "not available", so both
// are stored as Withdrawn and only the timeline event tells them apart. Only an active deal can be removed;
// only a removed one restored; and the database's row policy decides who may.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { adminQuery, withSession } from "@/lib/db/client";
import { seedDeal, type SeedContext } from "@/lib/data/deal-seed";
import { parseDealSeed, type SeedDeal } from "@/lib/ingestion/deal-seed";
import { removeFromPipeline, restoreToPipeline } from "@/lib/data/removal";
import { adminSession, orgUserSession, viewerSession, orgIdByName, seededUserId } from "./helpers";

let orgId: string;
let ctx: SeedContext;
let n = 0;
const RUN = String(Date.now()).slice(-6);
const letters = (k: number) => [...`${RUN}${String(k).padStart(2, "0")}`].map((c) => "abcdefghij"[Number(c)]).join("");
const parse = (d: unknown): SeedDeal => parseDealSeed({ note: "fixture", deals: [d] })[0];

async function newDeal(): Promise<{ id: string; propertyId: string }> {
  const tag = `ZZTEST${letters(++n)}`;
  const deal = parse({
    opportunity: { name: `${tag} Hall`, address: `${tag} Hall, 1 ${tag} Street`, market: "London", asset_type: "Mixed Use", off_market: false, deal_stage: "guided", sourcing: "Broker email, Example Partners (Pat Example)" },
    asset_snapshot: { size_sq_ft: 1000 }, deal_terms: { guide_price_gbp: 5_000_000, niy_percent: 6, currency: "GBP" }, data_completeness: "full",
  });
  const r = await withSession(adminSession, (tx) => seedDeal(tx, ctx, deal));
  return { id: r.opportunityId!, propertyId: r.propertyId! };
}
const opp = async (id: string) => (await adminQuery<Record<string, any>>("select * from opportunities where opportunity_id = $1", [id]))[0];
const events = (propertyId: string, type: string) =>
  adminQuery<Record<string, any>>("select * from property_events where property_id = $1 and event_type = $2 order by recorded_at", [propertyId, type]);

beforeAll(async () => {
  orgId = await orgIdByName("Meiji Shipping");
  ctx = { orgId, userId: adminSession.userId, allowExisting: false };
});

describe("removing a deal", () => {
  it("Sold is stored as Withdrawn, archived, with a 'sold' event carrying the note", async () => {
    const d = await newDeal();
    expect(await removeFromPipeline(adminSession, d.id, "sold", "Went to a local buyer")).toEqual({ status: "withdrawn" });
    const o = await opp(d.id);
    expect(o).toMatchObject({ status: "withdrawn" });
    expect(o.archived_at).not.toBeNull();
    expect(o.source_facts._removal).toMatchObject({ reason: "sold", note: "Went to a local buyer", by: adminSession.userId });
    const ev = await events(d.propertyId, "sold");
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ opportunity_id: d.id, detail: "Went to a local buyer", created_by: adminSession.userId });
  });

  it("Withdrawn is the same status with a 'withdrawn' event: only the timeline tells the two apart", async () => {
    const d = await newDeal();
    await removeFromPipeline(adminSession, d.id, "withdrawn", "");
    expect((await opp(d.id)).status).toBe("withdrawn");
    expect(await events(d.propertyId, "withdrawn")).toHaveLength(1);
    expect(await events(d.propertyId, "sold")).toHaveLength(0);
  });

  it("Lost is Lost with no timeline event; Passed is Rejected with a 'reiwa_passed' event", async () => {
    const a = await newDeal();
    await removeFromPipeline(adminSession, a.id, "lost", "Outbid");
    expect((await opp(a.id)).status).toBe("lost");
    const evs = await adminQuery("select 1 from property_events where opportunity_id = $1 and event_type in ('sold','withdrawn','reiwa_passed')", [a.id]);
    expect(evs).toHaveLength(0);
    const b = await newDeal();
    await removeFromPipeline(adminSession, b.id, "passed", "Too thin");
    expect((await opp(b.id)).status).toBe("rejected");
    expect(await events(b.propertyId, "reiwa_passed")).toHaveLength(1);
  });

  it("deletes nothing: the deal, its case and its property are all still there", async () => {
    const d = await newDeal();
    const before = (await adminQuery<{ c: string }>("select (select count(*) from opportunities)::text || '/' || (select count(*) from investment_cases)::text || '/' || (select count(*) from properties)::text c"))[0].c;
    await removeFromPipeline(adminSession, d.id, "sold", "");
    const after = (await adminQuery<{ c: string }>("select (select count(*) from opportunities)::text || '/' || (select count(*) from investment_cases)::text || '/' || (select count(*) from properties)::text c"))[0].c;
    expect(after).toBe(before);
  });

  it("changes nothing about the deal except its status, when it left and why", async () => {
    const d = await newDeal();
    const before = await opp(d.id);
    await removeFromPipeline(adminSession, d.id, "lost", "x");
    const after = await opp(d.id);
    for (const k of ["name", "stage", "triage_status", "owner_user_id", "reference", "property_id", "broker_name", "market"]) expect(after[k], k).toEqual(before[k]);
  });

  it("refuses an unknown reason, and any attempt to write a status of your own choosing", async () => {
    const d = await newDeal();
    for (const bad of ["", "converted", "active", "merged", "deleted", "SOLD", null, 5]) {
      await expect(removeFromPipeline(adminSession, d.id, bad, ""), String(bad)).rejects.toThrow(/Choose why/);
    }
    expect((await opp(d.id)).status).toBe("active");
  });

  it("a deal with no property is still removed, and the reason is still kept on the deal", async () => {
    const d = await newDeal();
    await adminQuery("update opportunities set property_id = null where opportunity_id = $1", [d.id]);
    await removeFromPipeline(adminSession, d.id, "sold", "no property here");
    expect(await opp(d.id)).toMatchObject({ status: "withdrawn" });
    expect((await opp(d.id)).source_facts._removal.note).toBe("no property here");
  });

  it("only an active deal can be removed: not one already off the pipeline, not a converted one", async () => {
    const d = await newDeal();
    await removeFromPipeline(adminSession, d.id, "lost", "");
    await expect(removeFromPipeline(adminSession, d.id, "sold", "")).rejects.toThrow(/already off the pipeline/);
    const c = await newDeal();
    await adminQuery("update opportunities set status = 'converted' where opportunity_id = $1", [c.id]);
    await expect(removeFromPipeline(adminSession, c.id, "sold", "")).rejects.toThrow(/converted to an asset/);
    expect((await opp(c.id)).status).toBe("converted");
    await expect(removeFromPipeline(adminSession, "00000000-0000-4000-8000-000000000000", "sold", "")).rejects.toThrow(/could not be found/);
  });
});

describe("restoring a deal", () => {
  it("puts it back on the pipeline, clears the archive stamp and the removal record, and notes it on the timeline", async () => {
    const d = await newDeal();
    await removeFromPipeline(adminSession, d.id, "sold", "gone");
    await restoreToPipeline(adminSession, d.id);
    const o = await opp(d.id);
    expect(o).toMatchObject({ status: "active", archived_at: null });
    expect(o.source_facts._removal).toBeUndefined();
    expect(await events(d.propertyId, "relaunched")).toHaveLength(1);
    expect(await events(d.propertyId, "sold")).toHaveLength(1);              // history is not rewritten
  });

  it("refuses an active deal, a converted one, and a missing one", async () => {
    const d = await newDeal();
    await expect(restoreToPipeline(adminSession, d.id)).rejects.toThrow(/Only a deal that was taken off/);
    await adminQuery("update opportunities set status = 'converted' where opportunity_id = $1", [d.id]);
    await expect(restoreToPipeline(adminSession, d.id)).rejects.toThrow(/Only a deal that was taken off/);
    await expect(restoreToPipeline(adminSession, "00000000-0000-4000-8000-000000000000")).rejects.toThrow(/could not be found/);
  });

  it("a removed deal can be removed again after a restore, for a different reason", async () => {
    const d = await newDeal();
    await removeFromPipeline(adminSession, d.id, "withdrawn", "");
    await restoreToPipeline(adminSession, d.id);
    await removeFromPipeline(adminSession, d.id, "lost", "now lost");
    expect(await opp(d.id)).toMatchObject({ status: "lost" });
  });
});

describe("who may remove a deal is the database's decision", () => {
  it("a member of the deal's organisation with write scope can", async () => {
    const d = await newDeal();
    await removeFromPipeline(orgUserSession([orgId]), d.id, "sold", "");
    expect((await opp(d.id)).status).toBe("withdrawn");
    expect((await events(d.propertyId, "sold"))[0].created_by).toBe(seededUserId("analyst"));
  });

  it("someone outside the organisation, and a read-only viewer, cannot - and nothing changes", async () => {
    const d = await newDeal();
    await expect(removeFromPipeline(orgUserSession([], seededUserId("analyst")), d.id, "sold", "")).rejects.toThrow(/could not be found/);
    await expect(removeFromPipeline(viewerSession([orgId]), d.id, "sold", "")).rejects.toThrow(/could not be found|cannot change/);
    expect(await opp(d.id)).toMatchObject({ status: "active", archived_at: null });
    expect(await events(d.propertyId, "sold")).toHaveLength(0);
  });
});
