// ============================================================================
// End-to-end over a real, deliberately messy spreadsheet.
// parse -> detect headers -> suggest mappings -> extract rows -> match.
// No database: this is the whole import pipeline up to the point a human
// approves it.
// ============================================================================
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSpreadsheet, type Sheet } from "@/lib/ingestion/spreadsheet";
import { suggestMappings, summariseMappings, type ColumnMapping } from "@/lib/ingestion/mapping";
import { extractRow, type ExtractedRow } from "@/lib/ingestion/rows";
import { disposition, type MatchTarget } from "@/lib/ingestion/match";
import { propertyIdentityKey } from "@/lib/ingestion/normalise";

const FIXTURES = join(process.cwd(), "tests", "fixtures");

describe.each([
  ["xlsx", "messy-broker-list.xlsx"],
  ["csv", "messy-broker-list.csv"],
])("import pipeline over a messy %s", (_kind, fileName) => {
  let sheet: Sheet;
  let mappings: ColumnMapping[];
  let rows: ExtractedRow[];

  beforeAll(async () => {
    const buffer = readFileSync(join(FIXTURES, fileName));
    const parsed = await parseSpreadsheet(buffer, fileName);
    sheet = parsed.sheets[0];
    mappings = suggestMappings(sheet.headers);
    rows = sheet.rows.map((r) => extractRow(r, mappings, { defaultCurrency: "GBP" }));
  });

  it("finds the header row beneath the title block", () => {
    expect(sheet.headers.slice(0, 4)).toEqual(["Property", "Address", "Guide Price", "Passing Rent"]);
    expect(sheet.skippedLeadingRows).toBe(3);
  });

  it("maps the columns it recognises", () => {
    const byHeader = Object.fromEntries(mappings.map((m) => [m.header, m.field]));
    expect(byHeader["Guide Price"]).toBe("asking_price");
    expect(byHeader["Passing Rent"]).toBe("passing_income");
    expect(byHeader["Cap Rate"]).toBe("niy");
    expect(byHeader["Broker"]).toBe("broker");
  });

  it("flags cap rate for confirmation rather than applying it silently", () => {
    const capRate = mappings.find((m) => m.header === "Cap Rate")!;
    expect(capRate.method).toBe("ambiguous");
    expect(capRate.reason).toMatch(/confirm/i);
  });

  it("keeps the columns it does not recognise", () => {
    const summary = summariseMappings(mappings);
    expect(summary.unmappedHeaders).toEqual(
      expect.arrayContaining(["EPC Band", "Vendor Solicitor"]));
    expect(rows[0].raw["EPC Band"]).toBe("C");
    expect(rows[0].raw["Vendor Solicitor"]).toBe("Slaughter & May");
  });

  it("drops blank spacer rows but keeps every real one", () => {
    // 8 rows below the header, one of them blank and therefore dropped.
    expect(rows).toHaveLength(7);
  });

  it("reads UK money and yields", () => {
    expect(rows[0].values.asking_price?.value).toBe(12_500_000);
    expect(rows[0].values.passing_income?.value).toBe(540_000);
    expect(rows[0].values.niy?.value).toBe(4.12);
    expect(rows[0].values.currency?.value).toBe("GBP");
  });

  it("reads European separators and the second currency", () => {
    const magna = rows.find((r) => String(r.values.property_name?.value).includes("Magna"))!;
    expect(magna.values.asking_price?.value).toBe(85_000_000);
    expect(magna.values.passing_income?.value).toBe(3_400_000);
    expect(magna.values.niy?.value).toBe(4.0);
    expect(magna.values.currency?.value).toBe("EUR");
  });

  it("treats POA and N/A as absent, never as zero", () => {
    const herengracht = rows.find((r) => String(r.values.property_name?.value).includes("Herengracht"))!;
    expect(herengracht.values.asking_price).toBeUndefined();
    expect(herengracht.values.passing_income).toBeUndefined();
    expect(herengracht.missingFields).toContain("asking_price");
  });

  it("flags a hedged price without discarding the figure", () => {
    const hedged = rows[1];
    expect(hedged.values.asking_price?.value).toBe(12_400_000);
    expect(hedged.issues.map((i) => i.code)).toContain("approximate_value");
  });

  it("sends a row with no address to review rather than matching it", () => {
    const noAddress = rows.find((r) => String(r.values.property_name?.value).includes("Mayfair Asset"))!;
    expect(noAddress.identityKey).toBeNull();
    expect(noAddress.issues.map((i) => i.code)).toContain("no_identity_key");
  });

  it("keys a listing that states no postcode differently, and says so", () => {
    // Row 1 carries no postcode anywhere, so it can only be keyed on its
    // address. The keys DIFFER by design - the key is deterministic, and
    // inventing a postcode to make them agree is exactly what must not happen.
    // Linking the two is the matcher's job, asserted below.
    expect(rows[0].identityKey).toMatch(/^pc:/);
    expect(rows[1].identityKey).toMatch(/^ad:/);
  });

  it("still recognises that postcode-less listing as the same building", () => {
    const d = disposition(
      {
        address: String(rows[1].values.address?.value),
        name: String(rows[1].values.property_name?.value),
      },
      [{
        propertyId: "p1",
        name: String(rows[0].values.property_name?.value),
        address: String(rows[0].values.address?.value),
        postcode: String(rows[0].values.postcode?.value ?? ""),
      }]);
    // Strong enough to surface as a candidate, never strong enough to merge
    // itself: this is precisely what the review queue exists for.
    expect(d.action).toBe("review");
  });

  it("keeps two different buildings on one street apart", () => {
    const twentyTwo = rows.find((r) => String(r.values.property_name?.value).startsWith("22"))!;
    expect(twentyTwo.identityKey).not.toBe(rows[0].identityKey);
  });
});

describe("matching an import against what is already held", () => {
  const existing: MatchTarget[] = [{
    propertyId: "p-conduit",
    opportunityId: "o-conduit",
    name: "16 Conduit Street",
    address: "16 Conduit Street, London",
    postcode: "W1S 2XJ",
    broker: "Knight Frank",
    price: 12_500_000,
    identityKey: propertyIdentityKey({ address: "16 Conduit Street, London", postcode: "W1S 2XJ" }),
    label: "16 Conduit Street",
  }];

  it("attaches a re-sent deal to the property already held", () => {
    const d = disposition({
      address: "16 Conduit St, Mayfair, London W1S 2XJ",
      name: "16 Conduit Street", broker: "CBRE", price: 12_400_000,
    }, existing);
    expect(d.action).toBe("attach");
  });

  it("creates a new opportunity for a genuinely different building", () => {
    const d = disposition({
      address: "Nieuwezijds Voorburgwal 182, 1012 SJ Amsterdam",
      name: "Magna Plaza", broker: "CBRE", price: 85_000_000,
    }, existing);
    expect(d.action).toBe("create");
  });

  it("routes the neighbouring building to review rather than silently merging", () => {
    const d = disposition({
      address: "22 Conduit Street, London W1S 2XJ",
      name: "22 Conduit Street", broker: "CBRE", price: 18_500_000,
    }, existing);
    expect(d.action).not.toBe("attach");
  });
});
