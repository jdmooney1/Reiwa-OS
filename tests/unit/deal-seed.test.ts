// The deal seed parser: what it maps, what it keeps, what it refuses, and what it flags.
import { describe, it, expect } from "vitest";
import { parseDealSeed, parseSourcing, seedReference } from "@/lib/ingestion/deal-seed";
import { similarNames } from "@/lib/data/deal-seed";
import { fullDeal, waultDeal, earlyDeal, thinDeal, conflictDeal, file } from "./deal-seed.fixture";

const one = (d: unknown) => parseDealSeed(file(d))[0];
const refusal = (...d: unknown[]) => { try { parseDealSeed(file(...d)); return ""; } catch (e) { return (e as Error).message; } };

describe("mapping", () => {
  it("maps a full record onto the columns, and money onto the figures that become an investment case", () => {
    const d = one(fullDeal());
    expect(d).toMatchObject({
      reference: "SEED-ALPHA-HALL-TESTVILLE", name: "Alpha Hall, Testville", address: "8 Test Embankment, London",
      assetType: "mixed_use", sourceType: "broker_marketed", dealStage: "guided", sizeSqft: 20000,
      brokerName: "Example Partners LLP", sourceContactName: "Pat Example", sourceKind: "brochure",
      money: { currency: "GBP", guidePrice: 13400000, niyPct: 7, passingRent: 1000000 },
      dataCompleteness: "full - broker IM email read in full",
    });
    expect(d.property).toMatchObject({
      heritageStatus: "Grade II Listed", tenure: "long_leasehold", unexpiredTermYears: 131,
      covenantRating: "D&B 3A3", rentReviewMechanism: "5-yearly, CPI-linked, 2.0% cap / 0.5% collar",
    });
  });

  it("a peppercorn is words, not zero; an amount is an amount", () => {
    expect(one(fullDeal()).property).toMatchObject({ groundRentPa: null, groundRentNote: "Peppercorn" });
    expect(one(waultDeal()).property).toMatchObject({ groundRentPa: 100, groundRentNote: null, tenure: "virtual_freehold", unexpiredTermYears: 892 });
  });

  it("WAULT, EPC and transport map when stated", () => {
    expect(one(waultDeal()).property).toMatchObject({ waultToExpiryYears: 4.2, waultToBreaksYears: 3.4, epcRating: "B", transportConnectivity: "Underground, short walk" });
  });

  it("NULL STAYS NULL: a missing EPC, tenure, price or yield is null, never defaulted or computed", () => {
    const e = one(fullDeal());
    expect(e.property.epcRating).toBeNull();
    expect(e.property.transportConnectivity).toBeNull();
    expect(e.property.waultToExpiryYears).toBeNull();
    const thin = one(thinDeal());
    expect(thin.property.tenure).toBeNull();
    expect(thin.money).toMatchObject({ guidePrice: 11000000, niyPct: null, passingRent: null });
    const early = one(earlyDeal());
    expect(early.money).toMatchObject({ guidePrice: null, niyPct: null, passingRent: null });
    expect(early.dealStage).toBe("early_dialogue");
  });

  it("off_market true / false / null become off_market / broker_marketed / other, never a guess", () => {
    expect(one(earlyDeal()).sourceType).toBe("off_market");
    expect(one(fullDeal()).sourceType).toBe("broker_marketed");
    expect(one(waultDeal()).sourceType).toBe("other");
  });

  it("only an exact passing_rent_gbp_pa is passing rent: a retail-only rent is kept as a source fact, not promoted", () => {
    const early = one(earlyDeal());
    expect(early.money.passingRent).toBeNull();
    expect((early.sourceFacts.deal_terms as Record<string, unknown>).retail_passing_rent_gbp_pa).toBe(270000);
  });
});

describe("photo references", () => {
  it("distinguishes an external link, an unretrieved attachment, and not-looked-at", () => {
    expect(one(earlyDeal()).photo).toEqual({ type: "external_url", url: "https://example.com/project/gamma", attachments: [] });
    expect(one(thinDeal()).photo).toEqual({ type: "attachment_not_retrieved", url: null, attachments: ["Photos.pdf", "Data.xlsx"] });
    expect(one(fullDeal()).photo).toEqual({ type: null, url: null, attachments: [] });
  });

  it("refuses an inconsistent reference", () => {
    const withDocs = (documents: unknown) => ({ ...earlyDeal(), documents });
    expect(refusal(withDocs({ photo_reference_type: "external_url" }))).toMatch(/needs a photo_url/);
    expect(refusal(withDocs({ photo_url: "https://example.com/x" }))).toMatch(/needs photo_reference_type external_url/);
    expect(refusal(withDocs({ photo_reference_type: "external_url", photo_url: "ftp://x" }))).toMatch(/http\(s\)/);
    expect(refusal(withDocs({ photo_reference_type: "attachment_not_retrieved" }))).toMatch(/needs the attachments/);
    expect(refusal(withDocs({ photo_reference_type: "none_found", attachments_identified: ["a.pdf"] }))).toMatch(/none_found cannot also list/);
    expect(refusal(withDocs({ photo_reference_type: "stored" }))).toMatch(/must be one of/);
    expect(refusal(withDocs({ attachments_identified: [1] }))).toMatch(/list of file names/);
  });
});

describe("nothing is dropped", () => {
  const leaves = (o: unknown, p = ""): string[] =>
    o !== null && typeof o === "object" && !Array.isArray(o)
      ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => leaves(v, p ? `${p}.${k}` : k))
      : [p];

  it("every non-null source value is either a mapped column or kept verbatim in sourceFacts", () => {
    const MAPPED = new Set([
      "opportunity.name", "opportunity.address", "opportunity.market", "opportunity.asset_type", "opportunity.off_market",
      "opportunity.deal_stage", "opportunity.sourcing", "asset_snapshot.size_sq_ft", "asset_snapshot.heritage_status",
      "asset_snapshot.tenure", "asset_snapshot.ground_rent", "asset_snapshot.ground_rent_gbp_pa", "asset_snapshot.unexpired_term_years",
      "asset_snapshot.wault_to_expiry_years", "asset_snapshot.wault_to_breaks_years", "asset_snapshot.covenant_rating",
      "asset_snapshot.rent_review_mechanism", "asset_snapshot.epc_rating", "asset_snapshot.transport_connectivity",
      "asset_snapshot.passing_rent_gbp_pa", "deal_terms.passing_rent_gbp_pa", "deal_terms.guide_price_gbp", "deal_terms.niy_percent", "deal_terms.currency",
      "documents.photo_reference_type", "documents.photo_url", "documents.attachments_identified", "data_completeness",
    ]);
    for (const make of [fullDeal, waultDeal, earlyDeal, thinDeal, conflictDeal]) {
      const input = make();
      const kept = one(input).sourceFacts as Record<string, unknown>;
      for (const path of leaves(input)) {
        if (MAPPED.has(path)) continue;
        const [section, key] = path.split(".");
        const got = (kept[section] as Record<string, unknown> | undefined)?.[key];
        const want = (input as unknown as Record<string, Record<string, unknown>>)[section][key];
        expect(got, `${input.opportunity.name}: ${path}`).toEqual(want);
      }
    }
  });

  it("does not touch the input it was given", () => {
    const input = JSON.parse(JSON.stringify(file(fullDeal(), thinDeal())));
    const before = JSON.stringify(input);
    parseDealSeed(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("refusal", () => {
  it("refuses unknown vocabulary rather than coercing it to 'other'", () => {
    const bad = (path: [string, string], value: unknown) => {
      const d = fullDeal() as unknown as Record<string, Record<string, unknown>>;
      d[path[0]][path[1]] = value;
      return refusal(d);
    };
    expect(bad(["asset_snapshot", "tenure"], "Commonhold")).toMatch(/tenure "Commonhold" is not one this loader knows/);
    expect(bad(["opportunity", "deal_stage"], "exchanged")).toMatch(/deal_stage "exchanged" must be one of/);
    expect(bad(["opportunity", "asset_type"], "Castle")).toMatch(/asset_type "Castle" is not one/);
    expect(bad(["opportunity", "off_market"], "yes")).toMatch(/off_market must be true, false or null/);
  });

  it("refuses text where a mapped number belongs, and a negative figure, but keeps unmapped text as given", () => {
    const num = (k: string, v: unknown) => { const d = fullDeal() as unknown as Record<string, Record<string, unknown>>; d.asset_snapshot[k] = v; return refusal(d); };
    expect(num("unexpired_term_years", "131 years")).toMatch(/unexpired_term_years must be a non-negative number/);
    expect(num("wault_to_expiry_years", -1)).toMatch(/non-negative/);
    expect(num("size_sq_ft", "20,000")).toMatch(/size_sq_ft must be/);
    expect(refusal(fullDeal())).toBe(""); // ">12,500,000" is unmapped text: fine
  });

  it("requires a name, an address and an asset type; refuses a currency it would have to convert", () => {
    const d = (o: Record<string, unknown>) => ({ ...fullDeal(), opportunity: { ...fullDeal().opportunity, ...o } });
    expect(refusal(d({ name: "" }))).toMatch(/name is required/);
    expect(refusal(d({ address: null }))).toMatch(/address is required/);
    expect(refusal(d({ asset_type: null }))).toMatch(/asset_type is required/);
    const usd = fullDeal(); (usd.deal_terms as Record<string, unknown>).currency = "USD";
    expect(refusal(usd)).toMatch(/refusing to guess a conversion/);
  });

  it("reports every problem in the file at once and loads none of it", () => {
    const a = fullDeal(); a.asset_snapshot.tenure = "Nope";
    const b = thinDeal(); (b.opportunity as Record<string, unknown>).deal_stage = "nope";
    const msg = refusal(a, b, earlyDeal());
    expect(msg).toMatch(/2 problems/);
    expect(msg).toMatch(/Alpha Hall.*tenure/);
    expect(msg).toMatch(/9a Delta Street.*deal_stage/);
    expect(msg).not.toMatch(/Gamma/);
  });

  it("refuses a file with no deals, a wrong shape, or two deals that would share a reference", () => {
    expect(() => parseDealSeed({})).toThrow(/"deals" array/);
    expect(() => parseDealSeed({ deals: [] })).toThrow(/no deals/);
    expect(() => parseDealSeed([])).toThrow(/"deals" array/);
    expect(refusal(fullDeal(), fullDeal())).toMatch(/also "Alpha Hall, Testville"/);
  });
});

describe("references and sources", () => {
  it("makes a stable, readable reference from the name", () => {
    expect(seedReference("25 Watling Street & 10 Bow Lane")).toBe("SEED-25-WATLING-STREET-AND-10-BOW-LANE");
    expect(seedReference("  9a  Curzon Street ")).toBe("SEED-9A-CURZON-STREET");
  });

  it("parses a broker line only when it has the shape, and otherwise sets nothing and says so", () => {
    expect(parseSourcing("Broker email, Knight Frank (Jake Withers)")).toEqual({ broker: "Knight Frank", contact: "Jake Withers", note: null });
    expect(parseSourcing("Broker IM, Hanover Green LLP (Guy Harris)")).toMatchObject({ broker: "Hanover Green LLP", contact: "Guy Harris" });
    expect(parseSourcing("Broker IM (format sample, thread not yet identified)")).toEqual({ broker: null, contact: null, note: null });
    expect(parseSourcing(null)).toEqual({ broker: null, contact: null, note: null });
    const w = one(waultDeal());
    expect(w.brokerName).toBeNull();
    expect(w.sourcing).toBe("Broker IM (format sample, thread not yet identified)");
    expect(w.flags.map((f) => f.code)).toContain("broker_not_parsed");
    expect(w.sourceKind).toBe("brochure");
    expect(one(earlyDeal()).sourceKind).toBe("broker_email");
  });
});

describe("flags: disagreement is recorded, never resolved", () => {
  it("a price that does not agree with its own price per sq ft is flagged, and the stated price is kept as given", () => {
    const d = one(conflictDeal());
    expect(d.money.guidePrice).toBe(27500000);
    const f = d.flags.find((x) => x.code === "price_psf_mismatch")!;
    expect(f.message).toMatch(/27,500,000.*917 x 28,000/);
  });

  it("carries the source's own conflict notes, and stores the flags beside the source facts", () => {
    const d = one(conflictDeal());
    expect(d.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["price_psf_mismatch", "source_note", "source_conflict_noted"]));
    expect(d.brokerName).toBe("Example Partners");
    expect(d.sourceContactName).toBe("Alex Lake / Pat Example");
    expect((d.sourceFacts._loader_flags as { code: string }[]).length).toBe(d.flags.length);
  });

  it("a consistent record carries no figure flag, and the check is not vacuous (it fires on a corrupted twin)", () => {
    expect(one(fullDeal()).flags.filter((f) => f.code.endsWith("mismatch"))).toEqual([]);
    expect(one(waultDeal()).flags.filter((f) => f.code.endsWith("mismatch"))).toEqual([]);
    const corrupt = waultDeal(); corrupt.deal_terms.price_psf_gbp = 1500; corrupt.deal_terms.passing_rent_psf_gbp = 60;
    expect(one(corrupt).flags.map((f) => f.code)).toEqual(expect.arrayContaining(["price_psf_mismatch", "passing_rent_psf_mismatch"]));
  });

  it("a clean record has no loader flags at all", () => {
    expect(one(thinDeal()).flags).toEqual([]);
    expect(one(thinDeal()).sourceFacts._loader_flags).toBeUndefined();
  });
});

describe("similarNames (the duplicate guard)", () => {
  it("matches the same building named differently, and not a different one", () => {
    expect(similarNames("25 Watling Street", "25 Watling Street & 10 Bow Lane")).toBe(true);
    expect(similarNames("Peek House", "peek  house")).toBe(true);
    expect(similarNames("9 Conduit Street", "16 Conduit Street")).toBe(false);
    expect(similarNames("16 Conduit Street", "Herengracht 472")).toBe(false);
    expect(similarNames("Ab", "Abc House")).toBe(false); // too short to mean anything
  });
});
