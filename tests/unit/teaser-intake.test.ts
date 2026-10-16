// Teaser intake: a reviewed reading becomes a seed record the existing parser accepts or refuses,
// files are judged by their bytes, and an intake path is only ever its owner's.
import { describe, it, expect } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { parseDealSeed, SQFT_PER_SQM } from "@/lib/ingestion/deal-seed";
import {
  TeaserExtractionSchema, toSeedRecord, intakeReference, sourcingLine, emptyExtraction, REVIEW_FIELDS, type TeaserExtraction,
} from "@/lib/teaser-intake/schema";
import { isIntakePathFor, sniffIntakeType, declaredIntakeType, intakeFolder } from "@/lib/teaser-intake/files";

const USER = "2b1f0c7e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
const OTHER = "9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7e6f";
const FILE = "0f9e8d7c-6b5a-4f3e-9d2c-1b0a9f8e7d6c";

function reading(patch: (x: TeaserExtraction) => void = () => undefined): TeaserExtraction {
  const x = emptyExtraction();
  x.document = { is_property_investment_material: true, kind: "teaser", note: null };
  x.opportunity = {
    ...x.opportunity, name: "Herenhuis Kade", address: "Kade 12, 1017 AB Amsterdam", market: "Amsterdam",
    country: "Netherlands", asset_type: "office", deal_stage: "guided", broker_name: "Cushman & Wakefield",
    source_contact_name: "A. de Vries", off_market: false,
  };
  x.asset_snapshot = { ...x.asset_snapshot, size_sq_m: 1000, tenure: "freehold", passing_rent_pa: 450000, epc_rating: "A" };
  x.deal_terms = { ...x.deal_terms, currency: "EUR", guide_price: 9500000, niy_percent: 4.4, price_basis: "Vraagprijs" };
  x.tenants = [{ name: "Studio B.V.", area_sq_ft: null, rent_pa: 450000, lease_expiry: "2031-06-30", break_option: null }];
  x.highlights = ["Canal-side, fully let"];
  x.other_facts = [{ label: "VAT", value: "Opted" }];
  x.evidence = [{ field: "deal_terms.guide_price", page: 2, quote: "Vraagprijs EUR 9.500.000 k.k." }];
  x.data_completeness = "No rent roll or technical report.";
  patch(x);
  return TeaserExtractionSchema.parse(x);
}

const parse = (x: TeaserExtraction) => parseDealSeed({ deals: [toSeedRecord(x, { fileName: "kade.pdf", model: "m" })] })[0];

describe("a reviewed reading becomes a seed deal", () => {
  it("maps a EUR teaser without converting the money, and keeps the currency", () => {
    const d = parse(reading());
    expect(d.money).toEqual({ currency: "EUR", guidePrice: 9500000, niyPct: 4.4, passingRent: 450000 });
    expect(d.assetType).toBe("office");
    expect(d.property.tenure).toBe("freehold");
    expect(d.dealStage).toBe("guided");
    expect(d.sourceType).toBe("broker_marketed");
  });

  it("converts sq m only when no sq ft is stated, and says so; a stated sq ft wins", () => {
    const d = parse(reading());
    expect(d.sizeSqft).toBe(Math.round(1000 * SQFT_PER_SQM));
    expect(d.flags.map((f) => f.code)).toContain("size_converted_from_sq_m");
    expect((d.sourceFacts.asset_snapshot as Record<string, unknown>).size_sq_m).toBe(1000);
    const both = parse(reading((x) => { x.asset_snapshot.size_sq_ft = 10500; }));
    expect(both.sizeSqft).toBe(10500);
    expect(both.flags.map((f) => f.code)).not.toContain("size_converted_from_sq_m");
  });

  it("takes the broker and contact as stated, and writes a readable source line", () => {
    const d = parse(reading());
    expect(d.brokerName).toBe("Cushman & Wakefield");
    expect(d.sourceContactName).toBe("A. de Vries");
    expect(d.sourcing).toBe("Broker IM, Cushman & Wakefield (A. de Vries)");
    expect(d.flags.map((f) => f.code)).not.toContain("broker_not_parsed");
    expect(sourcingLine(null, null, "x.pdf")).toBe("Teaser upload (x.pdf)");
    expect(sourcingLine("Savills", null, "x.pdf")).toBe("Broker IM, Savills");
  });

  it("NULL STAYS NULL: nothing the teaser did not say is filled", () => {
    const d = parse(reading());
    expect(d.property.unexpiredTermYears).toBeNull();
    expect(d.property.waultToExpiryYears).toBeNull();
    expect(d.property.covenantRating).toBeNull();
  });

  it("keeps what has no column (tenants, highlights, evidence, the file and model) as source facts, without nulls", () => {
    const d = parse(reading());
    expect(d.sourceFacts.tenants).toEqual([{ name: "Studio B.V.", rent_pa: 450000, lease_expiry: "2031-06-30" }]);
    expect(d.sourceFacts.highlights).toEqual(["Canal-side, fully let"]);
    expect(d.sourceFacts.other_facts).toEqual([{ label: "VAT", value: "Opted" }]);
    const intake = d.sourceFacts.teaser_intake as Record<string, unknown>;
    expect(intake.file_name).toBe("kade.pdf");
    expect(intake.model).toBe("m");
    expect(intake.evidence).toHaveLength(1);
    const snap = d.sourceFacts.asset_snapshot as Record<string, unknown>;
    expect(Object.values(snap).every((v) => v !== null)).toBe(true);
  });

  it("is refused by the same parser rules: no name, no address, unknown words", () => {
    expect(() => parse(reading((x) => { x.opportunity.address = null; }))).toThrow(/address is required/);
    expect(() => parse(reading((x) => { x.opportunity.name = "  "; }))).toThrow(/name is required/);
    expect(() => parse(reading((x) => { x.opportunity.asset_type = null; }))).toThrow(/asset_type is required/);
  });

  it("an explicit 'other' asset type is accepted; an unknown word is still refused", () => {
    expect(parse(reading((x) => { x.opportunity.asset_type = "other"; })).assetType).toBe("other");
    const rec = toSeedRecord(reading(), { fileName: null, model: null });
    (rec.opportunity as Record<string, unknown>).asset_type = "castle";
    expect(() => parseDealSeed({ deals: [rec] })).toThrow(/is not one this loader knows/);
  });

  it("still refuses GBP-named money in another currency", () => {
    const rec = toSeedRecord(reading(), { fileName: null, model: null });
    (rec.deal_terms as Record<string, unknown>).guide_price_gbp = 1;
    expect(() => parseDealSeed({ deals: [rec] })).toThrow(/refusing to guess a conversion/);
  });

  it("refuses a currency outside the list", () => {
    const rec = toSeedRecord(reading(), { fileName: null, model: null });
    (rec.deal_terms as Record<string, unknown>).currency = "CHF";
    expect(() => parseDealSeed({ deals: [rec] })).toThrow(/must be one of GBP, EUR, USD, JPY/);
  });

  it("an intake reference is stable, prefixed apart from the command-line seed", () => {
    expect(intakeReference("25 Watling Street & 10 Bow Lane")).toBe("IM-25-WATLING-STREET-AND-10-BOW-LANE");
    expect(intakeReference("x".repeat(400)).length).toBeLessThanOrEqual(120);
  });
});

describe("the schema the model answers in", () => {
  it("is accepted as a structured-output format", () => {
    expect(() => zodOutputFormat(TeaserExtractionSchema)).not.toThrow();
  });
  it("refuses a reading with an unknown tenure or currency (a tampered review cannot widen it)", () => {
    const bad = { ...reading(), deal_terms: { ...reading().deal_terms, currency: "BTC" } };
    expect(TeaserExtractionSchema.safeParse(bad).success).toBe(false);
  });
  it("every review field exists in the schema", () => {
    const x = emptyExtraction() as unknown as Record<string, Record<string, unknown>>;
    for (const f of REVIEW_FIELDS) expect(f.key in x[f.section], `${f.section}.${f.key}`).toBe(true);
  });
});

describe("files", () => {
  it("are judged by their signature, not their name", () => {
    expect(sniffIntakeType(new TextEncoder().encode("%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffIntakeType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffIntakeType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffIntakeType(new TextEncoder().encode("<html>"))).toBeNull();
    expect(sniffIntakeType(new Uint8Array())).toBeNull();
  });
  it("a declared type is normalised, and a typeless PDF is recognised by its extension only", () => {
    expect(declaredIntakeType("a.pdf", "application/pdf")).toBe("application/pdf");
    expect(declaredIntakeType("a.pdf", "")).toBe("application/pdf");
    expect(declaredIntakeType("a.JPG", "application/octet-stream")).toBe("image/jpeg");
    expect(declaredIntakeType("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBeNull();
    expect(declaredIntakeType("a.pdf", "text/html")).toBeNull();
  });
  it("an intake path belongs to exactly one person and one folder", () => {
    const mine = `${intakeFolder(USER)}/${FILE}.pdf`;
    expect(isIntakePathFor(USER, mine)).toBe(true);
    expect(isIntakePathFor(OTHER, mine)).toBe(false);
    expect(isIntakePathFor(USER, `opportunities/${USER}/${FILE}.pdf`)).toBe(false);
    expect(isIntakePathFor(USER, `intake/${USER}/../${OTHER}/${FILE}.pdf`)).toBe(false);
    expect(isIntakePathFor(USER, `intake/${USER}/${FILE}.exe`)).toBe(false);
    expect(isIntakePathFor(USER, `intake/${USER}/${FILE}.pdf/x`)).toBe(false);
    expect(isIntakePathFor("not-a-uuid", `intake/not-a-uuid/${FILE}.pdf`)).toBe(false);
    expect(isIntakePathFor(USER, 42)).toBe(false);
  });
});
