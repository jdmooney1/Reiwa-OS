// ============================================================================
// ECB feed: parsing, and the EUR-base -> GBP-base conversion.
// ----------------------------------------------------------------------------
// The fixture is in the shape the ECB documents for eurofxref-daily.xml (a
// gesmes envelope, one dated <Cube>, one <Cube currency rate/> per currency). The
// VALUES are a round, plausible day chosen so the expected answers can be checked
// by hand, not a capture of a real publication: the sandbox this was written in
// cannot reach the ECB, so the first live run is the real test of the fetch.
// ============================================================================
import { describe, it, expect } from "vitest";
import { parseEcbXml, crossRatesToGbp, EcbFeedError, ECB_AUTO_SOURCE } from "@/lib/fx-ecb";
import { validateRateSubmission } from "@/lib/fx";

const feed = (rates: string, time = "2026-10-02") => `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
  <Cube>
    <Cube time='${time}'>
      ${rates}
    </Cube>
  </Cube>
</gesmes:Envelope>`;

const GOOD = feed(`<Cube currency='USD' rate='1.1620'/>
      <Cube currency='JPY' rate='172.80'/>
      <Cube currency='CHF' rate='0.9400'/>
      <Cube currency='GBP' rate='0.8710'/>`);

describe("parseEcbXml", () => {
  it("reads the publication date from the file, not from the clock, and every rate", () => {
    const f = parseEcbXml(GOOD);
    expect(f.date).toBe("2026-10-02");
    expect(f.perEur).toEqual({ USD: 1.162, JPY: 172.8, CHF: 0.94, GBP: 0.871 });
  });

  it("accepts double quotes and self-closing or open tags", () => {
    expect(parseEcbXml(feed(`<Cube currency="USD" rate="1.1"></Cube><Cube currency="JPY" rate="170"/><Cube currency="GBP" rate="0.87"/>`).replace("></Cube>", "/>")).perEur.USD).toBe(1.1);
  });

  it.each([
    ["an empty feed", ""],
    ["no dated block", GOOD.replace(/<Cube time='[^']+'>/, "<Cube>")],
    ["two dated blocks", GOOD.replace("</Cube>\n  </Cube>", "</Cube><Cube time='2026-10-01'><Cube currency='USD' rate='1'/></Cube>\n  </Cube>")],
    ["a date that is not a calendar date", feed(`<Cube currency='USD' rate='1.1'/><Cube currency='JPY' rate='170'/><Cube currency='GBP' rate='0.87'/>`, "2026-02-31")],
    ["no GBP", feed(`<Cube currency='USD' rate='1.1'/><Cube currency='JPY' rate='170'/>`)],
    ["no JPY", feed(`<Cube currency='USD' rate='1.1'/><Cube currency='GBP' rate='0.87'/>`)],
    ["a zero rate", feed(`<Cube currency='USD' rate='0'/><Cube currency='JPY' rate='170'/><Cube currency='GBP' rate='0.87'/>`)],
    ["a negative rate", feed(`<Cube currency='USD' rate='-1.1'/><Cube currency='JPY' rate='170'/><Cube currency='GBP' rate='0.87'/>`)],
    ["a rate that is not a number", feed(`<Cube currency='USD' rate='N/A'/><Cube currency='JPY' rate='170'/><Cube currency='GBP' rate='0.87'/>`)],
    ["a currency listed twice", feed(`<Cube currency='USD' rate='1.1'/><Cube currency='USD' rate='1.2'/><Cube currency='JPY' rate='170'/><Cube currency='GBP' rate='0.87'/>`)],
    ["an HTML error page", "<html><body>503 Service Unavailable</body></html>"],
    ["an oversized body", GOOD + " ".repeat(200_001)],
  ])("refuses %s, rather than guess", (_name, xml) => {
    expect(() => parseEcbXml(xml)).toThrow(EcbFeedError);
  });
});

describe("crossRatesToGbp", () => {
  const rates = Object.fromEntries(crossRatesToGbp(parseEcbXml(GOOD)).map((r) => [r.currency, r.rateToGbp]));

  it("EUR is the feed's own EUR->GBP value", () => {
    expect(rates.EUR).toBe("0.871000");
  });

  it("USD and JPY are EUR->GBP divided by EUR->X: 1 USD = 0.871 / 1.162 GBP", () => {
    expect(rates.USD).toBe("0.749570");        // 0.871 / 1.162 = 0.7495697...
    expect(rates.JPY).toBe("0.005041");        // 0.871 / 172.8 = 0.0050405...
  });

  it("GBP is forced to 1.000000 whatever the feed says it is", () => {
    expect(rates.GBP).toBe("1.000000");
  });

  it("stamps every row with the feed's date", () => {
    expect(new Set(crossRatesToGbp(parseEcbXml(GOOD)).map((r) => r.asOf))).toEqual(new Set(["2026-10-02"]));
  });

  it("lands within a plausible band of the seeded rates (same order of magnitude)", () => {
    const seed = { EUR: 0.85, USD: 0.79, JPY: 0.0052 };
    for (const c of ["EUR", "USD", "JPY"] as const) {
      const ratio = Number(rates[c]) / seed[c];
      expect(ratio, c).toBeGreaterThan(0.85);
      expect(ratio, c).toBeLessThan(1.15);
    }
  });

  it("every derived rate passes the same gate a person's entry does", () => {
    for (const r of crossRatesToGbp(parseEcbXml(GOOD))) {
      const v = validateRateSubmission({ currency: r.currency, rate: r.rateToGbp, source: ECB_AUTO_SOURCE, asOf: r.asOf }, "2026-10-05");
      expect(v.ok, `${r.currency}: ${!v.ok && v.error}`).toBe(true);
    }
  });

  it("refuses a rate that would round to zero at six places", () => {
    const f = parseEcbXml(feed(`<Cube currency='USD' rate='1.1'/><Cube currency='JPY' rate='900000000'/><Cube currency='GBP' rate='0.87'/>`));
    expect(() => crossRatesToGbp(f)).toThrow(/rounds to zero/);
  });
});

describe("the auto source is a legitimate source", () => {
  it("is not mistaken for a placeholder by the validator", () => {
    expect(validateRateSubmission({ currency: "EUR", rate: "0.871", source: ECB_AUTO_SOURCE, asOf: "2026-10-02" }, "2026-10-05").ok).toBe(true);
  });
});
