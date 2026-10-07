// ============================================================================
// The reviewed one-off that folds a duplicate opportunity into its original
// (supabase/one-off/2026-10-07_merge_emerald_duplicate.sql, migration 0036), against real Postgres.
// ----------------------------------------------------------------------------
// The pair is built the way the incident happened: an original written by the pipeline load, and a
// second record for the same building written later by the deal-seed loader under a differently
// spelled, differently addressed name that the loader's name and address checks did not link. All
// names are fictional and prefixed ZZTEST.
//
// Proved here: the default run is a DRY RUN that changes nothing and prints the report; the applied run
// produces exactly the agreed result (merged status and pointer, rename with the old name kept, empty
// fields folded, the duplicate's underwriting kept as a NON-current draft, the audit row repointed,
// nothing deleted); a second run refuses; every guard stops the run and changes nothing; and the
// database itself refuses a merged status with no survivor.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminQuery, withSession } from "@/lib/db/client";
import { seedDeal, type SeedContext } from "@/lib/data/deal-seed";
import { parseDealSeed, type SeedDeal } from "@/lib/ingestion/deal-seed";
import { setOutcome, reactivate } from "@/lib/data/opportunities";
import { adminSession, orgIdByName } from "./helpers";

const SCRIPT = readFileSync(join(process.cwd(), "supabase/one-off/2026-10-07_merge_emerald_duplicate.sql"), "utf8");
const OLD_ID_IN_SCRIPT = "0f4d3e03-02ef-4957-918d-1ffb9d75bd48";
const NEW_ID_IN_SCRIPT = "b5c09009-02e1-4350-b163-e6c62fb74714";
const FINAL_IN_SCRIPT = "Emerald Theatre, Covent Garden";

let orgId: string;
let ctx: SeedContext;
let n = 0;
const RUN = String(Date.now()).slice(-6);
const letters = (k: number) => [...`${RUN}${String(k).padStart(2, "0")}`].map((c) => "abcdefghij"[Number(c)]).join("");

interface Pair { oldId: string; newId: string; oldProp: string; newProp: string; finalName: string; oldName: string; tag: string; oldRef: string; newRef: string }

const parse = (d: unknown): SeedDeal => parseDealSeed({ note: "fixture", deals: [d] })[0];
const seed = (deal: SeedDeal, c: Partial<SeedContext> = {}) => withSession(adminSession, (tx) => seedDeal(tx, { ...ctx, ...c }, deal));

/** The script with this pair's ids and name substituted, and the apply switch set. */
function scriptFor(p: Pair, apply: boolean): string {
  return SCRIPT
    .replaceAll(OLD_ID_IN_SCRIPT, p.oldId).replaceAll(NEW_ID_IN_SCRIPT, p.newId)
    .replace(`v_final_name text := '${FINAL_IN_SCRIPT}';`, `v_final_name text := '${p.finalName}';`)
    .replace("v_apply      boolean := false;", `v_apply      boolean := ${apply};`);
}

/** An original and a duplicate, built through the real loader, with the miss reproduced. */
async function makePair(over: { newPrice?: number; newBroker?: string; oldBroker?: string; oldKeepsItsFields?: boolean } = {}): Promise<Pair> {
  const tag = `ZZTEST${letters(++n)}`;
  const street = `${tag} Embankment`;
  const common = (name: string, address: string, price: number, niy: number, broker: string, contact: string | null) => parse({
    opportunity: { name, address, market: "London", asset_type: "Mixed Use", off_market: false, deal_stage: "guided",
      // The loader reads broker and contact only from "Broker email, Firm (Person)".
      sourcing: `Broker email, ${broker} (${contact ?? "Gaby Old"})` },
    asset_snapshot: { size_sq_ft: 20000, tenure: "Long leasehold", heritage_status: "Grade II Listed", tenant: `Tenant of ${tag}`, lease_expiry: "2050" },
    deal_terms: { guide_price_gbp: price, niy_percent: niy, currency: "GBP" },
    data_completeness: "full",
  });
  const oldName = `${tag} Alpha Theater`;
  const finalName = `${tag} Alpha Theatre, Covent Garden`;

  // The original: a name-led address (so its identity key is not the clean street key).
  const o = await seed(common(oldName, `${oldName}, 8 ${street}`, 13_400_000, 7.47, over.oldBroker ?? "Hanover Test", null));
  const oldId = o.opportunityId!, oldProp = o.propertyId!;
  const oldRef = `LON-${tag}`;
  // By default the original has no named contact (the real one did not); with oldKeepsItsFields it keeps everything it was loaded with.
  await adminQuery(`update opportunities set reference = $2, created_at = now() - interval '7 days'${over.oldKeepsItsFields ? "" : ", source_contact_name = null"} where opportunity_id = $1`, [oldId, oldRef]);
  // A different tenure than the duplicate carries (a clash to record, not resolve) and an empty heritage field (a gap to fill).
  await adminQuery("update properties set tenure = 'freehold', heritage_status = null where property_id = $1", [oldProp]);

  // The duplicate: the loader's output for the same building under a different spelling and a clean address.
  const dupDeal = common(finalName, `8 ${street}, London`, over.newPrice ?? 13_400_000, 7.0, over.newBroker ?? "Hanover Test LLP", "Guy Test");
  const nw = await seed(dupDeal, { allowExisting: true });
  expect(nw.outcome).toBe("created");
  const newId = nw.opportunityId!, newProp = nw.propertyId!;
  expect(newProp).not.toBe(oldProp);                         // the incident: two properties, two opportunities

  // The loader's own audit trail for the duplicate.
  const b = await adminQuery<{ batch_id: string }>(
    "insert into deal_load_batches(org_id, source_file, created_by) values ($1, $2, $3) returning batch_id", [orgId, `${tag}.json`, adminSession.userId]);
  await adminQuery(
    `insert into deal_load_rows(org_id, batch_id, reference, raw_row, outcome, opportunity_id, property_id)
     values ($1, $2, $3, $4::jsonb, 'created', $5, $6)`,
    [orgId, b[0].batch_id, dupDeal.reference, JSON.stringify({ tag }), newId, newProp]);
  return { oldId, newId, oldProp, newProp, finalName, oldName, tag, oldRef, newRef: dupDeal.reference };
}

async function stateOf(p: Pair) {
  const [o, nn, cases, props, events, audit, counts] = await Promise.all([
    adminQuery<Record<string, any>>("select * from opportunities where opportunity_id = $1", [p.oldId]),
    adminQuery<Record<string, any>>("select * from opportunities where opportunity_id = $1", [p.newId]),
    adminQuery<Record<string, any>>("select case_id, opportunity_id, version, status, acquisition_price, entry_yield_pct from investment_cases where opportunity_id = any($1) order by opportunity_id, version", [[p.oldId, p.newId]]),
    adminQuery<Record<string, any>>("select * from properties where property_id = any($1) order by property_id", [[p.oldProp, p.newProp]]),
    adminQuery<Record<string, any>>("select event_id, property_id, opportunity_id, event_type from property_events where property_id = any($1) order by event_id", [[p.oldProp, p.newProp]]),
    adminQuery<Record<string, any>>("select * from deal_load_rows where opportunity_id = any($1) or reference = $2", [[p.oldId, p.newId], p.newRef]),
    adminQuery<Record<string, any>>("select (select count(*) from opportunities) o, (select count(*) from properties) p, (select count(*) from investment_cases) c", []),
  ]);
  return { old: o[0], dup: nn[0], cases, props, events, audit, counts: counts[0] };
}

async function runScript(p: Pair, apply: boolean): Promise<{ ok: boolean; message: string }> {
  try { await adminQuery(scriptFor(p, apply), []); return { ok: true, message: "" }; }
  catch (e) { return { ok: false, message: (e as Error).message }; }
}

beforeAll(async () => {
  orgId = await orgIdByName("Meiji Shipping");
  ctx = { orgId, userId: adminSession.userId, allowExisting: false };
});

describe("the default run is a dry run", () => {
  it("reports what it would do, in full, and changes nothing", async () => {
    const p = await makePair();
    const before = await stateOf(p);
    const r = await runScript(p, false);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/DRY RUN - NOTHING WAS CHANGED/);
    expect(r.message).toContain("BEFORE");
    expect(r.message).toContain("AFTER");
    expect(r.message).toContain(`"${p.finalName}"`);
    expect(r.message).toMatch(/moved to the survivor as v2, draft/);
    expect(r.message).toMatch(/survivor case v1\s+current\s+price 13400000/);
    expect(await stateOf(p)).toEqual(before);                  // every row, every count, identical
  });

  it("is a dry run in the committed file: the switch is off", () => {
    expect(SCRIPT).toMatch(/v_apply\s+boolean := false;/);
  });
});

describe("applied, it produces exactly the agreed result", () => {
  it("merges, renames, folds, keeps the underwriting as a non-current draft, repoints the audit row, deletes nothing", async () => {
    const p = await makePair();
    const before = await stateOf(p);
    const r = await runScript(p, true);
    expect(r.ok, r.message).toBe(true);
    const after = await stateOf(p);

    // The survivor: same id, still active, renamed, old name kept, duplicate's gaps filled.
    expect(after.old).toMatchObject({ opportunity_id: p.oldId, status: "active", archived_at: null, name: p.finalName, reference: p.oldRef, property_id: p.oldProp });
    expect(after.old.source_contact_name).toBe("Guy Test");                       // was empty
    expect(after.old.broker_name).toBe("Hanover Test");                           // never overwritten by "Hanover Test LLP"
    expect(after.old.source_facts._previous_names).toEqual([expect.objectContaining({ name: p.oldName })]);
    expect(after.old.source_facts._merged_from).toHaveLength(1);
    expect(after.old.source_facts._merged_from[0]).toMatchObject({ opportunity_id: p.newId, reference: p.newRef, broker_name: "Hanover Test LLP" });
    expect(after.old.source_facts._loader_flags).toBeUndefined();                 // flags about the incoming record stay under _merged_from

    // The duplicate: merged, archived, pointing at the survivor, NOT deleted.
    expect(after.dup).toMatchObject({ status: "merged", merged_into_opportunity_id: p.oldId, name: p.finalName, reference: p.newRef });
    expect(after.dup.archived_at).not.toBeNull();
    expect(after.counts).toEqual(before.counts);                                   // no row deleted or created in opportunities, properties or cases

    // Underwriting: survivor's v1 untouched and still current; the duplicate's case is v2, a DRAFT.
    const v1 = after.cases.find((c) => c.opportunity_id === p.oldId && c.version === 1)!;
    const v2 = after.cases.find((c) => c.opportunity_id === p.oldId && c.version === 2)!;
    expect(v1).toMatchObject({ status: "current" });
    expect(Number(v1.entry_yield_pct)).toBe(7.47);
    expect(v2).toMatchObject({ status: "draft" });
    expect(Number(v2.entry_yield_pct)).toBe(7);
    expect(after.cases.filter((c) => c.opportunity_id === p.newId)).toHaveLength(0);
    // The survivor's projected headline still comes from its OWN current case: a draft is not an input.
    expect(Number((await stateOf(p)).old.niy)).toBe(7.47);

    // Building facts: empty fields filled from the duplicate's property; the clash recorded, not resolved.
    const survivorProp = after.props.find((x) => x.property_id === p.oldProp)!;
    expect(survivorProp.heritage_status).toBe(before.props.find((x) => x.property_id === p.newProp)!.heritage_status);   // folded
    expect(survivorProp.heritage_status).toBeTruthy();
    expect(survivorProp.tenure).toBe("freehold");                                  // survivor kept
    expect(after.old.source_facts._merged_from[0].property_clashes).toMatchObject({ tenure: { kept: "freehold", other: "long_leasehold" } });
    // The duplicate's own property is left alone.
    expect(after.props.find((x) => x.property_id === p.newProp)).toEqual(before.props.find((x) => x.property_id === p.newProp));

    // Events are append-only: the duplicate's first-seen stays, one note is added on the survivor's property.
    const added = after.events.filter((e) => !before.events.some((b) => b.event_id === e.event_id));
    expect(added).toEqual([expect.objectContaining({ property_id: p.oldProp, opportunity_id: p.oldId, event_type: "note" })]);
    for (const e of before.events) expect(after.events.find((a) => a.event_id === e.event_id)).toEqual(e);

    // The loader's audit trail: repointed, annotated, raw_row untouched, outcome unchanged.
    expect(after.audit).toHaveLength(1);
    expect(after.audit[0]).toMatchObject({ opportunity_id: p.oldId, property_id: p.oldProp, outcome: "created" });
    expect(after.audit[0].reason).toContain(`merged into ${p.oldId}`);
    expect(after.audit[0].raw_row).toEqual(before.audit[0].raw_row);
  });

  it("a loader re-run for the duplicate's reference finds the archived record, so it cannot be recreated", async () => {
    const p = await makePair();
    expect((await runScript(p, true)).ok).toBe(true);
    const countBefore = (await adminQuery<{ c: string }>("select count(*)::text c from opportunities"))[0].c;
    const deal = parse({
      opportunity: { name: p.finalName, address: `8 ${p.tag} Embankment, London`, market: "London", asset_type: "Mixed Use", off_market: false, deal_stage: "guided", sourcing: "x" },
      asset_snapshot: { size_sq_ft: 20000 }, deal_terms: { guide_price_gbp: 13_400_000, niy_percent: 7.0, currency: "GBP" }, data_completeness: "full",
    });
    expect(deal.reference).toBe(p.newRef);                                           // the same deal the loader would read
    const again = await seed(deal);
    expect(again.outcome).toBe("updated");                                          // found by reference, not recreated
    expect((await adminQuery<{ c: string }>("select count(*)::text c from opportunities"))[0].c).toBe(countBefore);
  });
});

describe("it never overwrites what the survivor already has", () => {
  it("keeps the survivor's contact, source line, stage and size, and still records what the duplicate said", async () => {
    const p = await makePair({ oldKeepsItsFields: true });
    await adminQuery("update opportunities set deal_stage = 'under_offer', size_sqft = 21000 where opportunity_id = $1", [p.oldId]);
    const before = await stateOf(p);
    expect(before.old.source_contact_name).toBe("Gaby Old");
    expect((await runScript(p, true)).ok).toBe(true);
    const after = await stateOf(p);
    expect(after.old).toMatchObject({ source_contact_name: "Gaby Old", source: before.old.source, deal_stage: "under_offer", broker_name: "Hanover Test" });
    expect(Number(after.old.size_sqft)).toBe(21000);
    // ...and the duplicate's own values are not lost: they are on the record of the merge.
    expect(after.old.source_facts._merged_from[0]).toMatchObject({ source: before.dup.source, broker_name: "Hanover Test LLP" });
  });
});

describe("running it twice is safe", () => {
  it("the second run finds the duplicate already merged and stops", async () => {
    const p = await makePair();
    expect((await runScript(p, true)).ok).toBe(true);
    const after = await stateOf(p);
    const again = await runScript(p, true);
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already merged/);
    expect(await stateOf(p)).toEqual(after);
  });
});

describe("every guard stops the run and changes nothing", () => {
  async function stops(p: Pair, pattern: RegExp) {
    const before = await stateOf(p);
    const r = await runScript(p, true);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(pattern);
    expect(await stateOf(p)).toEqual(before);
  }

  it("a record that does not exist", async () => {
    const p = await makePair();
    await stops({ ...p, newId: "00000000-0000-4000-8000-000000000000" }, /duplicate .* does not exist/);
    await stops({ ...p, oldId: "00000000-0000-4000-8000-000000000000" }, /survivor .* does not exist/);
  });

  it("the same record twice, or the duplicate older than the survivor", async () => {
    const p = await makePair();
    await stops({ ...p, newId: p.oldId }, /same record/);
    await adminQuery("update opportunities set created_at = now() - interval '30 days' where opportunity_id = $1", [p.newId]);
    await stops(p, /not newer than the survivor/);
  });

  it("anything else hanging off the duplicate (here a diligence item)", async () => {
    const p = await makePair();
    await adminQuery(
      "insert into opportunity_dd_items(org_id, opportunity_id, section, item, created_by) values ($1,$2,'Title','Check title',$3)",
      [orgId, p.newId, adminSession.userId]);
    await stops(p, /dependent records this script does not handle: opportunity_dd_items=1/);
  });

  it("prices more than 1% apart: not the same deal", async () => {
    const p = await makePair({ newPrice: 26_000_000 });
    await stops(p, /prices differ by more than 1%/);
  });

  it("a different broker firm", async () => {
    const p = await makePair({ newBroker: "Somebody Else Ltd" });
    await stops(p, /different broker firm/);
  });

  it("a duplicate that is not a deal-seed record", async () => {
    const p = await makePair();
    await adminQuery("update opportunities set reference = 'LON-OTHER' where opportunity_id = $1", [p.newId]);
    await stops(p, /does not look like a deal-seed record/);
  });

  it("a duplicate whose underwriting is approved", async () => {
    const p = await makePair();
    await adminQuery("update investment_cases set status = 'approved', approved_at = now() where opportunity_id = $1", [p.newId]);
    await stops(p, /only a draft or current case may be moved/);
  });

  it("an archived survivor", async () => {
    const p = await makePair();
    await adminQuery("update opportunities set status = 'withdrawn', archived_at = now() where opportunity_id = $1", [p.oldId]);
    await stops(p, /survivor is not an active, unarchived record/);
  });
});

describe("the database and the app refuse a half-made merge", () => {
  it("a merged status needs a survivor, a survivor pointer needs a merged status, and nothing merges into itself", async () => {
    const p = await makePair();
    await expect(adminQuery("update opportunities set status = 'merged' where opportunity_id = $1", [p.newId])).rejects.toThrow(/opportunities_merged_pointer/);
    await expect(adminQuery("update opportunities set merged_into_opportunity_id = $2 where opportunity_id = $1", [p.newId, p.oldId])).rejects.toThrow(/opportunities_merged_pointer/);
    await expect(adminQuery("update opportunities set status = 'merged', merged_into_opportunity_id = opportunity_id where opportunity_id = $1", [p.newId])).rejects.toThrow(/opportunities_merged_pointer/);
  });

  it("a survivor cannot be deleted while a merged record points at it", async () => {
    const p = await makePair();
    expect((await runScript(p, true)).ok).toBe(true);
    await expect(adminQuery("delete from opportunities where opportunity_id = $1", [p.oldId])).rejects.toThrow(/violates foreign key|merged_into/);
  });

  it("nobody can mark a record merged by hand, or bring a merged one back", async () => {
    const p = await makePair();
    await expect(setOutcome(adminSession, p.newId, "merged")).rejects.toThrow(/merge procedure/);
    expect((await runScript(p, true)).ok).toBe(true);
    await expect(reactivate(adminSession, p.newId)).rejects.toThrow(/cannot be reactivated/);
    expect((await adminQuery<{ status: string }>("select status from opportunities where opportunity_id = $1", [p.newId]))[0].status).toBe("merged");
  });

  it("a merged record is invisible to the loader's collision check (it is archived)", async () => {
    const p = await makePair();
    expect((await runScript(p, true)).ok).toBe(true);
    const probe = parse({
      // A different name that CONTAINS the merged pair's shared name: it must collide with the survivor, never with the archived duplicate.
      opportunity: { name: `${p.finalName} Annex`, address: `Probe ${p.tag}`, market: "London", asset_type: "Mixed Use", off_market: false, deal_stage: "guided", sourcing: "x" },
      asset_snapshot: { size_sq_ft: 1000 }, deal_terms: { guide_price_gbp: 1_000_000, niy_percent: 5, currency: "GBP" }, data_completeness: "full",
    });
    const held = await seed(probe);
    // It collides with the SURVIVOR (same name now), never with the merged duplicate.
    expect(held.outcome).toBe("held");
    expect(held.collisions.every((c) => c.opportunityId !== p.newId)).toBe(true);
    expect(held.collisions.map((c) => c.opportunityId)).toContain(p.oldId);
  });
});
