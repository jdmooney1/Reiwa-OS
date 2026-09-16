import { describe, it, expect } from "vitest";
import { suggestMappings } from "@/lib/ingestion/mapping";
import { extractRow, toExtractedPayload } from "@/lib/ingestion/rows";

const HEADERS = ["Property", "Address", "Postcode", "Broker", "Guide Price", "Passing Rent", "Yield", "Notes"];
const MAP = suggestMappings(HEADERS);

const row = (cells: unknown[], opts = {}) => extractRow(cells, MAP, { defaultCurrency: "GBP", ...opts });

describe("extractRow - the happy path", () => {
  const r = row(["16 Conduit Street", "16 Conduit St, Mayfair, London", "W1S 2XJ",
                 "Knight Frank", "£12,500,000", "£540,000", "4.12%", "Prime Mayfair block"]);

  it("types every mapped value", () => {
    expect(r.values.asking_price?.value).toBe(12_500_000);
    expect(r.values.passing_income?.value).toBe(540_000);
    expect(r.values.niy?.value).toBe(4.12);
    expect(r.values.broker?.value).toBe("Knight Frank");
  });

  it("normalises the postcode for comparison", () => {
    expect(r.values.postcode?.value).toBe("W1S 2XJ");
  });

  it("produces an identity key that matches another spelling of the same building", () => {
    const other = row(["16 Conduit Street", "16 Conduit Street, London W1S 2XJ", "",
                       "CBRE", "£12.4m", "£540,000", "4.1%", ""]);
    expect(r.identityKey).not.toBeNull();
    expect(r.identityKey).toBe(other.identityKey);
  });

  it("carries the source cell on every value, for provenance", () => {
    expect(r.values.asking_price?.sourceHeader).toBe("Guide Price");
    expect(r.values.asking_price?.excerpt).toBe("£12,500,000");
  });

  it("reports an overall confidence", () => {
    expect(r.confidenceOverall).toBeGreaterThan(0.8);
  });
});

describe("extractRow - nothing is discarded", () => {
  it("keeps every column verbatim, mapped or not", () => {
    const headers = ["Property", "Price", "EPC Band", "Vendor Solicitor"];
    const r = extractRow(["16 Conduit Street", "£12.5m", "C", "Slaughter & May"],
      suggestMappings(headers), { defaultCurrency: "GBP" });
    expect(r.raw["EPC Band"]).toBe("C");
    expect(r.raw["Vendor Solicitor"]).toBe("Slaughter & May");
    expect(r.unmappedHeaders).toEqual(["EPC Band", "Vendor Solicitor"]);
  });

  it("keeps duplicate headers as distinct entries", () => {
    const headers = ["Price", "Price"];
    const r = extractRow(["£1m", "£2m"], suggestMappings(headers), { defaultCurrency: "GBP" });
    expect(Object.keys(r.raw)).toHaveLength(2);
  });
});

describe("extractRow - malformed rows", () => {
  it("flags a blank row as empty rather than importing a shell", () => {
    const r = row(["", "", "", "", "", "", "", ""]);
    expect(r.isEmpty).toBe(true);
    expect(r.identityKey).toBeNull();
  });

  it("treats broker non-answers as absent, not zero", () => {
    const r = row(["16 Conduit Street", "16 Conduit St", "W1S 2XJ", "Knight Frank",
                   "POA", "N/A", "-", ""]);
    expect(r.values.asking_price).toBeUndefined();
    expect(r.values.passing_income).toBeUndefined();
    expect(r.missingFields).toContain("asking_price");
  });

  it("reports a row with no usable address for review instead of matching it", () => {
    const r = row(["Mayfair Asset", "", "", "CBRE", "£8m", "", "", ""]);
    expect(r.identityKey).toBeNull();
    expect(r.issues.map((i) => i.code)).toContain("no_identity_key");
  });

  it("tolerates a short row", () => {
    const r = row(["16 Conduit Street", "16 Conduit St", "W1S 2XJ"]);
    expect(r.isEmpty).toBe(false);
    expect(r.values.property_name?.value).toBe("16 Conduit Street");
  });

  it("flags an unrecognisable postcode without dropping it", () => {
    const r = row(["X", "1 Some Road", "NOT A POSTCODE", "CBRE", "£1m", "", "", ""]);
    expect(r.issues.map((i) => i.code)).toContain("unrecognised_postcode");
  });
});

describe("extractRow - currency", () => {
  it("prefers a currency the row states over the batch default", () => {
    const r = row(["Magna Plaza", "Nieuwezijds 182", "1012 SJ", "CBRE",
                   "€85,000,000", "€3,400,000", "4.0%", ""]);
    expect(r.values.currency?.value).toBe("EUR");
  });

  it("applies the batch default and records it as an assumption", () => {
    const r = row(["16 Conduit Street", "16 Conduit St", "W1S 2XJ", "KF", "12,500,000", "540,000", "4.12%", ""]);
    expect(r.values.currency?.value).toBe("GBP");
    expect(r.values.currency?.notes).toContain("batch_default_applied");
    expect(r.values.currency?.confidence).toBeLessThan(1);
  });

  it("blocks a row that mixes currencies", () => {
    const r = row(["X", "1 Some Road", "W1S 2XJ", "KF", "£12,500,000", "€540,000", "4.12%", ""]);
    const mixed = r.issues.find((i) => i.code === "mixed_currencies");
    expect(mixed?.severity).toBe("error");
  });

  it("blocks money with no currency and no default", () => {
    const r = extractRow(["X", "1 Some Road", "W1S 2XJ", "KF", "12,500,000", "", "", ""], MAP, {});
    const issue = r.issues.find((i) => i.code === "currency_unknown");
    expect(issue?.severity).toBe("error");
  });
});

describe("extractRow - confidence reflects real doubt", () => {
  it("caps confidence when the column mapping was only a guess", () => {
    const confirmed = suggestMappings(["Guide Price"]);
    const guessed = suggestMappings(["Cap Rate"]);
    const a = extractRow(["£12,500,000"], confirmed, { defaultCurrency: "GBP" });
    const b = extractRow(["4.12%"], guessed, { defaultCurrency: "GBP" });
    expect(a.values.asking_price?.confidence).toBe(1);
    expect(b.values.niy?.confidence).toBeLessThan(0.7);
    expect(b.values.niy?.notes.some((n) => n.startsWith("unconfirmed_mapping"))).toBe(true);
  });

  it("flags a bare decimal yield rather than converting it", () => {
    const r = row(["X", "1 Some Road", "W1S 2XJ", "KF", "£1m", "", "0.0412", ""]);
    expect(r.values.niy?.value).toBe(0.0412);
    expect(r.values.niy?.notes).toContain("possible_fraction_not_percent");
  });

  it("flags an approximate price without discarding it", () => {
    const r = row(["X", "1 Some Road", "W1S 2XJ", "KF", "c. £8.0m", "", "", ""]);
    expect(r.values.asking_price?.value).toBe(8_000_000);
    expect(r.issues.map((i) => i.code)).toContain("approximate_value");
  });
});

describe("extractRow - areas", () => {
  const headers = ["Property", "Address", "Postcode", "Floor Area"];
  const map = suggestMappings(headers);

  it("derives the sibling unit and marks it as derived", () => {
    const r = extractRow(["X", "1 Some Road", "W1S 2XJ", "24,500 sq ft"], map, { defaultCurrency: "GBP" });
    expect(r.values.floor_area_sqft?.value).toBe(24_500);
    expect(r.values.floor_area_sqm?.notes).toContain("derived_by_conversion");
    expect(r.values.floor_area_sqm?.confidence).toBeLessThan(
      r.values.floor_area_sqft?.confidence ?? 1);
  });

  it("warns when the area column states no unit", () => {
    const r = extractRow(["X", "1 Some Road", "W1S 2XJ", "24500"], map, { defaultCurrency: "GBP" });
    expect(r.issues.map((i) => i.code)).toContain("area_unit_assumed");
  });
});

describe("toExtractedPayload", () => {
  it("reduces values to JSON that keeps confidence and provenance", () => {
    const r = row(["16 Conduit Street", "16 Conduit St", "W1S 2XJ", "KF", "£12.5m", "", "", ""]);
    const payload = toExtractedPayload(r) as Record<string, any>;
    expect(payload.asking_price.value).toBe(12_500_000);
    expect(payload.asking_price.source_header).toBe("Guide Price");
    expect(payload.asking_price).toHaveProperty("confidence");
    expect(payload.asking_price).toHaveProperty("excerpt");
  });
});
