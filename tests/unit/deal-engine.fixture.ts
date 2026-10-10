// ============================================================================
// Mutual House, 193-201 Regent Street (October 2026): the deal the engine was
// generalised from. Its standalone model gave, at the guide price, an investor
// IRR of 8.0% in sterling and 5.4% in yen fully hedged. The engine must land
// close to that on the same inputs, or the generalisation broke something.
// ============================================================================
import type { Lease, Params } from "@/lib/underwrite/engine";

export const MH_LEASES: Lease[] = [
  { unit: "6th", tenant: null, use: "office", areaSqft: 2429, rentPa: 279355, expiry: "2028-01-01", guaranteeUntil: "2028-01-01", ervPsf: 105 },
  { unit: "5th", tenant: "Kepler Partners LLP", use: "office", areaSqft: 2840, rentPa: 227415, expiry: "2027-01-01", ervPsf: 105, reletCapexPsf: 25 },
  { unit: "4th", tenant: "JRJ Investments Ltd", use: "office", areaSqft: 3338, rentPa: 350138, expiry: "2031-08-01", ervPsf: 105, renewalProb: 1, renewalRentFreeMonths: 3 },
  { unit: "3rd", tenant: "ZKB Securities (UK) Ltd", use: "office", areaSqft: 3355, rentPa: 294976, expiry: "2030-06-01", ervPsf: 105, reletCapexPsf: 25 },
  { unit: "2nd", tenant: "Glenhawk Group Ltd", use: "office", areaSqft: 3309, rentPa: 255510, expiry: "2027-01-01", ervPsf: 105, reletCapexPsf: 80 },
  { unit: "Hackett", tenant: "Hackett", use: "retail", areaSqft: 8589, rentPa: 1900000, expiry: "2031-07-01", reviewDate: "2028-07-01", reviewBasis: "upward_only", ervPa: 950 * 2395, renewalProb: 1, renewalRentFreeMonths: 0 },
  { unit: "Church's", tenant: "Church's (Prada)", use: "retail", areaSqft: 2994, rentPa: 1250000, expiry: "2034-04-01", reviewDate: "2029-04-01", reviewBasis: "upward_only", ervPa: 950 * 1327 },
];

export const MH_PARAMS: Params = {
  startDate: "2027-01-01", holdYears: 5, price: 62_675_000, purchaseCostsPct: 0.018, saleCostsPct: 0.01,
  exitYield: 0.0625, initialCapex: 0,
  ervGrowth: { office: 0.03, retail: 0.02, residential: 0.02, industrial: 0.02, hotel: 0.02, other: 0.02 },
  voidMonths: 3, rentFreeMonths: 9, renewalProb: 0, renewalRentFreeMonths: 0, newLeaseYears: 10,
  lettingFeePct: 0.15, voidCostPsf: 20, nonRecoverablePct: 0.02, fixedCostsPa: 120_000, costInflation: 0,
  groundRent: { kind: "geared", pct: 0.125, minimumPa: 340_000 },
  lifecycle: { sinkPct: 0.01, sinkFromYear: 6, refreshEveryYears: 10, refreshPsf: 40, refreshUse: ["office"], majorFirstYear: 20, majorEveryYears: 25, majorPsf: 150 },
  leaseholdExpiry: 2117.26, shortLeasePremium: 0.005,
  ltv: 0.5, debtRate: 0.0575, debtTermYears: 5, refiRate: 0.055, arrangementFeePct: 0.01,
  taxRate: 0.25, fees: { acqPct: 0.01, amPctEquity: 0.005, promotePct: 0.15, hurdle: 0.08 },
  fxSpot: 209.5, dealRate: 0.0375, yenRate: 0.0125, hedgeRatio: 1, hedgeCostLong: 0.02, fxExitSpot: 209.5,
  amendments: {},
};
