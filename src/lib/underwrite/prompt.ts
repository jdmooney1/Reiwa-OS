// ============================================================================
// The text a deal assessment reads. PURE.
// ----------------------------------------------------------------------------
// Built from the engine's report and the deal's facts, and nothing else: no
// connection, no data module. What the model can see is exactly what is in this
// text, so the line "it never saw the broker's email" is a property of this
// file, not a hope. Contact details in source facts are dropped by key.
//
// Figures are passed as the engine produced them, formatted for reading but not
// recomputed. The instructions forbid new numbers; the schema gives none a home.
// ============================================================================
import type { DealFacts } from "@/lib/underwrite/inputs";
import { INPUT_KEYS, INPUT_LABEL } from "@/lib/underwrite/inputs";
import type { Report } from "@/lib/underwrite/report";

export const ASSESSMENT_SYSTEM_PROMPT = `You are a sceptical member of an investment committee for Reiwa Capital, which brings UK and European real estate to Japanese investors (family offices, corporates, high-net-worth individuals). Your job is to give an honest view of one deal, find the reasons not to do it, and say on what terms it would work.

How Reiwa's investors judge a deal:
- On the yen return they keep: IRR after UK or local tax, Reiwa's fees and the cost of hedging into yen. The sterling or euro IRR before tax is not what they keep.
- They care about the downside, the quality of income, and whether the numbers rest on evidence or on assumption.

Rules you must follow:
1. Use only the figures in the material. Do not calculate, estimate or state any number that does not appear there. If you need a number that is not there, say it is missing.
2. A "default" input is not evidence. Rate it accordingly in the evidence register.
3. The model output is deterministic arithmetic over the inputs; criticise the inputs and the structure, not the arithmetic.
4. Proposed terms are inputs that will be priced by the engine after you answer. Choose them from the levers given, using the price-for-target table to calibrate. Do not state what they will return.
   - priceFactor: upfront price as a share of the asking price (for example 0.92).
   - deferredShare: deferred consideration as a share of the asking price, paid in year 2 only if rents hold up (0 if not proposed).
   - extraGuaranteeMonths: extra months of vendor rent guarantee on space that is vacant or expiring within a year.
   - topUpMonths: months of year-1 rent top-up from the vendor on that space.
   - acqFeePct: Reiwa's acquisition fee as a decimal (the standard is 0.01).
   If the deal works at the asking price, propose priceFactor 1 and zero for the rest.
5. Verdict: "proceed" only if it works at the asking price; "proceed_at_price" if it works only on amended terms; "pass" otherwise.
6. In the evidence register use only these keys: ${INPUT_KEYS.join(", ")}. Rate each key you can judge: high = backed by a contract, law or market data; medium = a brochure or indirect evidence, unverified; low = an assumption or default.
7. Write in British English, plainly and concisely, without hype. No headings or markdown inside fields.
8. A screening-tier model (no rent roll) is not a basis for a bid. Say so if it applies.`;

const SENSITIVE_KEY = /contact|email|phone|mobile|tel\b|address_line|vendor_name|agent_name/i;

function cleanFacts(value: unknown, depth = 0): unknown {
  if (depth > 4) return undefined;
  if (Array.isArray(value)) return value.slice(0, 40).map((v) => cleanFacts(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k.startsWith("_") || SENSITIVE_KEY.test(k)) continue;
      out[k] = cleanFacts(v, depth + 1);
    }
    return out;
  }
  return value;
}

const p = (x: number | null | undefined, d = 1) => (typeof x === "number" && Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : "n/a");
const m = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? `${(x / 1e6).toFixed(2)}M` : "n/a");
const mult = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? `${x.toFixed(2)}x` : "n/a");

export interface PromptContext {
  facts: DealFacts;
  sourceFacts: Record<string, unknown>;
  dataCompleteness: string | null;
  thesis: string | null;
  businessPlan: string | null;
}

export function buildAssessmentPrompt(ctx: PromptContext, r: Report): string {
  const f = ctx.facts;
  const ccy = r.currency;
  const out: string[] = [];
  out.push(`DEAL: ${f.name}`);
  out.push(`Market: ${f.market ?? "not recorded"}; asset type: ${f.assetType}; currency: ${ccy}; size: ${f.sizeSqft ? `${f.sizeSqft} sq ft` : "not recorded"}`);
  const pr = f.property;
  out.push(`Tenure: ${pr.tenure ?? "not recorded"}; unexpired term: ${pr.unexpiredTermYears ?? "n/a"} years; ground rent: ${pr.groundRentNote ?? (pr.groundRentPa != null ? `${pr.groundRentPa} a year` : "not recorded")}`);
  out.push(`WAULT to expiry: ${pr.waultToExpiryYears ?? "n/a"} years; to breaks: ${pr.waultToBreaksYears ?? "n/a"} years; rent reviews: ${pr.rentReviewMechanism ?? "not recorded"}; EPC: ${pr.epcRating ?? "not recorded"}`);
  if (ctx.dataCompleteness) out.push(`Source completeness (as recorded): ${ctx.dataCompleteness}`);
  if (ctx.thesis) out.push(`Analyst thesis: ${ctx.thesis.slice(0, 1500)}`);
  if (ctx.businessPlan) out.push(`Business plan: ${ctx.businessPlan.slice(0, 1500)}`);
  const sf = JSON.stringify(cleanFacts(ctx.sourceFacts));
  if (sf && sf !== "{}") out.push(`Source facts (as given by the source, unverified): ${sf.slice(0, 6000)}`);

  out.push("");
  out.push(`MODEL TIER: ${r.tier === "lease" ? `lease by lease (${r.units} units from a rent roll)` : "screening (no rent roll; income split into three tranches around the WAULT)"}`);
  out.push("INPUTS (key | value | source | basis):");
  for (const l of r.lines) out.push(`- ${l.key} (${INPUT_LABEL[l.key]}) | ${l.value} | ${l.source} | ${l.basis}`);
  if (r.gaps.length) out.push(`Known gaps: ${r.gaps.join(" ")}`);

  const b = r.base;
  out.push("");
  out.push(`BASE CASE (${r.annual.length}-year hold, asking price ${m(r.price)} ${ccy}):`);
  out.push(`Equity ${m(b.equity)}; debt ${m(b.debt)}; deal IRR before tax and fees ${p(b.irrDeal)}; unlevered ${p(b.irrUnlevered)}; investor IRR after tax and fees ${p(b.irrNet)} (${ccy}); hedged yen ${p(b.irrYenHedged)}; unhedged yen at a flat rate ${p(b.irrYenUnhedged)}; equity multiple ${mult(b.multipleNet)}; average cash yield ${p(b.cashYieldAvg)}; minimum interest cover ${b.icrMin == null ? "n/a (no debt)" : mult(b.icrMin)}; total fees ${m(b.feesTotal)}; total tax ${m(b.taxTotal)}.`);
  out.push(`Exit: year-end ${b.exit.year}, exit yield ${p(b.exit.exitYield, 2)}, value ${m(b.exit.gross)}${b.exit.unexpiredYears != null ? `, ${b.exit.unexpiredYears.toFixed(0)} years left on the lease` : ""}.`);
  out.push("Annual (gross rent | ground rent | running costs | NOI | capex | interest | tax | to investors), millions:");
  for (const a of r.annual.slice(0, 10)) {
    out.push(`- ${a.year}: ${m(a.gross)} | ${m(a.groundRent)} | ${m(a.opex)} | ${m(a.noi)} | ${m(a.capex)} | ${m(a.interest)} | ${m(a.tax)} | ${m(a.distribution)}`);
  }

  out.push("");
  out.push(`SCENARIOS (investor IRR ${ccy} | hedged yen | multiple | min interest cover):`);
  for (const s of r.scenarios) out.push(`- ${s.label}: ${p(s.irrNet)} | ${p(s.irrYenHedged)} | ${mult(s.multipleNet)} | ${s.icrMin == null ? "n/a" : mult(s.icrMin)}`);
  out.push("Scenario definitions: downside = exit yield +0.50%, market rents -10%, growth -2% a year, voids +6 months, incentives +3 months; upside = exit yield -0.25%, rents +5%, growth +1%; severe = exit +0.75%, rents -15%, growth -3%, voids +9, incentives +3, debt +1%, every break exercised.");
  out.push(`SENSITIVITIES (investor IRR ${ccy} | hedged yen | unhedged yen):`);
  for (const s of r.sensitivities) out.push(`- ${s.label}: ${p(s.irrNet)} | ${p(s.irrYenHedged)} | ${p(s.irrYenUnhedged)}`);
  out.push("HOLD PERIODS (years | sale year-end | lease left | exit yield | value | IRR | hedged yen | multiple):");
  for (const h of r.horizons) out.push(`- ${h.years}: ${h.saleYear} | ${h.unexpiredYears == null ? "freehold" : `${h.unexpiredYears.toFixed(0)} yrs`} | ${p(h.exitYield, 2)} | ${m(h.exitValue)} | ${p(h.irrNet)} | ${p(h.irrYenHedged)} | ${mult(h.multipleNet)}`);
  out.push("REVERSE STRESS:");
  out.push(`- Exit yield at which the hedged yen IRR is zero: ${r.reverse.exitYieldYenZero == null ? "not found in range" : p(r.reverse.exitYieldYenZero, 2)}`);
  out.push(`- Fall in market rents at which the hedged yen IRR is zero: ${r.reverse.ervShockYenZero == null ? "not found in range" : p(-r.reverse.ervShockYenZero, 0)}`);
  out.push("PRICE FOR TARGET (hedged yen IRR | price | share of asking):");
  for (const t of r.reverse.priceForYen) {
    out.push(`- ${p(t.target, 0)}: ${t.price == null ? "outside range" : `${m(t.price)} | ${(t.price / r.price).toFixed(3)}`}`);
  }
  return out.join("\n");
}
