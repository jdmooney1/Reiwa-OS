// ============================================================================
// Data-layer verification against the local cluster.
// ----------------------------------------------------------------------------
// Exercises the REAL data layer (resolveProperty, createOpportunity,
// promoteItem) over a live PostgreSQL, under the same RLS session wrapper the
// application uses. Proves the behaviour that pure unit tests cannot: that the
// D1 fix genuinely stops duplicate properties, that promotion writes the
// opportunity and its timeline, and that attaching fills blanks without
// overwriting.
//
// Run via `npm run db:verify`, which starts the cluster and applies migrations
// first. Needs no Supabase credentials.
// ============================================================================
import { Pool } from "pg";
import { withSessionOn, type Session } from "@/lib/db/client";
import { resolveProperty } from "@/lib/data/properties";
import { suggestMappings } from "@/lib/ingestion/mapping";
import { extractRow } from "@/lib/ingestion/rows";

const ORG = "aaaaaaaa-0000-0000-0000-000000000009";
const USER = "99999999-9999-9999-9999-999999999999";

const session: Session = { userId: USER, orgIds: [ORG], role: "org_user", canWrite: true };

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { failures++; console.error(`FAIL ${label} - expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
  else console.log(`ok   ${label}`);
}

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });

  // Fixtures on the privileged connection.
  await pool.query("insert into auth.users(id, email) values ($1,$2) on conflict do nothing", [USER, "verify@example.com"]);
  await pool.query("insert into profiles(user_id, email, name, global_role) values ($1,$2,'Verify','org_user') on conflict do nothing", [USER, "verify@example.com"]);
  await pool.query("insert into organizations(org_id, name) values ($1,'Verify Org') on conflict do nothing", [ORG]);

  // ---- 1. resolveProperty dedupes across broker spellings -------------------
  await withSessionOn(pool, session, async (tx) => {
    const a = await resolveProperty(tx, {
      orgId: ORG, name: "16 Conduit Street",
      address: "16 Conduit St, Mayfair, London W1S 2XJ",
    });
    const b = await resolveProperty(tx, {
      orgId: ORG, name: "16 Conduit Street",
      address: "16 Conduit Street, London", postcode: "W1S 2XJ",
    });
    check("three spellings resolve to ONE property", a.propertyId === b.propertyId, true);
    check("the first call created it", a.created, true);
    check("the second call reused it", b.created, false);

    const c = await resolveProperty(tx, {
      orgId: ORG, name: "22 Conduit Street",
      address: "22 Conduit Street, London W1S 2XJ",
    });
    check("the neighbouring building stays separate", c.propertyId !== a.propertyId, true);

    // No address detail: must always create, never merge.
    const d = await resolveProperty(tx, { orgId: ORG, name: "Mayfair Asset" });
    const e = await resolveProperty(tx, { orgId: ORG, name: "Mayfair Asset" });
    check("an unkeyable property never auto-merges", d.propertyId !== e.propertyId, true);
  });

  // ---- 2. resolveProperty enriches blanks, never overwrites ----------------
  await withSessionOn(pool, session, async (tx) => {
    await resolveProperty(tx, {
      orgId: ORG, name: "Enrich Test",
      address: "1 Enrich Road, London EC2V 7HH", city: "London",
    });
    // A later source supplies a submarket and a DIFFERENT city.
    await resolveProperty(tx, {
      orgId: ORG, name: "Enrich Test",
      address: "1 Enrich Road", postcode: "EC2V 7HH",
      city: "Westminster", submarket: "City",
    });
    const { rows } = await tx.query<{ city: string; submarket: string }>(
      "select city, submarket from properties where org_id = $1 and name = 'Enrich Test'", [ORG]);
    check("exactly one property row exists", rows.length, 1);
    check("the populated city was NOT overwritten", rows[0].city, "London");
    check("the blank submarket WAS filled", rows[0].submarket, "City");
  });

  // ---- 3. createOpportunity reuses the property (the D1 fix) ---------------
  const { createOpportunity } = await import("@/lib/data/opportunities");
  const first = await createOpportunity(session, {
    orgId: ORG, name: "16 Conduit Street",
    address: "16 Conduit Street, London", postcode: "W1S 2XJ",
    targetPrice: 8_000_000, currency: "GBP", brokerName: "Knight Frank",
  });
  const second = await createOpportunity(session, {
    orgId: ORG, name: "16 Conduit Street",
    address: "16 Conduit St, Mayfair W1S 2XJ",
    targetPrice: 7_400_000, currency: "GBP", brokerName: "Savills",
  });

  await withSessionOn(pool, session, async (tx) => {
    const { rows: props } = await tx.query<{ n: string }>(
      "select count(*) as n from properties where org_id = $1 and identity_key = 'pc:W1S2XJ|16conduitstreet'", [ORG]);
    check("two campaigns share ONE property (D1 fix)", Number(props[0].n), 1);

    const { rows: opps } = await tx.query<{ n: string }>(
      "select count(*) as n from opportunities where org_id = $1 and name = '16 Conduit Street'", [ORG]);
    check("but remain two distinct opportunities", Number(opps[0].n), 2);

    // The longitudinal claim: one property timeline spanning both campaigns.
    const { rows: events } = await tx.query<{ n: string }>(
      `select count(*) as n from property_events
        where property_id = (select property_id from properties
                              where org_id = $1 and identity_key = 'pc:W1S2XJ|16conduitstreet')`, [ORG]);
    check("one shared property timeline across both", Number(events[0].n) >= 4, true);
  });
  check("the two opportunities are different records", first !== second, true);

  // ---- 4. Promotion writes an opportunity and its timeline -----------------
  const { createBatch, insertRows, promoteItem, listInbox } = await import("@/lib/data/ingestion");
  const headers = ["Property", "Address", "Guide Price", "Passing Rent", "Yield", "Broker", "EPC"];
  const mappings = suggestMappings(headers);
  const parsed = [
    ["40 Gresham Street", "40 Gresham Street, London EC2V 7HH", "£24,000,000", "£1,100,000", "4.3%", "Savills", "B"],
    ["16 Conduit Street", "16 Conduit St, W1S 2XJ", "£7,200,000", "£540,000", "4.1%", "Savills", "C"],
  ].map((cells) => extractRow(cells, mappings, { defaultCurrency: "GBP" }));

  const batchId = await withSessionOn(pool, session, async (tx) => {
    const id = await createBatch(tx, {
      orgId: ORG, label: "Savills list", sourceFileName: "savills.xlsx",
      defaultCurrency: "GBP", createdBy: USER,
    });
    await insertRows(tx, ORG, id, parsed);
    return id;
  });

  const inbox = await listInbox(session, { batchId });
  check("both rows staged in the inbox", inbox.length, 2);
  check("the unmapped EPC column survived verbatim", inbox.some((i) => "EPC" in i.rawPayload), true);

  const gresham = inbox.find((i) => i.displayName?.startsWith("40"))!;
  const promoted = await promoteItem(session, gresham.itemId, { userId: USER });
  check("promotion created a new opportunity", promoted.createdOpportunity, true);

  await withSessionOn(pool, session, async (tx) => {
    const { rows } = await tx.query<{ target_price: string; broker_name: string; stage: string }>(
      "select target_price, broker_name, stage from opportunities where opportunity_id = $1",
      [promoted.opportunityId]);
    check("the price landed", Number(rows[0].target_price), 24_000_000);
    check("the broker landed", rows[0].broker_name, "Savills");
    check("it enters at the inbox stage", rows[0].stage, "inbox");

    const { rows: ev } = await tx.query<{ event_type: string }>(
      "select event_type from property_events where opportunity_id = $1 order by event_type",
      [promoted.opportunityId]);
    check("promotion wrote first_seen and price_quoted",
      ev.map((e) => e.event_type), ["first_seen", "price_quoted"]);
  });

  // ---- 5. Attaching fills blanks and records the price move ---------------
  const conduit = inbox.find((i) => i.displayName?.startsWith("16"))!;
  const attached = await promoteItem(session, conduit.itemId, {
    attachToOpportunityId: second, userId: USER,
  });
  check("attaching did not create an opportunity", attached.createdOpportunity, false);

  await withSessionOn(pool, session, async (tx) => {
    const { rows } = await tx.query<{ target_price: string; passing_rent: string }>(
      "select target_price, passing_rent from opportunities where opportunity_id = $1", [second]);
    check("the populated price was NOT overwritten", Number(rows[0].target_price), 7_400_000);
    check("the blank passing rent WAS filled", Number(rows[0].passing_rent), 540_000);

    const { rows: ev } = await tx.query<{ headline: string }>(
      `select headline from property_events
        where opportunity_id = $1 and event_type = 'price_changed'`, [second]);
    check("the price move was recorded as intelligence", ev.length, 1);
    check("and it names both figures",
      /7\.40m.*7\.20m/.test(ev[0]?.headline ?? ""), true);
  });

  // ---- 6. An item cannot be promoted twice --------------------------------
  let doublePromoteBlocked = false;
  try { await promoteItem(session, gresham.itemId, { userId: USER }); }
  catch { doublePromoteBlocked = true; }
  check("an item cannot be promoted twice", doublePromoteBlocked, true);

  // ---- 7. The status axes survive a database round-trip -------------------
  // displayStatus() is unit-tested in isolation; this proves the columns it
  // reads actually persist and come back through the real mapper.
  const { listOpportunities, updateOpportunity } = await import("@/lib/data/opportunities");
  const { displayStatus, canPublish } = await import("@/lib/ingestion/status");

  await updateOpportunity(session, promoted.opportunityId, {
    marketStatus: "under_offer", reiwaPosition: "bid_submitted",
  });
  let listed = (await listOpportunities(session))
    .find((o) => o.opportunityId === promoted.opportunityId)!;
  check("market_status round-tripped", listed.marketStatus, "under_offer");
  check("reiwa_position round-tripped", listed.reiwaPosition, "bid_submitted");
  check("Reiwa's own position outranks the market's",
    displayStatus(listed).label, "Bid submitted");

  await updateOpportunity(session, promoted.opportunityId, { reiwaPosition: "none" });
  listed = (await listOpportunities(session))
    .find((o) => o.opportunityId === promoted.opportunityId)!;
  check("a third party under offer reads differently",
    displayStatus(listed).label.includes("third party"), true);

  // ---- 8. The investor-ready gate ----------------------------------------
  check("an inbox-stage opportunity cannot be published",
    canPublish(listed).allowed, false);
  await updateOpportunity(session, promoted.opportunityId, { stage: "investor_ready" });
  listed = (await listOpportunities(session))
    .find((o) => o.opportunityId === promoted.opportunityId)!;
  check("marking it investor ready opens the gate", canPublish(listed).allowed, true);
  await updateOpportunity(session, promoted.opportunityId, { status: "watchlist" });
  listed = (await listOpportunities(session))
    .find((o) => o.opportunityId === promoted.opportunityId)!;
  check("watchlisting closes it again", canPublish(listed).allowed, false);

  await pool.end();

  console.log("");
  if (failures > 0) { console.error(`${failures} data-layer assertion(s) failed.`); process.exit(1); }
  console.log("All data-layer assertions passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
