// ============================================================================
// Seeding structured deals as draft opportunities (migration 0032), against real Postgres.
// ----------------------------------------------------------------------------
// Proved here: the new columns hold what the source said and NULL where it did not; a seeded
// deal is a draft nobody can see but staff (no publication, no investor row, none of the new
// columns in anything an investor can read); money goes to an investment case; a re-run changes
// nothing a person has since edited; a deal for a building already in the pipeline is HELD, not
// duplicated; and the database refuses the combinations the loader never writes.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adminQuery, withSession, withInvestorSession, type Session } from "@/lib/db/client";
import { createOpportunity } from "@/lib/data/opportunities";
import { seedDeal, type SeedContext } from "@/lib/data/deal-seed";
import { parseDealSeed, type SeedDeal } from "@/lib/ingestion/deal-seed";
import { fullDeal, waultDeal, earlyDeal, thinDeal, conflictDeal, file } from "./unit/deal-seed.fixture";
import { adminSession, orgIdByName, investorAuthUserId } from "./helpers";

let orgId: string;
let ctx: SeedContext;
let n = 0;
const RUN = String(Date.now()).slice(-6);

/** A fixture deal made unique to this run and this test, so the duplicate guard sees only what a test sets up. */
function unique<T extends { opportunity: { name: string; address: string } }>(deal: T): T {
  // Letters only: a digit in the address would read as a house number and change whether it is keyed.
  const tag = `Zq${[...`${RUN}${String(++n).padStart(2, "0")}`].map((c) => "abcdefghij"[Number(c)]).join("")}`;
  const d = JSON.parse(JSON.stringify(deal)) as T;
  d.opportunity.name = `${tag} ${d.opportunity.name}`;
  d.opportunity.address = `${tag} ${d.opportunity.address}`;
  return d;
}
const parse = (d: unknown): SeedDeal => parseDealSeed(file(d))[0];
const seed = (deal: SeedDeal, c: Partial<SeedContext> = {}) =>
  withSession(adminSession, (tx) => seedDeal(tx, { ...ctx, ...c }, deal));
const opp = async (id: string) => (await adminQuery<Record<string, any>>("select * from opportunities where opportunity_id = $1", [id]))[0];
const prop = async (id: string) => (await adminQuery<Record<string, any>>("select * from properties where property_id = $1", [id]))[0];

beforeAll(async () => {
  orgId = await orgIdByName("Meiji Shipping");
  ctx = { orgId, userId: adminSession.userId, allowExisting: false };
});

describe("a seeded deal is a draft, with what the source said and nothing else", () => {
  it("lands at stage new, active, untriaged and unowned, on a version-1 case, with a first-seen event", async () => {
    const d = parse(unique(fullDeal()));
    const r = await seed(d);
    expect(r.outcome).toBe("created");
    const o = await opp(r.opportunityId!);
    expect(o).toMatchObject({
      stage: "new", status: "active", triage_status: "untriaged", owner_user_id: null, created_by: adminSession.userId,
      deal_stage: "guided", source_type: "broker_marketed", asset_type: "mixed_use", currency: "GBP",
      broker_name: "Example Partners LLP", source_contact_name: "Pat Example", reference: d.reference,
      source: "Broker IM, Example Partners LLP (Pat Example)", data_completeness: "full - broker IM email read in full",
    });
    expect(Number(o.size_sqft)).toBe(20000);
    const c = await adminQuery<Record<string, any>>("select * from investment_cases where opportunity_id = $1", [r.opportunityId]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ version: 1, status: "current", created_by: adminSession.userId });
    expect([Number(c[0].acquisition_price), Number(c[0].entry_yield_pct), Number(c[0].gross_rental_income)]).toEqual([13400000, 7, 1000000]);
    // The 0009 trigger carried the money to the opportunity: it was never written there directly.
    expect([Number(o.target_price), Number(o.niy), Number(o.passing_rent)]).toEqual([13400000, 7, 1000000]);
    const ev = await adminQuery("select 1 from property_events where opportunity_id = $1 and event_type = 'first_seen' and source_kind = 'brochure'", [r.opportunityId]);
    expect(ev).toHaveLength(1);
  });

  it("NULL STAYS NULL on the building: missing EPC, transport, WAULT, covenant stay null; a peppercorn is a note, not zero", async () => {
    const r = await seed(parse(unique(fullDeal())));
    const p = await prop(r.propertyId!);
    expect(p).toMatchObject({
      heritage_status: "Grade II Listed", tenure: "long_leasehold", ground_rent_pa: null, ground_rent_note: "Peppercorn",
      covenant_rating: "D&B 3A3", epc_rating: null, transport_connectivity: null, wault_to_expiry_years: null, wault_to_breaks_years: null,
    });
    expect(Number(p.unexpired_term_years)).toBe(131);
  });

  it("holds WAULT, an amount of ground rent, EPC and transport when the source states them", async () => {
    const r = await seed(parse(unique(waultDeal())));
    const p = await prop(r.propertyId!);
    expect(p).toMatchObject({ tenure: "virtual_freehold", epc_rating: "B", transport_connectivity: "Underground, short walk", ground_rent_note: null });
    expect([Number(p.ground_rent_pa), Number(p.unexpired_term_years), Number(p.wault_to_expiry_years), Number(p.wault_to_breaks_years)]).toEqual([100, 892, 4.2, 3.4]);
    expect(r.propertyUnkeyed).toBe(true); // no house number: reported, never hidden
  });

  it("a pre-pricing deal has NO investment case, and its opportunity carries no price or yield; its photograph is an external link", async () => {
    const r = await seed(parse(unique(earlyDeal())));
    expect(await adminQuery("select 1 from investment_cases where opportunity_id = $1", [r.opportunityId])).toHaveLength(0);
    const o = await opp(r.opportunityId!);
    expect(o).toMatchObject({ deal_stage: "early_dialogue", target_price: null, niy: null, passing_rent: null, source_type: "off_market" });
    expect(o).toMatchObject({ photo_reference_type: "external_url", photo_url: "https://example.com/project/gamma", source_attachments: [] });
  });

  it("a thin deal keeps its unretrieved attachments, and no tenure", async () => {
    const r = await seed(parse(unique(thinDeal())));
    const o = await opp(r.opportunityId!);
    expect(o).toMatchObject({ photo_reference_type: "attachment_not_retrieved", photo_url: null, source_attachments: ["Photos.pdf", "Data.xlsx"] });
    expect((await prop(r.propertyId!)).tenure).toBeNull();
  });

  it("keeps every other source fact, and the loader's own flags, in source_facts", async () => {
    const r = await seed(parse(unique(conflictDeal())));
    const sf = (await opp(r.opportunityId!)).source_facts;
    expect(sf.asset_snapshot).toBeUndefined(); // everything in it was mapped
    expect(sf.deal_terms).toMatchObject({ price_psf_gbp: 917, passing_rent_psf_gbp: 62 });
    expect(sf._loader_flags.map((f: { code: string }) => f.code)).toEqual(expect.arrayContaining(["price_psf_mismatch", "source_note", "source_conflict_noted"]));
    // The conflicting price is stored AS GIVEN: the loader picks no winner.
    expect(Number((await opp(r.opportunityId!)).target_price)).toBe(27500000);
  });
});

describe("re-running", () => {
  it("is idempotent: one opportunity, one case, one event", async () => {
    const d = parse(unique(fullDeal()));
    const a = await seed(d);
    const b = await seed(d);
    expect(b.outcome).toBe("updated");
    expect(b.opportunityId).toBe(a.opportunityId);
    for (const [sql, want] of [
      ["select count(*)::int n from opportunities where reference = $1", 1],
      ["select count(*)::int n from investment_cases where opportunity_id = (select opportunity_id from opportunities where reference = $1)", 1],
      ["select count(*)::int n from property_events where opportunity_id = (select opportunity_id from opportunities where reference = $1) and event_type = 'first_seen'", 1],
    ] as const) {
      expect((await adminQuery<{ n: number }>(sql, [d.reference]))[0].n).toBe(want);
    }
  });

  it("never overwrites what a person has since changed: it only fills what is still empty", async () => {
    const d = parse(unique(fullDeal()));
    const a = await seed(d);
    await adminQuery("update opportunities set deal_stage = 'under_offer', broker_name = 'Edited Broker' where opportunity_id = $1", [a.opportunityId]);
    await adminQuery("update properties set epc_rating = 'C', tenure = 'freehold' where property_id = $1", [a.propertyId]);
    await adminQuery("update investment_cases set acquisition_price = 12000000 where opportunity_id = $1", [a.opportunityId]);
    await seed(d);
    const o = await opp(a.opportunityId!);
    expect(o).toMatchObject({ deal_stage: "under_offer", broker_name: "Edited Broker" });
    expect(await prop(a.propertyId!)).toMatchObject({ epc_rating: "C", tenure: "freehold" });
    expect(Number((await adminQuery<{ p: string }>("select acquisition_price p from investment_cases where opportunity_id = $1", [a.opportunityId]))[0].p)).toBe(12000000);
  });

  it("does fill a field that was empty and is now stated", async () => {
    const d = parse(unique(thinDeal()));
    const a = await seed(d);
    await adminQuery("update opportunities set deal_stage = null where opportunity_id = $1", [a.opportunityId]);
    await seed(d);
    expect((await opp(a.opportunityId!)).deal_stage).toBe("guided");
  });
});

describe("a deal for a building already in the pipeline is HELD, never duplicated", () => {
  async function existing(name: string, address: string, extra: { broker?: string; price?: number } = {}) {
    const id = await createOpportunity(
      { ...adminSession, orgIds: [orgId] },
      { orgId, name, address, city: "London", market: "London", assetType: "office", brokerName: extra.broker ?? undefined } as never);
    if (extra.price) await adminQuery("insert into investment_cases(org_id, opportunity_id, version, status, created_by, acquisition_price) values ($1,$2,1,'current',$3,$4)", [orgId, id, adminSession.userId, extra.price]);
    return id;
  }

  it("same property: held, with the existing record's broker and price, and no new opportunity or property", async () => {
    const d = parse(unique(fullDeal()));
    const existingId = await existing(`Tracker ${d.name}`.replace(/\s+/g, " "), d.address, { broker: "Tracker Broker", price: 26_000_000 });
    const props = Number((await adminQuery<{ n: string }>("select count(*)::text n from properties where org_id = $1", [orgId]))[0].n);
    const r = await seed(d);
    expect(r.outcome).toBe("held");
    expect(r.collisions[0]).toMatchObject({ opportunityId: existingId, why: "same_property", brokerName: "Tracker Broker", price: 26_000_000 });
    expect(await adminQuery("select 1 from opportunities where reference = $1", [d.reference])).toHaveLength(0);
    expect(Number((await adminQuery<{ n: string }>("select count(*)::text n from properties where org_id = $1", [orgId]))[0].n)).toBe(props);
  });

  it("similar name at a different address: held (the Watling Street shape: the tracker says one thing, the broker another)", async () => {
    const d = parse(unique(conflictDeal()));
    const tracker = d.name.replace(" & 10 Zeta Lane", "");
    const existingId = await existing(tracker, `1 Elsewhere Road ${RUN}${n}`, { broker: "Someone Else", price: 26_000_000 });
    const r = await seed(d);
    expect(r.outcome).toBe("held");
    expect(r.collisions).toEqual([expect.objectContaining({ opportunityId: existingId, why: "similar_name", brokerName: "Someone Else", price: 26_000_000 })]);
  });

  it("a held deal does not break the next one in the same transaction", async () => {
    const held = parse(unique(fullDeal()));
    await existing(`Tracker ${held.name}`, held.address);
    const ok = parse(unique(thinDeal()));
    const [a, b] = await withSession(adminSession, async (tx) => [await seedDeal(tx, ctx, held), await seedDeal(tx, ctx, ok)]);
    expect([a.outcome, b.outcome]).toEqual(["held", "created"]);
    expect((await opp(b.opportunityId!)).reference).toBe(ok.reference);
  });

  it("--allow-existing writes it anyway, and still reports what it sits beside", async () => {
    const d = parse(unique(fullDeal()));
    await existing(`Tracker ${d.name}`, d.address, { price: 26_000_000 });
    const r = await seed(d, { allowExisting: true });
    expect(r.outcome).toBe("created");
    expect(r.collisions).toHaveLength(1);
  });
});

describe("nothing a seeded deal carries is reachable by an investor", () => {
  const NEW_COLUMNS = ["heritage_status", "tenure", "unexpired_term_years", "ground_rent_pa", "ground_rent_note", "wault_to_expiry_years",
    "wault_to_breaks_years", "covenant_rating", "rent_review_mechanism", "epc_rating", "transport_connectivity", "deal_stage",
    "photo_reference_type", "photo_url", "source_attachments", "data_completeness", "source_facts"];

  it("no publication, source or entitlement references a seeded deal", async () => {
    const r = await seed(parse(unique(fullDeal())));
    expect(await adminQuery("select 1 from publication_sources where opportunity_id = $1", [r.opportunityId])).toHaveLength(0);
  });

  it("an investor session reads no row of opportunities, properties or investment_cases, seeded or not", async () => {
    await seed(parse(unique(fullDeal())));
    const uid = await investorAuthUserId("principal@kitano-fo.example");
    for (const t of ["opportunities", "properties", "investment_cases", "deal_load_rows"]) {
      const rows = await withInvestorSession(uid, (tx) => tx.query<{ n: number }>(`select count(*)::int as n from ${t}`).catch(() => ({ rows: [{ n: 0 }] })));
      expect(rows.rows[0].n, t).toBe(0);
    }
  });

  it("what a publication would be built from names its fields one by one, and none of the new columns is among them", async () => {
    const r = await seed(parse(unique(fullDeal())));
    const keys = (await adminQuery<{ k: string }>("select jsonb_object_keys(app.opportunity_publication_source($1)) k", [r.opportunityId])).map((x) => x.k);
    expect(keys.length).toBeGreaterThan(5);
    for (const c of NEW_COLUMNS) expect(keys, c).not.toContain(c);
  });

  it("no function or view in the database mentions a new column", async () => {
    const fns = await adminQuery<{ n: string }>(
      `select p.proname n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname in ('app', 'public') and p.prosrc ~* $1`, [NEW_COLUMNS.join("|")]);
    expect(fns.map((f) => f.n)).toEqual([]);
    const views = await adminQuery<{ n: string }>(
      "select viewname n from pg_views where schemaname = 'public' and definition ~* $1", [NEW_COLUMNS.join("|")]);
    expect(views.map((v) => v.n)).toEqual([]);
  });
});

describe("the database refuses what the loader never writes", () => {
  async function mk() {
    const r = await seed(parse(unique(thinDeal())));
    return r;
  }
  const upd = (sql: string, p: unknown[]) => adminQuery(sql, p);

  it("an unknown tenure, deal stage or photo type; a negative figure; blank text", async () => {
    const r = await mk();
    await expect(upd("update properties set tenure = 'commonhold' where property_id = $1", [r.propertyId])).rejects.toThrow(/properties_tenure_valid/);
    await expect(upd("update properties set unexpired_term_years = -1 where property_id = $1", [r.propertyId])).rejects.toThrow(/properties_intake_figures_valid/);
    await expect(upd("update properties set epc_rating = '  ' where property_id = $1", [r.propertyId])).rejects.toThrow(/properties_intake_text_valid/);
    await expect(upd("update opportunities set deal_stage = 'exchanged' where opportunity_id = $1", [r.opportunityId])).rejects.toThrow(/opportunities_deal_stage_valid/);
    await expect(upd("update opportunities set photo_reference_type = 'stored' where opportunity_id = $1", [r.opportunityId])).rejects.toThrow(/opportunities_photo_reference_valid/);
  });

  it("a photo reference that contradicts itself", async () => {
    const r = await mk(); // attachment_not_retrieved, two attachments, no url
    const bad = (set: string) => upd(`update opportunities set ${set} where opportunity_id = $1`, [r.opportunityId]);
    await expect(bad("photo_url = 'https://example.com/x'")).rejects.toThrow(/photo_reference_valid/);           // a url without external_url
    await expect(bad("photo_reference_type = 'external_url'")).rejects.toThrow(/photo_reference_valid/);          // external_url without a url
    await expect(bad("photo_reference_type = 'none_found'")).rejects.toThrow(/photo_reference_valid/);            // none_found beside attachments
    await expect(bad("source_attachments = '[]'::jsonb")).rejects.toThrow(/photo_reference_valid/);               // attachment_not_retrieved with none
    await expect(bad("photo_reference_type = 'external_url', photo_url = 'ftp://x', source_attachments = '[]'::jsonb")).rejects.toThrow(/photo_reference_valid/);
    await expect(bad("photo_reference_type = 'external_url', photo_url = 'https://example.com/x', source_attachments = '[]'::jsonb")).resolves.toBeTruthy();
    await expect(bad("photo_reference_type = null, photo_url = 'https://example.com/x'")).rejects.toThrow(/photo_reference_valid/); // a url with no type
  });

  it("source_facts must be an object and source_attachments a list", async () => {
    const r = await mk();
    await expect(upd(`update opportunities set source_facts = '[]'::jsonb where opportunity_id = $1`, [r.opportunityId])).rejects.toThrow(/source_facts_valid/);
    await expect(upd(`update opportunities set source_attachments = '{}'::jsonb where opportunity_id = $1`, [r.opportunityId])).rejects.toThrow(/photo_reference_valid/);
  });

  it("the migration can be applied twice without error (it is the ledger's job to run it once, and safe if it does not)", async () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0032_deal_intake_fields.sql"), "utf8");
    await expect(adminQuery(sql).then(() => "applied")).resolves.toBe("applied");
  });
});

describe("a reference that matches CLOSED history is held, never written to", () => {
  const snapshot = async (id: string) => (await adminQuery<{ j: unknown }>("select to_jsonb(o) as j from opportunities o where opportunity_id = $1", [id]))[0].j;
  const propCount = async () => Number((await adminQuery<{ n: string }>("select count(*)::text n from properties where org_id = $1", [orgId]))[0].n);

  /** Load a deal, blank a field the seed would refill, then close the record. */
  async function loaded(close: (id: string) => Promise<void>) {
    const d = parse(unique(fullDeal()));
    const first = await seed(d);
    expect(first.outcome).toBe("created");
    await adminQuery("update opportunities set broker_name = null, source = null where opportunity_id = $1", [first.opportunityId]);
    await close(first.opportunityId!);
    return { d, id: first.opportunityId! };
  }

  it("an ARCHIVED record is not updated; the hold names it as archived, with its status", async () => {
    const { d, id } = await loaded((i) => adminQuery("update opportunities set status = 'withdrawn', archived_at = now() where opportunity_id = $1", [i]).then(() => undefined));
    const before = await snapshot(id);
    const props = await propCount();
    const r = await seed(d);
    expect(r.outcome).toBe("held");
    expect(r.collisions[0]).toMatchObject({ opportunityId: id, why: "already_archived", status: "withdrawn", reference: d.reference });
    expect(await snapshot(id)).toEqual(before);                       // not one column touched (the blanked broker is still blank)
    expect((await opp(id)).broker_name).toBeNull();
    expect(await propCount()).toBe(props);                            // and the held attempt left no property behind
    expect(await adminQuery("select 1 from opportunities where org_id = $1 and reference = $2", [orgId, d.reference])).toHaveLength(1);
  });

  it("--allow-existing does not override it: closed history is not written to", async () => {
    const { d, id } = await loaded((i) => adminQuery("update opportunities set status = 'lost', archived_at = now() where opportunity_id = $1", [i]).then(() => undefined));
    const before = await snapshot(id);
    const r = await seed(d, { allowExisting: true });
    expect(r.outcome).toBe("held");
    expect(r.collisions[0].why).toBe("already_archived");
    expect(await snapshot(id)).toEqual(before);
  });

  it("a held closed reference does not break the next deal in the same transaction", async () => {
    const { d } = await loaded((i) => adminQuery("update opportunities set status = 'rejected', archived_at = now() where opportunity_id = $1", [i]).then(() => undefined));
    const ok = parse(unique(thinDeal()));
    const [a, b] = await withSession(adminSession, async (tx) => [await seedDeal(tx, ctx, d), await seedDeal(tx, ctx, ok)]);
    expect([a.outcome, b.outcome]).toEqual(["held", "created"]);
  });

  it("a MERGED record is not updated; the hold carries the merge pointer and the survivor's name", async (t) => {
    const hasPointer = (await adminQuery("select 1 from information_schema.columns where table_name = 'opportunities' and column_name = 'merged_into_opportunity_id'")).length === 1;
    if (!hasPointer) return t.skip(); // needs migration 0036 (merged status + pointer); runs once that is in the schema
    const survivor = await seed(parse(unique(thinDeal())));
    const survivorName = (await opp(survivor.opportunityId!)).name as string;
    const { d, id } = await loaded((i) => adminQuery(
      "update opportunities set status = 'merged', archived_at = now(), merged_into_opportunity_id = $2 where opportunity_id = $1", [i, survivor.opportunityId]).then(() => undefined));
    const before = await snapshot(id);
    const r = await seed(d);
    expect(r.outcome).toBe("held");
    expect(r.collisions[0]).toMatchObject({ opportunityId: id, why: "already_merged", status: "merged", mergedInto: survivor.opportunityId, mergedIntoName: survivorName });
    expect(await snapshot(id)).toEqual(before);
    expect((await opp(id)).broker_name).toBeNull();
    const rAllow = await seed(d, { allowExisting: true });
    expect(rAllow.outcome).toBe("held");
  });

  it("a LIVE record with the same reference is still updated, as before", async () => {
    const d = parse(unique(fullDeal()));
    const first = await seed(d);
    await adminQuery("update opportunities set broker_name = null where opportunity_id = $1", [first.opportunityId]);
    const again = await seed(d);
    expect(again.outcome).toBe("updated");
    expect((await opp(first.opportunityId!)).broker_name).toBe("Example Partners LLP");
  });
});

describe("a name variant is now a collision (the Emerald Theatre / Theater gap)", () => {
  async function existingNamed(name: string) {
    return createOpportunity({ ...adminSession, orgIds: [orgId] },
      { orgId, name, address: `1 Elsewhere Road ${RUN}${++n}`, city: "London", market: "London", assetType: "office" } as never);
  }
  const named = (name: string) => {
    const raw = unique(fullDeal());
    const tag = raw.opportunity.name.split(" ")[0];
    raw.opportunity.name = `${tag} ${name}`;
    return { d: parse(raw), tag };
  };

  it("Theater in the seed row, Theatre already in the pipeline: held as a similar name", async () => {
    const { d, tag } = named("Emerald Theater, Covent Garden");
    const existingId = await existingNamed(`${tag} Emerald Theatre, Covent Garden`);
    const r = await seed(d);
    expect(r.outcome).toBe("held");
    expect(r.collisions).toEqual([expect.objectContaining({ opportunityId: existingId, why: "similar_name" })]);
  });

  it("and the other way round", async () => {
    const { d, tag } = named("Emerald Theatre, Covent Garden");
    await existingNamed(`${tag} Emerald Theater, Covent Garden`);
    expect((await seed(d)).outcome).toBe("held");
  });

  it("a different building with a similar name is not held", async () => {
    const { d, tag } = named("Emerald Hotel, Covent Garden");
    await existingNamed(`${tag} Emerald Theatre, Covent Garden`);
    expect((await seed(d)).outcome).toBe("created");
  });
});
