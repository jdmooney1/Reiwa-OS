// Teaser intake: a reviewed reading becomes a seed record the existing parser accepts or refuses,
// files are judged by their bytes, and an intake path is only ever its owner's.
import { describe, it, expect } from "vitest";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { parseDealSeed, SQFT_PER_SQM } from "@/lib/ingestion/deal-seed";
import {
  TeaserExtractionSchema, toSeedRecord, intakeReference, uploadIdOf, sourcingLine, emptyExtraction, REVIEW_FIELDS,
  rangeProblems, normaliseReading, type TeaserExtraction,
} from "@/lib/teaser-intake/schema";
import { teaserUnderwriting, rentRollFrom, isoDate, hasUnderwriting, remainingInputs } from "@/lib/teaser-intake/underwriting";
import { isIntakePathFor, sniffIntakeType, declaredIntakeType, intakeFolder, maxBytesFor, MAX_INTAKE_IMAGE_BYTES } from "@/lib/teaser-intake/files";

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
  x.tenants = [{ name: "Studio B.V.", unit: null, use: null, area_sq_ft: null, area_sq_m: null, rent_pa: 450000, erv_pa: null, lease_expiry: "2031-06-30", break_option: null }];
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

  it("an intake reference is unique per upload, prefixed apart from the command-line seed, never empty", () => {
    expect(intakeReference("25 Watling Street & 10 Bow Lane", FILE)).toBe("IM-25-WATLING-STREET-AND-10-BOW-LANE-0F9E8D7C");
    expect(intakeReference("25 Watling Street & 10 Bow Lane", USER)).not.toBe(intakeReference("25 Watling Street & 10 Bow Lane", FILE));
    expect(intakeReference("令和ビル", FILE)).toBe("IM-0F9E8D7C");
    expect(intakeReference("x".repeat(400), FILE).length).toBeLessThanOrEqual(100);
    expect(uploadIdOf(`intake/${USER}/${FILE}.pdf`)).toBe(FILE);
    expect(uploadIdOf("nothing")).toBe("");
  });

  it("ground rent in words reaches the parser's own key, so a peppercorn lands on its column", () => {
    const d = parse(reading((x) => { x.asset_snapshot.ground_rent_note = "Peppercorn"; }));
    expect(d.property.groundRentNote).toBe("Peppercorn");
    expect(d.property.groundRentPa).toBeNull();
  });

  it("text longer than its column is shortened for the column and kept whole in source facts", () => {
    const long = "Bank, Monument and Liverpool Street stations within a short walk. ".repeat(12);
    const d = parse(reading((x) => { x.asset_snapshot.transport_connectivity = long; x.asset_snapshot.epc_rating = "B, expected A after the 2031 refurbishment programme completes"; }));
    expect(d.property.transportConnectivity!.length).toBeLessThanOrEqual(500);
    expect(d.property.epcRating!.length).toBeLessThanOrEqual(50);
    const full = (d.sourceFacts.teaser_intake as Record<string, Record<string, string>>).full_text;
    expect(full.transport_connectivity).toBe(long.trim());
    expect(full.epc_rating).toMatch(/^B, expected A/);
  });

  it("a figure no column could hold is a problem to fix, named as the form names it", () => {
    expect(rangeProblems(reading())).toEqual([]);
    const p = rangeProblems(reading((x) => { x.deal_terms.niy_percent = 475; x.asset_snapshot.wault_to_expiry_years = 2031; }));
    expect(p).toHaveLength(2);
    expect(p[0]).toMatch(/^NIY \(%\) of 475/);
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

describe("a model's answer is brought onto the schema, never guessed into another meaning", () => {
  const answer = (patch: Record<string, unknown>) => ({ ...JSON.parse(JSON.stringify(reading())), ...patch });
  it("normalises the vocabulary the format only suggests", () => {
    const a = answer({});
    a.opportunity.asset_type = "Mixed-Use"; a.asset_snapshot.tenure = "Long Leasehold"; a.opportunity.deal_stage = "Under Offer";
    a.deal_terms.currency = "€"; a.deal_terms.guide_price = "9,500,000"; a.deal_terms.niy_percent = "4.40%";
    const x = normaliseReading(a)!;
    expect(x.opportunity.asset_type).toBe("mixed use");
    expect(x.asset_snapshot.tenure).toBe("long leasehold");
    expect(x.opportunity.deal_stage).toBe("under_offer");
    expect(x.deal_terms.currency).toBe("EUR");
    expect(x.deal_terms.guide_price).toBe(9500000);
    expect(x.deal_terms.niy_percent).toBe(4.4);
  });
  it("turns what it cannot read unambiguously into null, and keeps the rest", () => {
    const a = answer({});
    a.asset_snapshot.tenure = "leasehold"; a.opportunity.asset_type = "castle"; a.deal_terms.currency = "CHF";
    a.deal_terms.guide_price = "OIEO 12.5m"; a.asset_snapshot.size_sq_ft = -3;
    const x = normaliseReading(a)!;
    expect([x.asset_snapshot.tenure, x.opportunity.asset_type, x.deal_terms.currency, x.deal_terms.guide_price, x.asset_snapshot.size_sq_ft])
      .toEqual([null, null, null, null, null]);
    expect(x.opportunity.name).toBe("Herenhuis Kade");
  });
  it("fills missing sections and drops malformed list rows rather than failing the reading", () => {
    const x = normaliseReading({ opportunity: { name: "A" }, tenants: [{ rent_pa: 1 }, { name: "T", rent_pa: "100" }], evidence: [{ field: "x" }] })!;
    expect(x.opportunity.name).toBe("A");
    expect(x.deal_terms.guide_price).toBeNull();
    expect(x.tenants).toEqual([{ name: "T", unit: null, use: null, area_sq_ft: null, area_sq_m: null, rent_pa: 100, erv_pa: null, lease_expiry: null, break_option: null }]);
    expect(x.evidence).toEqual([]);
    expect(x.document.kind).toBe("other");
  });
  it("cannot read something that is not an object", () => {
    expect(normaliseReading(null)).toBeNull();
    expect(normaliseReading("text")).toBeNull();
  });
});

describe("the seed parser still reads what it read before", () => {
  const base = () => toSeedRecord(reading(), { fileName: null, model: null }) as Record<string, Record<string, unknown>>;
  it("plain-key money that is text stays a source fact, as before", () => {
    const r = base(); r.deal_terms.guide_price = "OIEO 12.5m";
    const [d] = parseDealSeed({ deals: [r] });
    expect(d.money.guidePrice).toBeNull();
    expect((d.sourceFacts.deal_terms as Record<string, unknown>).guide_price).toBe("OIEO 12.5m");
  });
  it("plain-key money as a number needs a stated currency: GBP is never assumed", () => {
    const r = base(); delete r.deal_terms.currency;
    expect(() => parseDealSeed({ deals: [r] })).toThrow(/currency is required/);
  });
  it("an unknown currency with no money in the record is left alone, as before", () => {
    const r = base(); r.deal_terms = { currency: "CHF" }; delete r.asset_snapshot.passing_rent_pa;
    expect(() => parseDealSeed({ deals: [r] })).not.toThrow();
  });
  it("a stated contact keeps the broker parsed from the source line", () => {
    const r = base(); delete r.opportunity.broker_name; r.opportunity.sourcing = "Broker email, Knight Frank (Jake Withers)"; r.opportunity.source_contact_name = "Someone Else";
    const [d] = parseDealSeed({ deals: [r] });
    expect(d.brokerName).toBe("Knight Frank");
    expect(d.sourceContactName).toBe("Someone Else");
  });
  it("a broker or size key that is not usable stays a source fact rather than refusing the record", () => {
    const r = base(); r.opportunity.broker_name = 42; r.asset_snapshot.size_sq_m = "c. 1,000";
    const [d] = parseDealSeed({ deals: [r] });
    expect((d.sourceFacts.opportunity as Record<string, unknown>).broker_name).toBe(42);
    expect(d.sizeSqft).toBeNull();
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
  it("an image has a lower ceiling than a PDF (the reader's own limit)", () => {
    expect(maxBytesFor("image/png")).toBe(MAX_INTAKE_IMAGE_BYTES);
    expect(maxBytesFor("application/pdf")).toBeGreaterThan(MAX_INTAKE_IMAGE_BYTES);
    expect(MAX_INTAKE_IMAGE_BYTES * 4 / 3).toBeLessThan(5 * 1024 * 1024);
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

describe("the teaser becomes underwriting v1: stated figures, the tenancy, and nothing decided", () => {
  const tenant = (t: Partial<TeaserExtraction["tenants"][number]>) => ({
    name: "Tenant", unit: null, use: null, area_sq_ft: null, area_sq_m: null, rent_pa: null, erv_pa: null,
    lease_expiry: null, break_option: null, ...t,
  });
  it("carries the stated figures and nothing else", () => {
    const u = teaserUnderwriting(reading((x) => { x.asset_snapshot.erv_pa = 480000; x.asset_snapshot.occupancy_percent = 100; }), { fileName: "kade.pdf" });
    expect(u.fields).toEqual({ acquisition_price: 9500000, entry_yield_pct: 4.4, gross_rental_income: 450000, erv: 480000, occupancy_pct: 100 });
    expect(u.assumptions.source).toBe("teaser_intake");
    expect(u.assumptions.teaserFile).toBe("kade.pdf");
    expect(u.assumptions.priceBasis).toBe("Vraagprijs");
    expect(hasUnderwriting(u)).toBe(true);
  });
  it("builds a rent roll only when every line has an area and a rent; a vacant unit is a zero rent", () => {
    const full = reading((x) => {
      x.tenants = [
        tenant({ name: "Studio B.V.", unit: "Ground", use: "office", area_sq_m: 500, rent_pa: 300000, lease_expiry: "30/06/2031", erv_pa: 310000 }),
        tenant({ name: "Vacant", unit: "First", area_sq_ft: 5000 }),
      ];
    });
    const rr = rentRollFrom(full)!;
    expect(rr).toHaveLength(2);
    expect(rr[0]).toMatchObject({ unit: "Ground", tenant: "Studio B.V.", use: "office", areaSqft: Math.round(500 * 10.7639), rentPa: 300000, expiry: "2031-06-30", ervPa: 310000 });
    expect(rr[1]).toMatchObject({ unit: "First", tenant: null, use: "office", rentPa: 0, expiry: null });
    const partial = reading((x) => { x.tenants = [tenant({ name: "A", area_sq_ft: 1000, rent_pa: 1 }), tenant({ name: "B", rent_pa: 2 })]; });
    expect(rentRollFrom(partial)).toBeNull();
    const u = teaserUnderwriting(partial, { fileName: null });
    expect(u.assumptions.rentRoll).toBeUndefined();
    expect(u.assumptions.teaserTenancy).toHaveLength(2);
  });
  it("an ERV is the stated one, else a schedule that gives one for every line, else nothing", () => {
    expect(teaserUnderwriting(reading((x) => { x.tenants = [tenant({ erv_pa: 1 }), tenant({ erv_pa: 2 })]; }), { fileName: null }).fields.erv).toBe(3);
    expect(teaserUnderwriting(reading((x) => { x.tenants = [tenant({ erv_pa: 1 }), tenant({})]; }), { fileName: null }).fields.erv).toBeNull();
  });
  it("reads a date only when the day is written", () => {
    expect(isoDate("2031-06-30")).toBe("2031-06-30");
    expect(isoDate("1/2/2030")).toBe("2030-02-01");
    expect(isoDate("June 2031")).toBeNull();
    expect(isoDate("31/02/2030")).toBeNull();
    expect(isoDate(null)).toBeNull();
  });
  it("a teaser with nothing for underwriting makes no version", () => {
    expect(hasUnderwriting(teaserUnderwriting(emptyExtraction(), { fileName: null }))).toBe(false);
  });
  it("lists what is still to underwrite, and treats LTV as debt", () => {
    expect(remainingInputs(null).map((g) => g.key)).toContain("exitYieldPct");
    const left = remainingInputs({ acquisitionPrice: 1, grossRentalIncome: 1, erv: 1, ltvPct: 55, exitYieldPct: 5 }).map((g) => g.key);
    expect(left).not.toContain("debt");
    expect(left).not.toContain("exitYieldPct");
    expect(left).toContain("acquisitionCosts");
    expect(left).toContain("targetIrr");
  });
  it("the tenant use vocabulary is the engine's, and plural words are read", () => {
    const a = JSON.parse(JSON.stringify(reading()));
    a.tenants = [{ name: "X", use: "Offices" }, { name: "Y", use: "shop" }];
    const x = normaliseReading(a)!;
    expect(x.tenants.map((t) => t.use)).toEqual(["office", null]);
  });
});
