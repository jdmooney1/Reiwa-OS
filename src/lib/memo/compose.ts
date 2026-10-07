// ============================================================================
// Investment memo - deterministic composition from real rows.
// ----------------------------------------------------------------------------
// Pure, like underwriting/derive.ts and compare.ts: no server imports, so the
// workspace, the print view and the tests all run the same function over the same
// rows.
//
// THE RULE (docs/07-memo-generator.md): every section is composed from rows that
// exist, or it is EMPTY AND SAYS SO. There is no language model here, no template
// prose and no default sentence standing in for a number nobody entered. The only
// words in a composed section are labels this file owns ("Target IRR") and text a
// person already wrote into a record (an underwriting thesis, a DD finding, a
// risk's mitigation), carried verbatim and attributed to where it came from.
// An empty section and a wrong one must never look alike: a section with nothing
// behind it has status "empty" and a reason that names what would create it.
//
// THE ONE EXCEPTION is the One-Page Asset Snapshot (decision: JD, Asset Snapshot
// brief). It is a branded one-pager that staff review and then send themselves, and
// it carries the street address and the property's headline photograph. Those two
// travel in ONE named object, MemoSource.asset, read by composeSnapshot() and by
// nothing else in this file; the seventeen prose sections cannot see them. The
// photograph is chosen from the photos staff have cleared for investors
// (visibility 'diligence'), the same rule as the investor teaser card, never from
// an internal-only one. tests/unit/memo-boundaries.test.ts holds that line.
//
// WHAT THIS FILE CAN SEE IS THE WHOLE LIST OF WHAT A MEMO CAN SAY. MemoSource is
// deliberately narrow. It has no street address, no coordinates, no geocode, no
// photographs, no broker or vendor, no source contact and no triage note. A memo
// is a document that gets forwarded; the location pin and the photographs are
// diligence-tier for an investor (migrations 0018, 0020), and a memo must never be
// the way round that. If a field is not in MemoSource it cannot reach a memo, and
// tests/unit/memo-compose.test.ts holds that line.
//
// AUDIENCE. Every block says who it is for. "external" blocks are the ones a
// document that leaves the building may carry (the same set the investor portal
// already treats as approved: price, targets, market, asset type, size).
// "internal" blocks - financing structure, income detail, DD findings, the risk
// register - appear in the Internal IC Memo and nowhere else. The Investor Teaser
// and the One-Page Snapshot render external blocks only. A person's own override
// text is always shown, because they chose to write it.
// ============================================================================
import type { MemoSectionKey, OutputFormat } from "@/lib/memo/sections";
import { MEMO_SECTIONS, FORMAT_BY_KEY } from "@/lib/memo/sections";
import { INVESTOR_FIGURES_DISCLAIMER } from "@/lib/investor-copy";
import { fxStaleness, oldestStaleness, convertViaGbp, isPlaceholderFxSource, FX_BASE_CURRENCY, FX_STALE_AFTER_DAYS } from "@/lib/fx";
import { areaFrom, type Area } from "@/lib/units";
import { allocationShares, annualDepreciation, checkAllocation, isDepreciationMethod, type DepreciationMethod } from "@/lib/underwriting/allocation";
import { DD_STATUS_LABEL, ASSET_TYPE_LABEL, STRATEGY_LABEL, isDdOpen, isDdIssue } from "@/lib/domain";
import { RECOMMENDATION_LABEL } from "@/lib/scoring/score";
import type { AssetType, DdSection, DdStatus, Recommendation, Strategy } from "@/types/database";

// ---- What a memo is composed from -------------------------------------------

export type MemoBasisKind = "approved" | "working" | "none";

/** The fields of the opportunity a memo may carry. See the header: this is the whole list. */
export interface MemoOpportunity {
  name: string;
  market: string | null;
  submarket: string | null;
  city: string | null;
  country: string | null;
  assetType: string;
  strategy: string | null;
  currency: string;
  sizeSqft: number | null;
  sizeSqm: number | null;
  /** Free text from the opportunity record. Internal: it is not reviewed for investors. */
  summary: string | null;
  /**
   * The opportunity's own copy of the case figures. These columns are a trigger-
   * maintained PROJECTION of the authoritative case (migration 0009), so they are
   * read only for the Snapshot, and only when there is no case to read instead.
   */
  projected: { price: number | null; niyPct: number | null; passingRent: number | null; erv: number | null; capex: number | null };
}

/**
 * What only the One-Page Asset Snapshot may carry about the property itself. See
 * the header: this is deliberately separate from MemoOpportunity so no other
 * section can reach it.
 */
export interface MemoAssetFacts {
  /** The opportunity's own reference ("RC-LON-0012"), when one is recorded. */
  reference: string | null;
  /** Street address, city and postcode as recorded, joined; null when there is no street address. */
  addressLine: string | null;
  /** The building photograph staff have cleared for investors (live, as of now); null when none is cleared. */
  photoId: string | null;
  /** The map image staff have cleared for investors (live, as of now); null when none is cleared. */
  mapId: string | null;
}

/** The underwriting version a memo is based on (an investment_cases row). */
export interface MemoCase {
  caseId: string;
  version: number;
  status: string;
  strategy: string | null;
  thesis: string | null;
  businessPlanAssumptions: string | null;
  acquisitionPrice: number | null;
  acquisitionCosts: number | null;
  capex: number | null;
  totalCost: number | null;
  equity: number | null;
  grossRentalIncome: number | null;
  noi: number | null;
  erv: number | null;
  occupancyPct: number | null;
  debt: number | null;
  ltvPct: number | null;
  debtCostPct: number | null;
  valuation: number | null;
  exitValue: number | null;
  entryYieldPct: number | null;
  exitYieldPct: number | null;
  holdPeriodYears: number | null;
  targetIrr: number | null;
  targetEquityMultiple: number | null;
  /** Value allocation (migration 0027). The shares and the annual charge are derived in composeSnapshot, never stored. */
  landValue: number | null;
  buildingValue: number | null;
  depreciationYears: number | null;
  depreciationMethod: string | null;
}

export interface MemoRisk {
  riskId: string;
  title: string;
  category: string;
  description: string | null;
  severity: "low" | "medium" | "high" | "critical";
  financialImpact: number | null;
  mitigation: string | null;
  status: "open" | "mitigated" | "accepted" | "closed";
  sourceDdItemId: string | null;
}

export interface MemoDdItem {
  ddItemId: string;
  section: DdSection;
  item: string;
  question: string | null;
  status: DdStatus;
  priority: string;
  finding: string | null;
  resolution: string | null;
}

/** The committee's recorded decision (ic_decisions, with amendments applied). */
export interface MemoDecision {
  decisionDate: string;
  outcome: string;
  recommendation: string | null;
  conditions: string | null;
  rationale: string | null;
}

/**
 * The newest COMPLETE Investment Score (investment_scores), read back through the
 * scoring model so its overall and band are today's. A part-finished score is not
 * a verdict and never reaches a memo.
 */
export interface MemoScore {
  version: number;
  scoredAt: string;
  overall: number;
  recommendationLabel: string;
  categories: { key: string; label: string; weight: number; score: number; commentary: string; riskFlag: boolean }[];
}

export interface MemoFx {
  currency: string;
  rateToGbp: number;
  asOf: string;
  source: string;
}

/**
 * The rate the committee decided against, recorded by the database at the instant
 * of approval (migration 0026). A different fact from MemoFx, the rate as it
 * stands today.
 */
export interface MemoFxLock {
  rateToGbp: number;
  source: string;
  asOf: string;
  /** The date the case was approved (ISO), which is when the rate was locked. */
  approvedOn: string;
}

export interface MemoSource {
  opportunity: MemoOpportunity;
  /** The case the memo is based on, and why that one. */
  basis: { kind: MemoBasisKind; case: MemoCase | null };
  risks: MemoRisk[];
  ddItems: MemoDdItem[];
  decision: MemoDecision | null;
  /** The recorded Investment Score, or null when none is complete. */
  score: MemoScore | null;
  fx: MemoFx | null;
  /** The rate locked when the basis case was approved. Null: not approved, or approved with none recorded. */
  fxLock: MemoFxLock | null;
  /** The date this memo is being composed on (ISO, UTC). Composition never reads a clock; the age of a rate is measured against this. */
  today: string;
  /** The JPY row of fx_rates, for the Snapshot's yen figures. */
  fxJpy: MemoFx | null;
  /** Property facts for the Snapshot only. */
  asset: MemoAssetFacts;
}

// ---- What composition returns ------------------------------------------------

export type Audience = "external" | "internal";
export type MetricFormat = "money" | "pct" | "pct1" | "multiple" | "years" | "area_sqft" | "area_sqm" | "text";

export interface MetricItem {
  key: string;
  label: string;
  /** Raw value, never a formatted string. Null = the record has no value. */
  value: number | string | null;
  format: MetricFormat;
}

interface BlockBase {
  audience: Audience;
  /** Where this came from, in words a reader can check ("Underwriting v3 (approved)"). */
  source: string;
}
export type Block =
  | (BlockBase & { kind: "metrics"; label?: string; items: MetricItem[] })
  /** Text a person wrote into a record, verbatim. */
  | (BlockBase & { kind: "text"; label?: string; text: string })
  | (BlockBase & { kind: "list"; label?: string; items: ListItem[] })
  | (BlockBase & { kind: "facts"; items: { label: string; value: string }[] });

export interface ListItem {
  title: string;
  /** Short qualifiers: a status, a severity, a due date. Facts from the row, not commentary. */
  tags: string[];
  /** Text a person wrote (a finding, a mitigation). Verbatim. */
  detail?: string | null;
}

export interface ComposedSection {
  status: "composed" | "empty";
  blocks: Block[];
  /** Things a reader must know about how this section was built ("Based on unapproved underwriting"). */
  flags: string[];
  /** For an empty section: what is missing and what would create it. Never prose about the deal. */
  emptyReason: string | null;
}

export interface MemoBasis {
  kind: MemoBasisKind;
  caseId: string | null;
  version: number | null;
  caseStatus: string | null;
}

export interface ComposedMemo {
  currency: string;
  assetName: string;
  basis: MemoBasis;
  sections: Record<MemoSectionKey, ComposedSection>;
  /**
   * The One-Page Asset Snapshot's own data grid. Absent on a memo composed before
   * the Snapshot existed: that is "not composed", never an empty snapshot.
   */
  snapshot?: ComposedSnapshot;
}

/** A figure the Snapshot shows: the number, and nothing about how it is written. */
export interface ComposedSnapshot {
  ref: string | null;
  /** The date this was composed on (ISO). */
  preparedOn: string;
  name: string;
  city: string | null;
  country: string | null;
  submarket: string | null;
  assetType: string;
  addressLine: string | null;
  /** The building photograph. Live while the memo is a draft; FROZEN into a private copy when it is finalised. */
  photo: SnapshotImage | null;
  /** The map image, handled exactly like the photograph. */
  map: SnapshotImage | null;
  currency: string;
  price: number | null;
  /** The price in yen, from the live rates. Null when either rate is missing, or the deal is in yen. */
  priceJpy: number | null;
  niyPct: number | null;
  passingRent: number | null;
  erv: number | null;
  occupancyPct: number | null;
  capex: number | null;
  area: Area | null;
  fx: SnapshotFx | null;
  /** Land, building and depreciation, derived on read. Null until the case holds a land AND a building value that reconcile to the price. */
  allocation: SnapshotAllocation | null;
  /** Where the figures come from, in words: "Reiwa underwriting v3 (approved)". Null when from nothing. */
  basisLabel: string | null;
  /** What the template has a place for and the record cannot fill. The workspace lists them; a printed copy never mentions them. */
  gaps: { key: string; label: string; why: string }[];
}

/**
 * A picture on the Snapshot, in one of two states.
 *
 *   live    a reference to a property_photos row. A DRAFT keeps these, so staff
 *           see current photographs while they iterate.
 *   frozen  a path in the private `memo-assets` bucket, keyed by the memo (not the
 *           photograph), written when the memo is finalised. It resolves to the
 *           memo's own copy and never back to property_photos, so deleting or
 *           re-tagging the source later cannot change a document already sent.
 */
export type SnapshotImage =
  | { source: "live"; photoId: string }
  | { source: "frozen"; path: string };

export interface SnapshotAllocation {
  land: number;
  building: number;
  landPct: number;
  buildingPct: number;
  /** Yen equivalents, from the same rates as the price line; null when a rate is missing or the deal is in yen. */
  landJpy: number | null;
  buildingJpy: number | null;
  /** Null until a life is entered. */
  depreciation: { years: number; method: DepreciationMethod; annual: number; annualJpy: number | null } | null;
}

export interface SnapshotFx {
  /** Yen per 1 pound, derived from the stored JPY rate. */
  jpyPerGbp: number;
  jpySource: string;
  jpyAsOf: string;
  /** For a deal not in pounds: pounds per 1 unit of the deal currency. */
  dealRateToGbp: number | null;
  dealSource: string | null;
  dealAsOf: string | null;
  /** "This rate is N days old." when the oldest rate used is past the staleness threshold. */
  staleNote: string | null;
}

/** The key under which a hand-written Japanese summary is stored in `overrides`. */
export const JAPANESE_KEY = "japanese_summary" as const;
export type OverrideKey = MemoSectionKey | typeof JAPANESE_KEY;
export type MemoOverrides = Partial<Record<OverrideKey, string>>;

// ---- Small helpers -----------------------------------------------------------

const present = (v: unknown): boolean => v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "");
const hasText = (s: string | null | undefined): s is string => typeof s === "string" && s.trim() !== "";

const empty = (emptyReason: string, flags: string[] = []): ComposedSection =>
  ({ status: "empty", blocks: [], flags, emptyReason });
const composed = (blocks: Block[], flags: string[] = []): ComposedSection =>
  blocks.length === 0
    ? empty("Nothing is recorded for this section.", flags)
    : ({ status: "composed", blocks, flags, emptyReason: null });

const BASIS_FLAG = "Based on unapproved underwriting";

function basisLabel(src: MemoSource): string {
  const c = src.basis.case;
  if (!c) return "No underwriting version";
  return `Underwriting v${c.version} (${src.basis.kind === "approved" ? "approved" : "working version, not approved"})`;
}

/** The flags every section drawn from the case carries when the case is not approved. */
function caseFlags(src: MemoSource): string[] {
  return src.basis.kind === "working" ? [BASIS_FLAG] : [];
}

const metric = (key: string, label: string, value: number | string | null, format: MetricFormat): MetricItem =>
  ({ key, label, value, format });

const ddIn = (src: MemoSource, ...sections: DdSection[]): MemoDdItem[] =>
  src.ddItems.filter((d) => sections.includes(d.section));

/**
 * DD workstreams as list items. Status is a fact about the row. A finding or
 * resolution is carried verbatim; nothing is summarised.
 */
function ddList(items: MemoDdItem[]): ListItem[] {
  return items.map((d) => ({
    title: d.item,
    tags: [DD_STATUS_LABEL[d.status]],
    detail: [d.finding, d.resolution ? `Resolution: ${d.resolution}` : null].filter(hasText).join("\n") || null,
  }));
}

function ddSection(
  src: MemoSource, sections: DdSection[], what: string,
): ComposedSection {
  const items = ddIn(src, ...sections);
  if (items.length === 0) {
    return empty(`No diligence workstreams are recorded for ${what}. Apply a diligence framework, or write this section in the override box.`);
  }
  return composed([{
    kind: "list", audience: "internal", source: `Diligence tracker: ${sections.join(", ")}`,
    label: "Diligence workstreams", items: ddList(items),
  }]);
}

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

// ---- The sections -------------------------------------------------------------

function keyMetrics(src: MemoSource): ComposedSection {
  const c = src.basis.case;
  const o = src.opportunity;
  if (!c) {
    return empty("No underwriting version exists for this opportunity, so there are no figures to show. Create one on the Underwriting tab.");
  }
  const area = o.sizeSqft ?? o.sizeSqm;
  const external: MetricItem[] = [
    metric("acquisitionPrice", "Target acquisition value", c.acquisitionPrice, "money"),
    metric("targetIrr", "Target IRR", c.targetIrr, "pct1"),
    metric("entryYieldPct", "Entry yield", c.entryYieldPct, "pct"),
    metric("targetEquityMultiple", "Target equity multiple", c.targetEquityMultiple, "multiple"),
    metric("holdPeriodYears", "Indicative hold period", c.holdPeriodYears, "years"),
    metric("size", "Approximate size", area, o.sizeSqft != null ? "area_sqft" : "area_sqm"),
  ];
  const internal: MetricItem[] = [
    metric("totalCost", "Total cost", c.totalCost, "money"),
    metric("noi", "Net operating income", c.noi, "money"),
    metric("valuation", "Entry valuation", c.valuation, "money"),
    metric("debt", "Debt", c.debt, "money"),
    metric("ltvPct", "Leverage (LTV)", c.ltvPct, "pct"),
    metric("equity", "Equity", c.equity, "money"),
    metric("debtCostPct", "Debt cost", c.debtCostPct, "pct"),
    metric("exitYieldPct", "Exit yield", c.exitYieldPct, "pct"),
  ];
  const source = basisLabel(src);
  const blocks: Block[] = [
    { kind: "metrics", audience: "external", source, items: external },
    { kind: "metrics", audience: "internal", source, label: "Financing and structure", items: internal },
  ];
  // A metrics block where nothing is recorded at all is an empty section, not a table of dashes.
  // Size comes from the opportunity, not the case: it does not make the case's figures exist.
  const anything = [...external, ...internal].some((m) => m.key !== "size" && present(m.value));
  return anything ? composed(blocks, caseFlags(src)) : empty(
    `Underwriting v${c.version} exists but records none of these figures.`, caseFlags(src));
}

const assetTypeText = (v: string) => ASSET_TYPE_LABEL[v as AssetType] ?? v;
const strategyText = (v: string) => STRATEGY_LABEL[v as Strategy] ?? v;

function assetOverview(src: MemoSource): ComposedSection {
  const o = src.opportunity;
  const blocks: Block[] = [{
    kind: "facts", audience: "external", source: "Opportunity record",
    items: [
      { label: "Asset", value: o.name },
      { label: "Asset type", value: assetTypeText(o.assetType) },
      ...(hasText(o.strategy) ? [{ label: "Strategy", value: strategyText(o.strategy) }] : []),
    ],
  }];
  const area = o.sizeSqft ?? o.sizeSqm;
  if (area != null) {
    blocks.push({
      kind: "metrics", audience: "external", source: "Opportunity record",
      items: [metric("size", "Approximate size", area, o.sizeSqft != null ? "area_sqft" : "area_sqm")],
    });
  }
  if (hasText(o.summary)) {
    blocks.push({ kind: "text", audience: "internal", source: "Opportunity summary", label: "Summary", text: o.summary });
  }
  return composed(blocks);
}

function locationMarket(src: MemoSource): ComposedSection {
  const o = src.opportunity;
  const items = [
    { label: "Market", value: o.market },
    { label: "Submarket", value: o.submarket },
    { label: "City", value: o.city },
    { label: "Country", value: o.country },
  ].filter((i): i is { label: string; value: string } => hasText(i.value));

  const blocks: Block[] = [];
  if (items.length > 0) blocks.push({ kind: "facts", audience: "external", source: "Opportunity record", items });
  const dd = ddIn(src, "Submarket Overview", "Location and Micro Situation", "Market Commentary");
  if (dd.length > 0) {
    blocks.push({ kind: "list", audience: "internal", source: "Diligence tracker: market and location",
      label: "Diligence workstreams", items: ddList(dd) });
  }
  return blocks.length ? composed(blocks) : empty("No market, city or country is recorded on the opportunity.");
}

function incomeTenancy(src: MemoSource): ComposedSection {
  const c = src.basis.case;
  const blocks: Block[] = [];
  if (c) {
    const items = [
      metric("grossRentalIncome", "Gross rental income", c.grossRentalIncome, "money"),
      metric("erv", "Estimated rental value (ERV)", c.erv, "money"),
      metric("occupancyPct", "Occupancy", c.occupancyPct, "pct"),
      metric("noi", "Net operating income", c.noi, "money"),
    ];
    if (items.some((m) => present(m.value))) {
      blocks.push({ kind: "metrics", audience: "internal", source: basisLabel(src), items });
    }
  }
  const dd = ddIn(src, "Income Profile and Tenancy", "Tenant Covenant Review");
  if (dd.length > 0) {
    blocks.push({ kind: "list", audience: "internal", source: "Diligence tracker: income and tenancy",
      label: "Diligence workstreams", items: ddList(dd) });
  }
  return blocks.length
    ? composed(blocks, c && blocks.some((b) => b.kind === "metrics") ? caseFlags(src) : [])
    : empty("No income figures are recorded on the underwriting and no income or tenancy diligence exists. Tenancy detail has no schedule in Phase 1; write it in the override box.");
}

function textFromCase(
  src: MemoSource, pick: (c: MemoCase) => string | null, noun: string,
): ComposedSection {
  const c = src.basis.case;
  if (!c) return empty(`No underwriting version exists, so there is no ${noun} to carry. Write it in the override box, or create one on the Underwriting tab.`);
  const text = pick(c);
  if (!hasText(text)) return empty(`Underwriting v${c.version} has no ${noun} recorded.`, caseFlags(src));
  // INTERNAL. Underwriting thesis text is written in committee voice (hedges,
  // candid risk framing, negotiating reasoning). It reaches an external format only
  // when a person writes an investor-facing version in the override box.
  return composed([{ kind: "text", audience: "internal", source: basisLabel(src), text }], caseFlags(src));
}

function businessPlan(src: MemoSource): ComposedSection {
  const blocks: Block[] = [];
  const c = src.basis.case;
  if (c && hasText(c.businessPlanAssumptions)) {
    // INTERNAL, for the same reason as the thesis: analyst prose in committee voice.
    blocks.push({ kind: "text", audience: "internal", source: basisLabel(src), text: c.businessPlanAssumptions });
  }
  const dd = ddIn(src, "Business Plan Scenarios");
  // The strategy label alone is not a business plan: it is only worth showing
  // beside a plan, never standing in for one. It is therefore internal too: with the
  // plan text internal, an external format would otherwise print "Strategy" alone
  // under a Business Plan heading. (The label already appears under Asset Overview.)
  const strategy = c?.strategy ?? src.opportunity.strategy;
  if (blocks.length + dd.length > 0 && hasText(strategy)) {
    blocks.push({ kind: "facts", audience: "internal", source: c?.strategy ? basisLabel(src) : "Opportunity record",
      items: [{ label: "Strategy", value: strategyText(strategy) }] });
  }
  if (dd.length > 0) {
    blocks.push({ kind: "list", audience: "internal", source: "Diligence tracker: business plan scenarios",
      label: "Diligence workstreams", items: ddList(dd) });
  }
  const fromCase = blocks.some((b) => b.source.startsWith("Underwriting"));
  return blocks.length ? composed(blocks, fromCase ? caseFlags(src) : []) : empty(
    c ? `Underwriting v${c.version} has no business plan recorded.` : "No underwriting version exists, so there is no business plan to carry.");
}

function financialAnalysis(src: MemoSource): ComposedSection {
  const c = src.basis.case;
  if (!c) return empty("No underwriting version exists, so there is no financial analysis. Create one on the Underwriting tab.");
  const items = [
    metric("acquisitionPrice", "Acquisition price", c.acquisitionPrice, "money"),
    metric("acquisitionCosts", "Acquisition costs", c.acquisitionCosts, "money"),
    metric("capex", "Capital expenditure", c.capex, "money"),
    metric("totalCost", "Total cost", c.totalCost, "money"),
    metric("debt", "Debt", c.debt, "money"),
    metric("equity", "Equity", c.equity, "money"),
    metric("ltvPct", "Leverage (LTV)", c.ltvPct, "pct"),
    metric("debtCostPct", "Debt cost", c.debtCostPct, "pct"),
    metric("noi", "Net operating income", c.noi, "money"),
    metric("valuation", "Entry valuation", c.valuation, "money"),
    metric("entryYieldPct", "Entry yield", c.entryYieldPct, "pct"),
    metric("exitValue", "Exit / stabilised value", c.exitValue, "money"),
    metric("exitYieldPct", "Exit yield", c.exitYieldPct, "pct"),
    metric("holdPeriodYears", "Hold period", c.holdPeriodYears, "years"),
    metric("targetIrr", "Target IRR", c.targetIrr, "pct1"),
    metric("targetEquityMultiple", "Target equity multiple", c.targetEquityMultiple, "multiple"),
  ];
  return items.some((m) => present(m.value))
    ? composed([{ kind: "metrics", audience: "internal", source: basisLabel(src), items }], caseFlags(src))
    : empty(`Underwriting v${c.version} records none of these figures.`, caseFlags(src));
}

function capexPlan(src: MemoSource): ComposedSection {
  const c = src.basis.case;
  const blocks: Block[] = [];
  if (c && present(c.capex)) {
    blocks.push({ kind: "metrics", audience: "internal", source: basisLabel(src),
      items: [metric("capex", "Capital expenditure", c.capex, "money")] });
  }
  const dd = ddIn(src, "Capex Plan");
  if (dd.length > 0) {
    blocks.push({ kind: "list", audience: "internal", source: "Diligence tracker: capex plan",
      label: "Diligence workstreams", items: ddList(dd) });
  }
  return blocks.length
    ? composed(blocks, c && present(c.capex) ? caseFlags(src) : [])
    : empty("No capital expenditure figure is recorded on the underwriting and no capex diligence exists. No capex programme is modelled in Phase 1; write it in the override box.");
}

function exitStrategy(src: MemoSource): ComposedSection {
  const c = src.basis.case;
  const blocks: Block[] = [];
  if (c) {
    const items = [
      metric("holdPeriodYears", "Indicative hold period", c.holdPeriodYears, "years"),
      metric("exitValue", "Target exit value", c.exitValue, "money"),
      metric("exitYieldPct", "Exit yield", c.exitYieldPct, "pct"),
    ];
    if (items.some((m) => present(m.value))) {
      blocks.push({ kind: "metrics", audience: "external", source: basisLabel(src), items });
    }
  }
  const dd = ddIn(src, "Exit Strategy");
  if (dd.length > 0) {
    blocks.push({ kind: "list", audience: "internal", source: "Diligence tracker: exit strategy",
      label: "Diligence workstreams", items: ddList(dd) });
  }
  return blocks.length
    ? composed(blocks, c && blocks.some((b) => b.kind === "metrics") ? caseFlags(src) : [])
    : empty("No hold period, exit value or exit yield is recorded, and no exit diligence exists. There is no exit-strategy text field; write it in the override box.");
}

function fxSensitivity(src: MemoSource): ComposedSection {
  const blocks: Block[] = [];
  const fx = src.fx;
  const lock = src.fxLock;
  const flags: string[] = [];
  const cur = src.opportunity.currency;
  blocks.push({ kind: "facts", audience: "internal", source: "Opportunity record", items: [{ label: "Deal currency", value: cur }] });

  // Two different questions, so two labelled figures, never one standing in for
  // both: what the committee decided against, and what the rate is now.
  if (lock) {
    const lockAge = fxStaleness(lock.asOf, lock.approvedOn);
    blocks.push({ kind: "facts", audience: "internal", source: `fx_rates as locked at approval: ${lock.source}`, items: [
      { label: `Rate locked at approval (${cur} to GBP)`, value: String(lock.rateToGbp) },
      { label: "Locked rate as of", value: lock.asOf },
      { label: "Locked rate source", value: lock.source },
      { label: "Approved on", value: lock.approvedOn },
    ] });
    if (/demo|static/i.test(lock.source)) flags.push("The rate locked at approval was a demonstration value, not a market rate");
    if (cur !== FX_BASE_CURRENCY && lockAge?.stale) {
      flags.push(`The rate locked at approval was ${lockAge.ageDays} days old on the day of approval`);
    }
  } else if (src.basis.kind === "approved") {
    flags.push(`No exchange rate was locked at approval (the case predates rate locking, or no ${cur} rate was recorded that day)`);
  }

  if (fx) {
    // The base currency's rate is 1 by definition and cannot go stale.
    const exempt = fx.currency === FX_BASE_CURRENCY;
    const age = exempt ? null : fxStaleness(fx.asOf, src.today);
    const prefix = lock ? "Current rate (live)" : null;
    blocks.push({ kind: "facts", audience: "internal", source: `fx_rates${lock ? " (current)" : ""}: ${fx.source}`, items: [
      { label: prefix ? `${prefix}: ${fx.currency} to GBP` : `${fx.currency} to GBP`, value: String(fx.rateToGbp) },
      { label: prefix ? "Current rate as of" : "Rate as of", value: fx.asOf },
      ...(age?.stale ? [{ label: "Rate age", value: `${age.ageDays} days` }] : []),
      { label: prefix ? "Current rate source" : "Rate source", value: fx.source },
      ...(lock && cur !== FX_BASE_CURRENCY && lock.rateToGbp > 0
        ? [{ label: "Movement since approval", value: `${(((fx.rateToGbp / lock.rateToGbp) - 1) * 100).toFixed(2)}%` }]
        : []),
    ] });
    // The rates table is seeded with static demonstration rates until a live feed
    // exists (migration 0004). A memo must not present them as market data.
    if (/demo|static/i.test(fx.source)) flags.push("Rate is a demonstration value, not a market rate");
    // Rates are updated daily from the ECB, or overridden by an administrator. A
    // rate past the staleness threshold is stated in the memo, with its age,
    // rather than quietly used.
    if (!exempt && age === null) {
      flags.push("The date of this rate could not be read, so its age is unknown");
    } else if (age?.stale) {
      flags.push(`${age.note} It is dated ${fx.asOf}; rates over ${FX_STALE_AFTER_DAYS} days old are flagged. Ask an administrator to update it before relying on this section`);
    }
  } else {
    flags.push(`No exchange rate is recorded for ${cur}`);
  }
  const dd = ddIn(src, "Currency Risk and Hedging");
  if (dd.length > 0) {
    blocks.push({ kind: "list", audience: "internal", source: "Diligence tracker: currency risk and hedging",
      label: "Hedging diligence", items: ddList(dd) });
  } else {
    flags.push("No hedging workstream is recorded; there is no hedge data in the system");
  }
  // Deal currency alone is not a sensitivity. Without a rate or a hedging
  // workstream there is nothing to say beyond what the record already says.
  if (!fx && !lock && dd.length === 0) {
    return empty(`Only the deal currency (${cur}) is recorded: no exchange rate and no hedging workstream. There is no FX sensitivity model; write this section in the override box.`);
  }
  return composed(blocks, flags);
}

function riskMitigation(src: MemoSource): ComposedSection {
  const live = src.risks.filter((r) => r.status !== "closed");
  const promoted = new Set(src.risks.map((r) => r.sourceDdItemId).filter(Boolean));
  const issues = src.ddItems.filter((d) => isDdIssue(d.status) && !promoted.has(d.ddItemId));
  const blocks: Block[] = [];
  if (live.length > 0) {
    const ranked = [...live].sort((a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
      || (b.financialImpact ?? -1) - (a.financialImpact ?? -1)
      || a.title.localeCompare(b.title));
    blocks.push({
      kind: "list", audience: "internal", source: "Risk register", label: "Risks, ranked by severity",
      items: ranked.map((r) => ({
        title: r.title,
        tags: [r.severity, r.status, r.category],
        detail: [r.description, r.mitigation ? `Mitigation: ${r.mitigation}` : null].filter(hasText).join("\n") || null,
      })),
    });
  }
  if (issues.length > 0) {
    blocks.push({
      kind: "list", audience: "internal", source: "Diligence tracker", label: "Flagged diligence issues not yet on the risk register",
      items: issues.map((d) => ({ title: d.item, tags: [d.section, DD_STATUS_LABEL[d.status]], detail: d.finding })),
    });
  }
  return blocks.length ? composed(blocks) : empty("No open risks are registered and no diligence issue is flagged.");
}

/**
 * Two different questions with two different answers, shown side by side and never
 * one over the other:
 *   - what the SCORING MODEL says (the recorded Investment Score, composed through
 *     the model), and
 *   - what the COMMITTEE DECIDED (the recorded ic_decisions row).
 * Either may exist without the other, and the section says which is missing.
 * Internal only: nothing about the recommendation becomes external.
 */
function recommendation(src: MemoSource): ComposedSection {
  const sc = src.score;
  const d = src.decision;
  if (!sc && !d) {
    return empty("No Investment Score and no investment committee decision are recorded. Score the opportunity on the Score tab, and record the committee's decision on the Decision tab.");
  }
  const blocks: Block[] = [];
  const flags: string[] = [];

  if (sc) {
    const flagged = sc.categories.filter((c) => c.riskFlag);
    blocks.push({
      kind: "facts", audience: "internal", source: `Investment Score v${sc.version}, ${sc.scoredAt.slice(0, 10)}`,
      items: [
        { label: "Overall score", value: `${sc.overall.toFixed(1)} / 100` },
        { label: "Model recommendation", value: sc.recommendationLabel },
        { label: "Criteria flagged as risks", value: String(flagged.length) },
      ],
    });
    blocks.push({
      kind: "list", audience: "internal", source: `Investment Score v${sc.version}`, label: "Criteria",
      items: sc.categories.map((c) => ({
        title: c.label,
        tags: [`${c.score}/10`, `weight ${c.weight}`, ...(c.riskFlag ? ["risk flagged"] : [])],
        detail: hasText(c.commentary) ? c.commentary : null,
      })),
    });
  } else {
    flags.push("No Investment Score is recorded");
  }

  if (d) {
    blocks.push({
      kind: "facts", audience: "internal", source: `Investment committee decision, ${d.decisionDate}`,
      items: [
        { label: "Committee outcome", value: d.outcome },
        ...(d.recommendation ? [{ label: "Recommendation recorded", value: RECOMMENDATION_LABEL[d.recommendation as Recommendation] ?? d.recommendation }] : []),
        { label: "Decision date", value: d.decisionDate },
      ],
    });
    if (hasText(d.rationale)) blocks.push({ kind: "text", audience: "internal", source: "Investment committee decision", label: "Rationale", text: d.rationale });
    if (hasText(d.conditions)) blocks.push({ kind: "text", audience: "internal", source: "Investment committee decision", label: "Conditions", text: d.conditions });
  } else {
    flags.push("No investment committee decision is recorded");
  }
  return composed(blocks, flags);
}

function furtherDd(src: MemoSource): ComposedSection {
  const open = src.ddItems.filter((d) => isDdOpen(d.status));
  if (open.length === 0) {
    return src.ddItems.length === 0
      ? empty("No diligence workstreams are recorded. Apply a diligence framework on the Due diligence tab.")
      : empty("Every recorded diligence workstream is cleared or not applicable.");
  }
  const bySection = new Map<string, MemoDdItem[]>();
  for (const d of open) bySection.set(d.section, [...(bySection.get(d.section) ?? []), d]);
  const blocks: Block[] = [...bySection.entries()].map(([section, items]) => ({
    kind: "list" as const, audience: "internal" as const, source: "Diligence tracker", label: section, items: ddList(items),
  }));
  return composed(blocks);
}

// ---- The memo ----------------------------------------------------------------

/** One entry per section key. Executive Summary is hand-written, never composed. */
const COMPOSERS: Record<MemoSectionKey, (src: MemoSource) => ComposedSection> = {
  executive_summary: () => empty("The executive summary is written by hand: there is nothing to compose it from. Add it in the override box."),
  key_metrics: keyMetrics,
  investment_thesis: (s) => textFromCase(s, (c) => c.thesis, "investment thesis"),
  asset_overview: assetOverview,
  location_market: locationMarket,
  income_tenancy: incomeTenancy,
  business_plan: businessPlan,
  financial_analysis: financialAnalysis,
  capex_plan: capexPlan,
  planning_heritage_esg: (s) => ddSection(s, ["Planning and Heritage", "ESG and Compliance"], "planning, heritage or ESG"),
  japan_rationale: (s) => ddSection(s, ["Japan Rationale"], "the Japan investor rationale"),
  tax_structuring: (s) => ddSection(s, ["Cross Border Tax and Holding Structure"], "tax and structuring"),
  fx_sensitivity: fxSensitivity,
  risk_mitigation: riskMitigation,
  exit_strategy: exitStrategy,
  recommendation,
  further_dd: furtherDd,
};

// ---- The One-Page Asset Snapshot ------------------------------------------------

/**
 * The Snapshot's data grid, composed from the same rows as the rest of the memo.
 *
 * Every figure is a recorded one or a unit conversion of a recorded one; nothing is
 * estimated and nothing is defaulted. What the record cannot fill is NULL, and the
 * renderer drops it from a printed copy. Specifically not here, because nothing in
 * the schema holds it: land and building value and the depreciation line, WAULT,
 * every Property Facts and Property Notes row, transport and the map. And not the
 * "reversionary yield" on the opportunity row: that column is a copy of the case's
 * EXIT yield (migration 0009), which is a different quantity, and labelling it
 * reversionary on a document an investor reads would state a number nobody
 * underwrote under that name.
 */
export function composeSnapshot(src: MemoSource): ComposedSnapshot {
  const o = src.opportunity;
  const c = src.basis.case;
  const p = o.projected;

  // The case when there is one; the opportunity's projection of it only when there
  // is not. One rule, so a figure never comes from two places.
  const price = c ? c.acquisitionPrice : p.price;
  const niyPct = c ? c.entryYieldPct : p.niyPct;
  const passingRent = c ? c.grossRentalIncome : p.passingRent;
  const erv = c ? c.erv : p.erv;
  const capex = c ? c.capex : p.capex;

  // Yen figures: through GBP, from the stored rates. A rate that is absent leaves
  // the figure absent; the base currency's rate is 1 by definition. A rate whose
  // source is a placeholder (the seeded "Demo static rates") is treated as absent
  // too: the Snapshot is an investor document, and a yen figure computed from a
  // stand-in rate would look live and be neither.
  const liveFx = src.fx && !isPlaceholderFxSource(src.fx.source) ? src.fx : null;
  const jpy = src.fxJpy && !isPlaceholderFxSource(src.fxJpy.source) ? src.fxJpy : null;
  const placeholderRate = (src.fx !== null && liveFx === null) || (src.fxJpy !== null && jpy === null);
  const dealRate = o.currency === FX_BASE_CURRENCY ? 1 : liveFx && liveFx.currency === o.currency ? liveFx.rateToGbp : null;
  const dealIsYen = o.currency === "JPY";
  const priceJpy = dealIsYen ? null : convertViaGbp(price, dealRate, jpy?.rateToGbp);
  const canQuoteYen = !dealIsYen && dealRate !== null && jpy !== null && jpy.rateToGbp > 0;

  let fx: SnapshotFx | null = null;
  if (canQuoteYen && jpy) {
    const dealMatters = o.currency !== FX_BASE_CURRENCY && liveFx;
    const stale = oldestStaleness([jpy.asOf, ...(dealMatters ? [liveFx!.asOf] : [])], src.today);
    fx = {
      jpyPerGbp: 1 / jpy.rateToGbp, jpySource: jpy.source, jpyAsOf: jpy.asOf,
      dealRateToGbp: dealMatters ? liveFx!.rateToGbp : null,
      dealSource: dealMatters ? liveFx!.source : null,
      dealAsOf: dealMatters ? liveFx!.asOf : null,
      staleNote: stale?.stale ? stale.note : null,
    };
  }

  const label = c
    ? `Reiwa underwriting v${c.version}${src.basis.kind === "approved" ? " (approved)" : " (working version, not yet approved)"}`
    : price !== null || niyPct !== null || passingRent !== null || erv !== null || capex !== null
      ? "Reiwa opportunity record" : null;

  const area = areaFrom(o.sizeSqft, o.sizeSqm);

  // Value allocation: only from a case (it is case data), only when BOTH halves are
  // entered and add up to the price. Derived here, on read, from the four stored inputs.
  const yen = (n: number) => (dealIsYen ? null : convertViaGbp(n, dealRate, jpy?.rateToGbp));
  const split = c ? allocationShares(c.landValue, c.buildingValue) : null;
  const reconciles = c ? checkAllocation(c.acquisitionPrice, c.landValue, c.buildingValue)?.ok === true : false;
  let allocation: SnapshotAllocation | null = null;
  if (c && split && reconciles) {
    const annual = c.depreciationYears !== null && isDepreciationMethod(c.depreciationMethod)
      ? annualDepreciation(c.buildingValue, c.depreciationYears) : null;
    allocation = {
      land: c.landValue!, building: c.buildingValue!, landPct: split.landPct, buildingPct: split.buildingPct,
      landJpy: yen(c.landValue!), buildingJpy: yen(c.buildingValue!),
      depreciation: annual !== null
        ? { years: c.depreciationYears!, method: c.depreciationMethod as DepreciationMethod, annual, annualJpy: yen(annual) }
        : null,
    };
  }
  const gaps: ComposedSnapshot["gaps"] = [
    { key: "rev_yield", label: "Reversionary yield", why: "The record's reversionary yield is the exit yield, a different quantity, so it is not shown under this name. It needs its own underwriting input." },
    { key: "wault", label: "WAULT", why: "No lease data is captured." },
    { key: "property_facts", label: "Property facts", why: "Build year, refurbishment, floors, use, planning and seller are not captured." },
    { key: "property_notes", label: "Property notes", why: "Tenure, energy rating, heritage, lease profile and rent basis are not captured." },
    { key: "transport", label: "Transport", why: "No transport data is captured." },
  ];
  if (!allocation) {
    const entered = c ? [c.landValue, c.buildingValue].filter((x) => x !== null).length : 0;
    gaps.push({
      key: "value_allocation", label: "Value allocation and depreciation basis",
      why: entered === 0 ? "Land value, building value and depreciation are not captured."
        : entered === 1 ? "Only one of land value and building value is entered; the split needs both."
        : "Land value and building value do not add up to the acquisition price, so the split is not shown.",
    });
  } else if (!allocation.depreciation) {
    gaps.push({ key: "depreciation_basis", label: "Depreciation basis", why: "No depreciation life is entered, so there is no annual charge." });
  }
  if (!src.asset.mapId) {
    gaps.push({ key: "map", label: "Map", why: "No map has been cleared for investors. Add one on the asset and mark it for diligence investors to use it here." });
  }
  if (!src.asset.photoId) {
    gaps.unshift({ key: "photo", label: "Photograph", why: "No photograph has been cleared for investors. Mark one as diligence on the asset to use it here." });
  }
  if (!src.asset.addressLine) gaps.unshift({ key: "address", label: "Street address", why: "No street address is recorded." });
  if (placeholderRate && !dealIsYen && !canQuoteYen) {
    gaps.push({ key: "jpy", label: "Yen equivalent", why: "The exchange rates held are demonstration values, so no yen figure is shown to investors. Replace them (Admin, Settings) or run the ECB sync." });
  } else if (!jpy && !dealIsYen) gaps.push({ key: "jpy", label: "Yen equivalent", why: "No JPY exchange rate is recorded." });
  else if (!dealIsYen && dealRate === null) gaps.push({ key: "jpy", label: "Yen equivalent", why: `No ${o.currency} exchange rate is recorded.` });

  return {
    ref: src.asset.reference,
    preparedOn: src.today,
    name: o.name, city: o.city, country: o.country, submarket: o.submarket,
    assetType: ASSET_TYPE_LABEL[o.assetType as AssetType] ?? o.assetType,
    addressLine: src.asset.addressLine,
    photo: src.asset.photoId ? { source: "live", photoId: src.asset.photoId } : null,
    map: src.asset.mapId ? { source: "live", photoId: src.asset.mapId } : null,
    currency: o.currency,
    price, priceJpy, niyPct, passingRent, erv,
    occupancyPct: c ? c.occupancyPct : null,
    capex, area, fx, allocation, basisLabel: label, gaps,
  };
}

/**
 * A Snapshot as an investor may see it: no yen figure that rests on a placeholder rate.
 *
 * A finalised memo is frozen, so a Snapshot composed while the seeded "Demo static rates"
 * were in force carries yen figures and a rate line that look live and are not. They stay in
 * the stored record (it is a record of what was composed) and are dropped at the one point
 * every reader passes through. Pure; returns the same object when there is nothing to drop.
 */
export function withoutPlaceholderFx(s: ComposedSnapshot): ComposedSnapshot {
  const fx = s.fx;
  if (!fx) return s;
  const placeholder = isPlaceholderFxSource(fx.jpySource) || (fx.dealSource !== null && isPlaceholderFxSource(fx.dealSource));
  if (!placeholder) return s;
  const a = s.allocation;
  return {
    ...s, priceJpy: null, fx: null,
    allocation: a && {
      ...a, landJpy: null, buildingJpy: null,
      depreciation: a.depreciation && { ...a.depreciation, annualJpy: null },
    },
  };
}

export function composeMemo(src: MemoSource): ComposedMemo {
  const c = src.basis.case;
  const sections = Object.fromEntries(
    MEMO_SECTIONS.map((s) => [s.key, COMPOSERS[s.key](src)]),
  ) as Record<MemoSectionKey, ComposedSection>;
  return {
    currency: src.opportunity.currency,
    assetName: src.opportunity.name,
    basis: {
      kind: src.basis.kind,
      caseId: c?.caseId ?? null,
      version: c?.version ?? null,
      caseStatus: c?.status ?? null,
    },
    sections,
    snapshot: composeSnapshot(src),
  };
}

// ---- Reading a section through a format and the person's own text ---------------

export type SectionState = "edited" | "composed" | "empty";

export interface ResolvedSection {
  state: SectionState;
  /** The person's own text; present exactly when state is "edited". */
  overrideText: string | null;
  /** The blocks this format shows. Empty when the state is "empty". */
  blocks: Block[];
  flags: string[];
  emptyReason: string | null;
  /** Internal blocks this format withheld: lets the workspace say "N more in the IC memo". */
  withheld: number;
}

/**
 * What a reader of `format` sees for one section.
 *
 *  - A person's override ALWAYS wins. It replaces the composed content in what is
 *    shown and exported; it never replaces it in the record.
 *  - Otherwise the composed blocks, filtered to the audience the format is for.
 *    External formats (teaser, snapshot) carry external blocks only.
 *  - If nothing is left, the section is empty and says why. A section whose only
 *    content was internal reads as empty in an external format: it must not look
 *    like a wrong section, and it must not leak.
 */
export function resolveSection(
  section: ComposedSection, overrideText: string | null | undefined, format: OutputFormat,
): ResolvedSection {
  const external = format === "teaser" || format === "snapshot" || format === "japanese";
  if (hasText(overrideText)) {
    return { state: "edited", overrideText, blocks: [], flags: [], emptyReason: null, withheld: 0 };
  }
  const blocks = external ? section.blocks.filter((b) => b.audience === "external") : section.blocks;
  const withheld = section.blocks.length - blocks.length;
  if (blocks.length === 0) {
    const reason = section.status === "empty"
      ? section.emptyReason
      : "The recorded content for this section is internal and is not shown in this format. Write an investor-facing version in the override box.";
    // When the content was withheld rather than absent, its flags describe content
    // this format does not show ("Based on unapproved underwriting"), so they go too.
    const flags = section.status === "empty" && !external ? section.flags : [];
    return { state: "empty", overrideText: null, blocks: [], flags, emptyReason: reason, withheld };
  }
  // Flags describe how the section was built ("based on unapproved underwriting"). That is
  // for the people inside the building; a document an investor reads carries the one standard
  // figures line instead (see showsFigures), whatever state the underwriting is in.
  return { state: "composed", overrideText: null, blocks, flags: external ? [] : section.flags, emptyReason: null, withheld };
}

/**
 * Does this section print a figure? Then, in a document an investor reads, it carries the
 * standard "Indicative, subject to final underwriting" line. A person's own text is not
 * inspected: the document's footer carries the line for that.
 */
export function showsFigures(resolved: ResolvedSection): boolean {
  return resolved.state === "composed" && resolved.blocks.some((b) =>
    b.kind === "metrics" && b.items.some((m) => m.value !== null && m.value !== ""));
}

/** The standard line for a section, or null when the section shows no figure. */
export function figuresLine(resolved: ResolvedSection): string | null {
  return showsFigures(resolved) ? INVESTOR_FIGURES_DISCLAIMER : null;
}


/** The sections a format shows, in memo order. */
export function sectionsFor(format: OutputFormat): MemoSectionKey[] {
  return FORMAT_BY_KEY[format].sections;
}

/**
 * Sections in `format` that would print with nothing under them: what a person
 * should be told before finalising, because a reader of the finished memo cannot
 * tell a blank section from a wrong one.
 */
export function emptySectionsFor(
  memo: ComposedMemo, overrides: MemoOverrides, format: OutputFormat,
): MemoSectionKey[] {
  // The Japanese summary is one hand-written text, not a grid of sections.
  if (format === "japanese") return [];
  return sectionsFor(format).filter(
    (k) => resolveSection(memo.sections[k], overrides[k], format).state === "empty");
}

/** Composed text a person wrote into the underwriting that an external format would carry as-is. */
export function unreviewedExternalText(
  memo: ComposedMemo, overrides: MemoOverrides, format: OutputFormat,
): MemoSectionKey[] {
  if (format !== "teaser" && format !== "snapshot") return [];
  return sectionsFor(format).filter((k) => {
    const r = resolveSection(memo.sections[k], overrides[k], format);
    return r.state === "composed" && r.blocks.some((b) => b.kind === "text");
  });
}

/**
 * Things a person should be told before locking a memo that are not an empty or
 * unreviewed SECTION. Today: the Snapshot carries the street address and a
 * photograph, which the Investment Portal reveals to an investor only at the
 * diligence tier. Staff are entitled to send it anyway (that is the point of the
 * document); they are not entitled to do it without having been told.
 */
export function finaliseNotices(memo: ComposedMemo, format: OutputFormat): string[] {
  if (format !== "snapshot" || !memo.snapshot) return [];
  const carries = [
    memo.snapshot.addressLine ? "the street address" : null,
    memo.snapshot.photo ? "a photograph" : null,
    memo.snapshot.map ? "a map" : null,
  ]
    .filter((x): x is string => x !== null);
  if (carries.length === 0) return [];
  const list = carries.length > 1 ? `${carries.slice(0, -1).join(", ")} and ${carries[carries.length - 1]}` : carries[0];
  const photoLike = carries.filter((c) => c !== "the street address").length;
  const frozen = [memo.snapshot.photo, memo.snapshot.map].some((i) => i?.source === "live")
    ? " Finalising keeps a private copy of each picture, so the document will not change if the originals are later removed or re-marked."
    : "";
  return [`This Snapshot carries ${list}. The Investment Portal shows ${carries.length > 1 || photoLike === 0 ? "those" : "that"} to an investor only at the diligence tier; the PDF gives ${carries.length > 1 || photoLike === 0 ? "them" : "it"} to whoever you send it to.${frozen}`];
}

// ---- Reading a stored memo back ------------------------------------------------

const MISSING_SECTION: ComposedSection = {
  status: "empty", blocks: [], flags: [],
  emptyReason: "This section did not exist when the memo was composed. Recompose the draft, or write it in the override box.",
};

/**
 * A stored `content` value, checked and completed. A memo saved before a section
 * existed has no entry for it: that reads as an empty section, never as a crash
 * and never as made-up content. Returns null for something that is not a memo.
 */
export function normaliseContent(raw: unknown): ComposedMemo | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ComposedMemo>;
  if (!r.sections || typeof r.sections !== "object" || typeof r.currency !== "string") return null;
  const sections = Object.fromEntries(MEMO_SECTIONS.map((s) => {
    const stored = (r.sections as Record<string, ComposedSection | undefined>)[s.key];
    const ok = stored && (stored.status === "composed" || stored.status === "empty") && Array.isArray(stored.blocks);
    return [s.key, ok ? stored : MISSING_SECTION];
  })) as Record<MemoSectionKey, ComposedSection>;
  return {
    currency: r.currency,
    assetName: typeof r.assetName === "string" ? r.assetName : "",
    basis: r.basis ?? { kind: "none", caseId: null, version: null, caseStatus: null },
    sections,
    // A memo saved before the Snapshot existed has none: absent, never invented.
    snapshot: isSnapshot(r.snapshot) ? upgradeSnapshot(r.snapshot) : undefined,
  };
}

/**
 * A snapshot stored before pictures became `photo` / `map` carried a bare `photoId`
 * (a live reference). Read it as the live photograph it was; never invent a map.
 */
function upgradeSnapshot(s: ComposedSnapshot): ComposedSnapshot {
  const legacy = s as ComposedSnapshot & { photoId?: string | null };
  const { photoId, ...rest } = legacy;
  return {
    ...rest,
    photo: s.photo ?? (typeof photoId === "string" ? { source: "live", photoId } : null),
    map: s.map ?? null,
  };
}

function isSnapshot(v: unknown): v is ComposedSnapshot {
  const s = v as Partial<ComposedSnapshot> | null;
  return !!s && typeof s === "object" && typeof s.name === "string" && typeof s.preparedOn === "string"
    && typeof s.currency === "string" && Array.isArray(s.gaps);
}

/** Override keys a client may send. Anything else is refused. */
export const OVERRIDE_KEYS: readonly OverrideKey[] = [...MEMO_SECTIONS.map((s) => s.key), JAPANESE_KEY];
export const isOverrideKey = (k: unknown): k is OverrideKey =>
  typeof k === "string" && (OVERRIDE_KEYS as readonly string[]).includes(k);

/** An override is plain text, never markup, and bounded. */
export const MAX_OVERRIDE_CHARS = 20_000;

/**
 * Whether two composed memos say the same thing. Postgres stores jsonb with its
 * own key order, so a memo read back is never byte-identical to the one composed
 * a moment ago; comparing text would call every saved draft stale. Keys are
 * sorted before comparing.
 */
export function sameContent(a: ComposedMemo, b: ComposedMemo): boolean {
  const canon = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
    if (v && typeof v === "object") {
      return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`;
    }
    return JSON.stringify(v ?? null);
  };
  // The Snapshot is compared without its prepared-on date, which moves every day
  // and would otherwise call every saved draft stale by tomorrow.
  const snap = (m: ComposedMemo) => (m.snapshot ? { ...m.snapshot, preparedOn: "" } : null);
  return canon(a.sections) === canon(b.sections) && canon(a.basis) === canon(b.basis)
    && canon(snap(a)) === canon(snap(b));
}
