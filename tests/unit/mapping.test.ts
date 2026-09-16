import { describe, it, expect } from "vitest";
import {
  suggestMappings, summariseMappings, headerSignature, toTemplateMappings,
} from "@/lib/ingestion/mapping";
import { normaliseHeader } from "@/lib/ingestion/synonyms";

const fieldFor = (headers: string[], header: string) =>
  suggestMappings(headers).find((m) => m.header === header)?.field;

describe("normaliseHeader", () => {
  it("strips units and qualifiers", () => {
    expect(normaliseHeader("Asking Price (GBP)")).toBe("asking price");
    expect(normaliseHeader("Passing Rent p.a.")).toBe("passing rent");
    expect(normaliseHeader("NIY %")).toBe("niy");
    expect(normaliseHeader("  Floor Area  (sq ft) ")).toBe("floor area");
  });
});

describe("suggestMappings - the brief's worked examples", () => {
  it("maps every price synonym to asking_price", () => {
    for (const h of ["Price", "Asking Price", "Guide", "Value", "Quoting Price", "Guide Price"]) {
      expect(fieldFor([h], h), h).toBe("asking_price");
    }
  });
  it("maps every income synonym to passing_income", () => {
    for (const h of ["Rent", "Income", "Passing Rent", "Annual Rent", "Rental Income"]) {
      expect(fieldFor([h], h), h).toBe("passing_income");
    }
  });
  it("maps yield synonyms to niy", () => {
    for (const h of ["Yield", "NIY", "Net Initial Yield", "Initial Yield"]) {
      expect(fieldFor([h], h), h).toBe("niy");
    }
  });
});

describe("suggestMappings - confidence and reasons", () => {
  it("marks an exact synonym with full confidence and no caveat", () => {
    const [m] = suggestMappings(["Asking Price"]);
    expect(m).toMatchObject({ field: "asking_price", method: "exact", confidence: 1 });
    expect(m.reason).toBeUndefined();
  });

  it("suggests cap rate but refuses to apply it silently", () => {
    const [m] = suggestMappings(["Cap Rate"]);
    expect(m.field).toBe("niy");
    expect(m.method).toBe("ambiguous");
    expect(m.confidence).toBeLessThan(1);
    expect(m.reason).toMatch(/net initial yield/i);
  });

  it("flags NOI as its own field rather than conflating it with passing rent", () => {
    expect(fieldFor(["NOI"], "NOI")).toBe("noi");
    const [m] = suggestMappings(["Net Income"]);
    expect(m.method).toBe("ambiguous");
    expect(m.reason).toMatch(/NOI/);
  });

  it("makes a fuzzy suggestion with the match it used", () => {
    const [m] = suggestMappings(["Aksing Price"]);
    expect(m.field).toBe("asking_price");
    expect(m.method).toBe("fuzzy");
    expect(m.reason).toMatch(/confirm/i);
  });
});

describe("suggestMappings - nothing is silently discarded", () => {
  it("returns one entry per column, including unrecognised ones", () => {
    const headers = ["Property", "Asking Price", "EPC Band", "Vendor Solicitor", ""];
    const mappings = suggestMappings(headers);
    expect(mappings).toHaveLength(5);
    expect(mappings.map((m) => m.header)).toEqual(headers);
  });

  it("explains why an unrecognised column was not mapped", () => {
    const m = suggestMappings(["Vendor Solicitor"])[0];
    expect(m.field).toBeNull();
    expect(m.method).toBe("unmapped");
    expect(m.reason).toMatch(/kept on the source row/i);
  });

  it("reports a blank header rather than crashing", () => {
    const m = suggestMappings([""])[0];
    expect(m.field).toBeNull();
    expect(m.reason).toBe("Blank header.");
  });

  it("preserves duplicate headers as distinct columns by index", () => {
    const mappings = suggestMappings(["Price", "Price"]);
    expect(mappings.map((m) => m.index)).toEqual([0, 1]);
  });
});

describe("suggestMappings - one field, one column", () => {
  it("keeps the stronger claim and reports the weaker as a conflict", () => {
    const mappings = suggestMappings(["Asking Price", "Guide"]);
    const mapped = mappings.filter((m) => m.field === "asking_price");
    expect(mapped).toHaveLength(1);
    const dropped = mappings.find((m) => !m.field)!;
    expect(dropped.reason).toMatch(/already maps to/i);
  });
});

describe("templates", () => {
  it("applies a saved template ahead of every heuristic", () => {
    const template = { "Ref": "property_name" as const };
    const [m] = suggestMappings(["Ref"], { template });
    expect(m).toMatchObject({ field: "property_name", method: "template", confidence: 1 });
  });

  it("honours a template that deliberately leaves a column unmapped", () => {
    const [m] = suggestMappings(["Price"], { template: { Price: null } });
    expect(m.field).toBeNull();
    expect(m.reason).toMatch(/saved template/i);
  });

  it("signs header rows order-insensitively so a reordered export still matches", () => {
    expect(headerSignature(["Property", "Price", "Broker"]))
      .toBe(headerSignature(["Broker", "Property", "Price"]));
    expect(headerSignature(["Property", "Price"]))
      .not.toBe(headerSignature(["Property", "Yield"]));
  });

  it("round-trips confirmed mappings into template form", () => {
    const mappings = suggestMappings(["Property", "Guide Price", "Mystery Column"]);
    const template = toTemplateMappings(mappings);
    expect(template["Property"]).toBe("property_name");
    expect(template["Guide Price"]).toBe("asking_price");
    expect(template["Mystery Column"]).toBeNull();
  });
});

describe("summariseMappings", () => {
  it("counts mapped, unmapped and unconfirmed columns", () => {
    const s = summariseMappings(suggestMappings(["Property", "Cap Rate", "Mystery"]));
    expect(s.mapped).toBe(2);
    expect(s.unmapped).toBe(1);
    expect(s.needsConfirmation).toBe(1);
    expect(s.unmappedHeaders).toEqual(["Mystery"]);
  });

  it("reports important fields no column supplies instead of inventing them", () => {
    const s = summariseMappings(suggestMappings(["Property", "Price"]));
    expect(s.missingImportant).toContain("broker");
    expect(s.missingImportant).toContain("city");
    expect(s.missingImportant).not.toContain("asking_price");
  });
});
