// ============================================================================
// Property identity — one building, one record, one history.
// ----------------------------------------------------------------------------
// `properties` has been the durable physical identity since 0002, and docs/10
// builds the whole lifecycle on it. The data did not honour that: every call to
// createOpportunity inserted a FRESH property row, so the same building
// recurring in the pipeline produced unrelated records and the question the
// property table exists to answer — "have we seen this before, and at what?" —
// could only ever be answered "no".
//
// These tests assert the invariant rather than the CRUD: that a recurrence
// JOINS, that a near-miss does NOT, and that what was learned about a building
// outlives the campaign that learned it.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { adminQuery, withSession, type Session } from "@/lib/db/client";
import { createOpportunity } from "@/lib/data/opportunities";
import { resolveProperty } from "@/lib/data/properties";
import { listPropertyTimeline, recordEvent } from "@/lib/data/property-events";
import { orgIdByName, orgUserSession, profileIdByEmail } from "./helpers";

let meiji: string;
let analyst: string;
let session: Session;

beforeAll(async () => {
  meiji = await orgIdByName("Meiji Shipping");
  analyst = await profileIdByEmail("analyst@meiji.com");
  session = orgUserSession([meiji], analyst);
});

/** A postcode unique to each test, so suites cannot collide on identity keys. */
let n = 0;
const uniquePostcode = () => `W1S ${++n}AA`;

describe("One building resolves to one property", () => {
  it("gives three broker spellings of one address the same property", async () => {
    const pc = uniquePostcode();
    await withSession(session, async (tx) => {
      const a = await resolveProperty(tx, {
        orgId: meiji, name: "Conduit", address: `10 Conduit St, Mayfair, London ${pc}`,
      });
      const b = await resolveProperty(tx, {
        orgId: meiji, name: "Conduit", address: "10 Conduit Street, London", postcode: pc,
      });
      const c = await resolveProperty(tx, {
        orgId: meiji, name: "Conduit", address: `Unit 4, 10 Conduit Street ${pc}`,
      });
      expect(a.created).toBe(true);
      expect(b.created).toBe(false);
      expect(c.created).toBe(false);
      expect(b.propertyId).toBe(a.propertyId);
      expect(c.propertyId).toBe(a.propertyId);
    });
  });

  it("keeps the neighbouring building separate", async () => {
    const pc = uniquePostcode();
    await withSession(session, async (tx) => {
      const a = await resolveProperty(tx, { orgId: meiji, name: "N16", address: `16 Gresham Street ${pc}` });
      const b = await resolveProperty(tx, { orgId: meiji, name: "N22", address: `22 Gresham Street ${pc}` });
      expect(b.propertyId).not.toBe(a.propertyId);
    });
  });

  it("never auto-merges a property it cannot key", async () => {
    // A brochure title with no address identifies nothing. Merging on it would
    // fuse two buildings irreversibly; creating twice is a review task.
    await withSession(session, async (tx) => {
      const a = await resolveProperty(tx, { orgId: meiji, name: "Unnamed Mayfair Asset" });
      const b = await resolveProperty(tx, { orgId: meiji, name: "Unnamed Mayfair Asset" });
      expect(a.identityKey).toBeNull();
      expect(b.propertyId).not.toBe(a.propertyId);
    });
  });

  it("fills blanks on an existing property but never overwrites a recorded value", async () => {
    const pc = uniquePostcode();
    await withSession(session, async (tx) => {
      await resolveProperty(tx, {
        orgId: meiji, name: "Enrich", address: `1 Enrich Road ${pc}`, city: "London",
      });
      await resolveProperty(tx, {
        orgId: meiji, name: "Enrich", address: "1 Enrich Road", postcode: pc,
        city: "Westminster", submarket: "City",
      });
      const { rows } = await tx.query<{ city: string; submarket: string }>(
        "select city, submarket from properties where org_id = $1 and postcode = $2", [meiji, pc]);
      expect(rows).toHaveLength(1);
      expect(rows[0].city).toBe("London");      // recorded first, left alone
      expect(rows[0].submarket).toBe("City");   // was blank, filled
    });
  });

  it("isolates identity by organisation", async () => {
    // The same address in another org is another org's property, not a match.
    const pc = uniquePostcode();
    const aoyama = await orgIdByName("Aoyama Holdings");
    const aoyamaUser = await profileIdByEmail("user@aoyama.com");
    const mine = await withSession(session, (tx) =>
      resolveProperty(tx, { orgId: meiji, name: "Shared", address: `5 Shared Street ${pc}` }));
    const theirs = await withSession(orgUserSession([aoyama], aoyamaUser), (tx) =>
      resolveProperty(tx, { orgId: aoyama, name: "Shared", address: `5 Shared Street ${pc}` }));
    expect(theirs.propertyId).not.toBe(mine.propertyId);
    expect(theirs.created).toBe(true);
  });
});

describe("A recurrence joins the record it belongs to", () => {
  it("puts two campaigns on one property with one continuous timeline", async () => {
    const pc = uniquePostcode();
    const first = await createOpportunity(session, {
      orgId: meiji, name: "Recurring Asset", address: `30 Recurrence Row ${pc}`,
      targetPrice: 8_000_000, currency: "GBP", brokerName: "Knight Frank",
    });
    const second = await createOpportunity(session, {
      orgId: meiji, name: "Recurring Asset", address: "30 Recurrence Row", postcode: pc,
      targetPrice: 7_400_000, currency: "GBP", brokerName: "Savills",
    });
    expect(second).not.toBe(first);

    const props = await adminQuery<{ property_id: string }>(
      "select property_id from properties where org_id = $1 and postcode = $2", [meiji, pc]);
    expect(props).toHaveLength(1);

    const timeline = await listPropertyTimeline(session, props[0].property_id);
    // first_seen + price_quoted, for each of the two campaigns.
    expect(timeline).toHaveLength(4);
    expect(new Set(timeline.map((e) => e.opportunityId)).size).toBe(2);
    expect(timeline.filter((e) => e.eventType === "price_quoted")
      .map((e) => e.numericValue).sort((a, b) => (a ?? 0) - (b ?? 0)))
      .toEqual([7_400_000, 8_000_000]);
    // The second campaign knows it is not the first.
    expect(timeline.some((e) => e.headline.includes("seen before"))).toBe(true);
  });

  it("leaves the underwriting truth layer untouched", async () => {
    // Phase 1A owns money: origination economics open investment case v1 and are
    // projected onto the opportunity. Property identity must not disturb that.
    const pc = uniquePostcode();
    const id = await createOpportunity(session, {
      orgId: meiji, name: "Still Underwritten", address: `7 Case Street ${pc}`,
      targetPrice: 12_500_000, niy: 4.12, currency: "GBP",
    });
    const cases = await adminQuery<{ version: number; acquisition_price: string; created_by: string }>(
      "select version, acquisition_price, created_by from investment_cases where opportunity_id = $1", [id]);
    expect(cases).toHaveLength(1);
    expect(cases[0].version).toBe(1);
    expect(Number(cases[0].acquisition_price)).toBe(12_500_000);
    expect(cases[0].created_by).toBe(analyst);
  });
});

describe("The record outlives the campaign", () => {
  it("keeps property events when the opportunity is deleted", async () => {
    const pc = uniquePostcode();
    const id = await createOpportunity(session, {
      orgId: meiji, name: "Doomed Campaign", address: `9 Outlive Lane ${pc}`,
      targetPrice: 5_000_000, currency: "GBP",
    });
    const props = await adminQuery<{ property_id: string }>(
      "select property_id from properties where org_id = $1 and postcode = $2", [meiji, pc]);
    const propertyId = props[0].property_id;

    expect(await listPropertyTimeline(session, propertyId)).toHaveLength(2);
    await adminQuery("delete from opportunities where opportunity_id = $1", [id]);

    const after = await listPropertyTimeline(session, propertyId);
    expect(after).toHaveLength(2);                                  // nothing erased
    expect(after.every((e) => e.opportunityId === null)).toBe(true); // detached cleanly
  });

  it("refuses an event attributed to neither a person nor a source", async () => {
    const pc = uniquePostcode();
    const property = await withSession(session, (tx) =>
      resolveProperty(tx, { orgId: meiji, name: "Attribution", address: `2 Attribution Way ${pc}` }));
    await expect(
      withSession(session, (tx) => recordEvent(tx, {
        orgId: meiji, propertyId: property.propertyId,
        eventType: "note", headline: "who said this?",
      })),
    ).rejects.toThrow(/author or a source/i);
  });

  it("grants no DELETE on the timeline, so it cannot be quietly rewritten", async () => {
    const grants = await adminQuery<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where grantee = 'authenticated' and table_name = 'property_events'`);
    const held = grants.map((g) => g.privilege_type);
    expect(held).toEqual(expect.arrayContaining(["SELECT", "INSERT", "UPDATE"]));
    expect(held).not.toContain("DELETE");
  });

  it("gives anon no privilege on the timeline at all", async () => {
    const grants = await adminQuery<{ n: string }>(
      `select count(*) n from information_schema.role_table_grants
        where grantee = 'anon' and table_name = 'property_events'`);
    expect(Number(grants[0].n)).toBe(0);
  });
});
