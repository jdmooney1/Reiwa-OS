// ============================================================================
// Investment Memo — generation engine (placeholder for an LLM backend)
// ----------------------------------------------------------------------------
// These functions deterministically COMPOSE memo prose from the structured deal
// file — deal data, financial metrics, DD tracker, risk register, score and
// documents. They are pure and synchronous; the UI wraps them with a simulated
// "generating" delay. When an LLM is wired in, swap the bodies here and keep the
// same signatures — the editor and actions are unchanged.
// ============================================================================
import type { DealFile, DueDiligenceItem } from "@/types/database";
import type { DealNarrative } from "@/lib/mock-data";
import type { MemoSectionKey } from "@/lib/memo/sections";
import { SECTION_LABEL, MEMO_SECTIONS } from "@/lib/memo/sections";
import {
  ASSET_TYPE_LABEL, STRATEGY_LABEL, STAGE_LABEL, RECOMMENDATION_LABEL,
  DD_STATUS_LABEL, isDdOpen, isDdIssue,
} from "@/lib/domain";
import { CATEGORY_BY_KEY, type ScoreCategoryKey } from "@/lib/scoring/model";
import {
  formatMoney, formatPct, formatMultiple, formatArea, formatPerArea,
} from "@/lib/format";

type Narr = DealNarrative | undefined;

const para = (...lines: (string | false | null | undefined)[]) =>
  lines.filter(Boolean).join("\n\n");
const bullets = (items: string[]) => items.map((i) => `• ${i}`).join("\n");

function commentaryFor(file: DealFile, key: ScoreCategoryKey): string | null {
  return file.score?.categories.find((c) => c.category === key)?.commentary ?? null;
}

function ddInSection(file: DealFile, section: string): DueDiligenceItem[] {
  return file.dueDiligence.filter((d) => d.section === section);
}

// ---- Per-section generators ------------------------------------------------

function execSummary(file: DealFile, n: Narr): string {
  const d = file.deal;
  const price = formatMoney(d.price_guidance, d.currency);
  const score = file.score?.overall_score;
  const rec = file.score?.recommendation;
  const openIssues = file.dueDiligence.filter((i) => isDdIssue(i.status)).length;
  return para(
    `${d.asset_name} is a ${price} ${d.strategy ? STRATEGY_LABEL[d.strategy].toLowerCase() : ""} ${ASSET_TYPE_LABEL[d.asset_type].toLowerCase()} opportunity in ${d.submarket ?? d.city}, ${d.city}. The deal is currently at ${STAGE_LABEL[d.deal_stage]}.`,
    n?.thesis ? n.thesis.split(". ")[0] + "." : (n?.strategicRationale ?? ""),
    score != null
      ? `The Reiwa Investment Score is ${score.toFixed(1)}/100 (${rec ? RECOMMENDATION_LABEL[rec] : "unscored"}). The business plan targets a ${formatPct(d.target_irr, 1)} IRR and ${formatMultiple(d.equity_multiple)} equity multiple.`
      : "",
    openIssues > 0
      ? `${openIssues} due diligence ${openIssues === 1 ? "issue has" : "issues have"} been flagged and must be resolved prior to commitment.`
      : "No material due diligence issues are currently outstanding.",
  );
}

function keyMetrics(file: DealFile): string {
  const d = file.deal;
  const m = file.metrics;
  const rows: string[] = [
    `Guide price: ${formatMoney(d.price_guidance, d.currency)}`,
    `Net initial yield: ${formatPct(d.niy, 1)}`,
    `Reversionary yield: ${formatPct(d.reversionary_yield, 1)}`,
    `Passing rent: ${formatMoney(d.passing_rent, d.currency)} p.a.`,
    `ERV: ${formatMoney(d.erv, d.currency)} p.a.`,
    `Capex budget: ${formatMoney(d.capex_budget, d.currency)}`,
    `Target IRR: ${formatPct(d.target_irr, 1)}`,
    `Equity multiple: ${formatMultiple(d.equity_multiple)}`,
    `Price / sq ft: ${formatPerArea(d.price_guidance, d.size_sqft, d.currency, "sqft")}`,
    `Price / sq m: ${formatPerArea(d.price_guidance, d.size_sqm, d.currency, "sqm")}`,
  ];
  if (m) {
    rows.push(
      `Total cost: ${formatMoney(m.total_cost, d.currency)}`,
      `LTV: ${formatPct(m.ltv, 1)}`,
      `Exit yield: ${formatPct(m.exit_yield, 2)}`,
      `Yield on cost: ${formatPct(m.yield_on_cost, 2)}`,
    );
  }
  return bullets(rows);
}

function investmentThesis(file: DealFile, n: Narr): string {
  if (n?.thesis || n?.strategicRationale) return para(n?.thesis, n?.strategicRationale);
  // Fall back to the top three scoring strengths.
  const top = [...(file.score?.categories ?? [])]
    .filter((c) => (c.score ?? 0) >= 7)
    .slice(0, 3)
    .map((c) => `${CATEGORY_BY_KEY[c.category as ScoreCategoryKey]?.label}: ${c.commentary ?? ""}`);
  return top.length
    ? para("The investment case rests on the following strengths:", bullets(top))
    : "Investment thesis to be authored.";
}

function assetOverview(file: DealFile, n: Narr): string {
  const d = file.deal;
  return para(
    `${d.asset_name} is located at ${d.address ?? d.city}. The asset is a ${ASSET_TYPE_LABEL[d.asset_type].toLowerCase()} property comprising approximately ${formatArea(d.size_sqft, "sqft")} (${formatArea(d.size_sqm, "sqm")}).`,
    `Vendor: ${d.vendor_name ?? "—"}. Introduced by ${d.broker_name ?? "—"} (${d.source ?? "source not recorded"}).`,
    n?.marketPosition ? undefined : undefined,
  );
}

function locationMarket(file: DealFile, n: Narr): string {
  const d = file.deal;
  return para(
    `Market: ${d.market ?? d.city}. Submarket: ${d.submarket ?? "—"}.`,
    n?.marketPosition ?? "Market commentary to be authored from comparable evidence.",
  );
}

function incomeTenancy(file: DealFile): string {
  const d = file.deal;
  const reversion =
    d.passing_rent != null && d.erv != null
      ? `The income is reversionary: passing rent of ${formatMoney(d.passing_rent, d.currency)} against an ERV of ${formatMoney(d.erv, d.currency)} implies a reversion of ${formatMoney(d.erv - d.passing_rent, d.currency)} p.a.`
      : "Tenancy schedule to be confirmed.";
  const leasing = ddInSection(file, "Income Profile and Tenancy").concat(ddInSection(file, "Tenant Covenant Review"));
  return para(
    reversion,
    leasing.length
      ? "Leasing / covenant workstreams:\n" + bullets(leasing.map((i) => `${i.item} — ${DD_STATUS_LABEL[i.status]}`))
      : "",
  );
}

function businessPlan(file: DealFile, n: Narr): string {
  if (n?.businessPlan?.length) {
    return n.businessPlan.map((step, i) => `${i + 1}. ${step}`).join("\n");
  }
  return "Business plan to be authored.";
}

function financialAnalysis(file: DealFile): string {
  const d = file.deal;
  const m = file.metrics;
  if (!m) return "No underwriting model has been entered for this deal.";
  return para(
    `The total cost of ${formatMoney(m.total_cost, d.currency)} comprises a purchase price of ${formatMoney(m.purchase_price, d.currency)}, acquisition costs of ${formatMoney(m.acquisition_costs, d.currency)}, transfer tax of ${formatMoney(m.stamp_duty_or_transfer_tax, d.currency)} and capex of ${formatMoney(m.capex, d.currency)}.`,
    `The acquisition is geared at ${formatPct(m.ltv, 1)} LTV (${formatMoney(m.debt_amount, d.currency)} of debt at ${formatPct(m.interest_rate, 2)}). Net operating income of ${formatMoney(m.noi, d.currency)} implies a yield on cost of ${formatPct(m.yield_on_cost, 2)}.`,
    `Exit is modelled at a ${formatPct(m.exit_yield, 2)} yield for a value of ${formatMoney(m.exit_value, d.currency)}, generating a ${formatPct(m.irr, 1)} IRR, a ${formatMultiple(m.equity_multiple)} equity multiple and ${formatPct(m.cash_on_cash, 1)} cash-on-cash.`,
  );
}

function capexPlan(file: DealFile): string {
  const d = file.deal;
  const capexItems = ddInSection(file, "Capex Plan");
  return para(
    `A capex budget of ${formatMoney(d.capex_budget, d.currency)} is provided for in the business plan.`,
    commentaryFor(file, "capex_risk") ?? "",
    capexItems.length
      ? "Capex workstreams:\n" + bullets(capexItems.map((i) => `${i.item} — ${DD_STATUS_LABEL[i.status]}`))
      : "",
  );
}

function planningHeritageEsg(file: DealFile): string {
  const planning = ddInSection(file, "Planning and Heritage");
  const esg = ddInSection(file, "ESG and Compliance");
  const lines = [...planning, ...esg].map(
    (i) => `${i.item} (${i.section}) — ${DD_STATUS_LABEL[i.status]}${i.notes ? `: ${i.notes}` : ""}`,
  );
  return para(
    commentaryFor(file, "planning_heritage_risk") ?? "",
    lines.length ? bullets(lines) : "No planning, heritage or ESG items have been opened.",
  );
}

function japanRationale(file: DealFile, n: Narr): string {
  return para(
    n?.japanRationale ?? "",
    commentaryFor(file, "japanese_depreciation")
      ? `Depreciation benefit: ${commentaryFor(file, "japanese_depreciation")}`
      : "",
  ) || "Japan investor rationale to be authored.";
}

function taxStructuring(file: DealFile): string {
  const items = ddInSection(file, "Cross Border Tax and Holding Structure");
  return para(
    "Acquisition structuring and cross-border tax considerations:",
    items.length
      ? bullets(items.map((i) => `${i.item} [${i.jurisdiction}] — ${DD_STATUS_LABEL[i.status]}${i.notes ? `: ${i.notes}` : ""}`))
      : "Structuring workstreams to be opened (Propco/Holdco, TK-GK, transfer tax).",
  );
}

function fxSensitivity(file: DealFile): string {
  const d = file.deal;
  const pair = d.currency === "EUR" ? "EUR/JPY" : d.currency === "USD" ? "USD/JPY" : "GBP/JPY";
  const fxItems = ddInSection(file, "Currency Risk and Hedging");
  const fxRisks = file.risks.filter((r) => r.risk_category === "fx");
  return para(
    `Returns are denominated in ${d.currency} and exposed to ${pair} for Japanese investors. ${commentaryFor(file, "fx_financing_resilience") ?? ""}`,
    fxRisks.length ? "FX risks on the register:\n" + bullets(fxRisks.map((r) => `${r.risk_title} — ${r.mitigation ?? "mitigation TBC"}`)) : "",
    fxItems.length ? "Hedging workstreams:\n" + bullets(fxItems.map((i) => `${i.item} — ${DD_STATUS_LABEL[i.status]}`)) : "",
  );
}

function riskMitigation(file: DealFile): string {
  return summariseRisks(file);
}

function exitStrategy(file: DealFile): string {
  const d = file.deal;
  const m = file.metrics;
  const liquidity = commentaryFor(file, "liquidity_exit");
  return para(
    m
      ? `The base case assumes an exit at a ${formatPct(m.exit_yield, 2)} yield for ${formatMoney(m.exit_value, d.currency)}, delivering a ${formatPct(m.irr, 1)} IRR and ${formatMultiple(m.equity_multiple)} equity multiple.`
      : `The business plan targets a ${formatPct(d.target_irr, 1)} IRR and ${formatMultiple(d.equity_multiple)} equity multiple on exit.`,
    liquidity ? `Exit depth: ${liquidity}` : "",
  );
}

function recommendation(file: DealFile): string {
  return generateICRecommendation(file);
}

function furtherDD(file: DealFile, n: Narr): string {
  const open = file.dueDiligence.filter((i) => isDdOpen(i.status));
  const grouped = new Map<string, string[]>();
  for (const i of open) {
    const arr = grouped.get(i.section) ?? [];
    arr.push(`${i.item}${i.owner ? ` (${i.owner})` : ""} — ${DD_STATUS_LABEL[i.status]}`);
    grouped.set(i.section, arr);
  }
  const blocks = Array.from(grouped.entries()).map(
    ([section, items]) => `${section}:\n${bullets(items)}`,
  );
  return para(
    open.length
      ? `${open.length} due diligence workstreams remain open:`
      : "All due diligence workstreams are cleared.",
    blocks.join("\n\n"),
    n?.openQuestions?.length ? "Key open questions:\n" + bullets(n.openQuestions) : "",
  );
}

// ---- Public API ------------------------------------------------------------

/** Generate a single section's content from the deal file. */
export function generateSection(
  key: MemoSectionKey,
  file: DealFile,
  narrative?: DealNarrative,
): string {
  switch (key) {
    case "executive_summary": return execSummary(file, narrative);
    case "key_metrics": return keyMetrics(file);
    case "investment_thesis": return investmentThesis(file, narrative);
    case "asset_overview": return assetOverview(file, narrative);
    case "location_market": return locationMarket(file, narrative);
    case "income_tenancy": return incomeTenancy(file);
    case "business_plan": return businessPlan(file, narrative);
    case "financial_analysis": return financialAnalysis(file);
    case "capex_plan": return capexPlan(file);
    case "planning_heritage_esg": return planningHeritageEsg(file);
    case "japan_rationale": return japanRationale(file, narrative);
    case "tax_structuring": return taxStructuring(file);
    case "fx_sensitivity": return fxSensitivity(file);
    case "risk_mitigation": return riskMitigation(file);
    case "exit_strategy": return exitStrategy(file);
    case "recommendation": return recommendation(file);
    case "further_dd": return furtherDD(file, narrative);
  }
}

/** Generate a full first draft (all sections). */
export function generateDraft(
  file: DealFile,
  narrative?: DealNarrative,
): Record<MemoSectionKey, string> {
  const out = {} as Record<MemoSectionKey, string>;
  for (const { key } of MEMO_SECTIONS) out[key] = generateSection(key, file, narrative);
  return out;
}

/** Summarise the risk register, ranked by score, with mitigations. */
export function summariseRisks(file: DealFile): string {
  if (file.risks.length === 0) return "No risks have been registered for this deal.";
  const ranked = [...file.risks].sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0));
  const lines = ranked.map(
    (r) => `${r.risk_title} [${r.risk_category}, score ${r.risk_score ?? "—"}] — ${r.mitigation ?? "mitigation to be confirmed"} (${r.status}).`,
  );
  const issues = file.dueDiligence.filter((i) => isDdIssue(i.status));
  return para(
    "Principal risks and mitigants, ranked by severity:",
    bullets(lines),
    issues.length
      ? "Flagged diligence issues:\n" + bullets(issues.map((i) => `${i.item} (${i.section})${i.notes ? `: ${i.notes}` : ""}`))
      : "",
  );
}

/** Generate an IC recommendation from the score and outstanding risks. */
export function generateICRecommendation(file: DealFile): string {
  const s = file.score;
  if (!s || s.overall_score == null) return "The deal has not yet been scored; a recommendation cannot be generated.";
  const rec = s.recommendation ? RECOMMENDATION_LABEL[s.recommendation] : "—";
  const flagged = s.categories.filter((c) => c.risk_flag).map((c) => CATEGORY_BY_KEY[c.category as ScoreCategoryKey]?.label);
  const openIssues = file.dueDiligence.filter((i) => isDdIssue(i.status)).length;
  return para(
    `Reiwa Investment Score: ${s.overall_score.toFixed(1)}/100 — recommendation: ${rec}.`,
    s.summary ?? "",
    flagged.length ? `Areas of concern flagged in scoring: ${flagged.join(", ")}.` : "No scoring categories are flagged.",
    openIssues > 0
      ? `Recommendation is conditional on resolving ${openIssues} flagged due diligence ${openIssues === 1 ? "issue" : "issues"}.`
      : "No flagged due diligence issues remain outstanding.",
  );
}

const ASSET_TYPE_JP: Record<string, string> = {
  residential: "住宅", office: "オフィス", retail: "商業施設", mixed_use: "複合用途",
  logistics: "物流施設", industrial: "産業施設", hotel: "ホテル", student_housing: "学生寮",
  healthcare: "ヘルスケア", data_centre: "データセンター", multifamily: "集合住宅",
  land: "土地", other: "その他",
};
const REC_JP: Record<string, string> = {
  strong_proceed: "積極的に推進", proceed: "推進", proceed_with_caution: "慎重に推進",
  weak: "弱い（要再検討）", reject: "見送り",
};

/** Generate a Japanese-language investor summary (placeholder template). */
export function generateJapaneseSummary(file: DealFile, narrative?: DealNarrative): string {
  const d = file.deal;
  const s = file.score;
  return para(
    `【${d.asset_name}】投資サマリー`,
    `所在地：${d.city}（${d.submarket ?? ""}）／資産タイプ：${ASSET_TYPE_JP[d.asset_type] ?? d.asset_type}`,
    `想定取得価格：${formatMoney(d.price_guidance, d.currency)}　ネット初期利回り：${formatPct(d.niy, 1)}　目標IRR：${formatPct(d.target_irr, 1)}`,
    s?.overall_score != null
      ? `Reiwa投資スコア：${s.overall_score.toFixed(1)}/100（${s.recommendation ? REC_JP[s.recommendation] : "未評価"}）`
      : "",
    `本件は、${d.city}に所在する${ASSET_TYPE_JP[d.asset_type] ?? ""}への投資機会です。${d.currency}建てのハードカレンシー資産として、日本の投資家に分散効果と安定した実物資産へのエクスポージャーを提供します。為替（対円）リスクはヘッジ方針に基づき管理されます。`,
    "※本サマリーはReiwa OSによる自動生成のドラフトです。配布前に必ず内容をご確認ください。",
  );
}

/** Generate a broker question list from open commercial workstreams + data gaps. */
export function generateBrokerQuestions(file: DealFile): string[] {
  const qs: string[] = [];
  const m = file.metrics;
  const d = file.deal;
  if (d.passing_rent != null && d.erv != null)
    qs.push("Please confirm the full tenancy schedule, including break options, rent reviews and any side letters.");
  qs.push("What is the vendor's motivation and timetable, and is the asset being marketed competitively or off-market?");
  if (!m) qs.push("Please provide the vendor's financial model / income & expenditure history.");
  for (const i of ddInSection(file, "Income Profile and Tenancy").concat(ddInSection(file, "Vendor and Deal Dynamics")))
    if (isDdOpen(i.status)) qs.push(`${i.question ?? i.item}`);
  qs.push("Are there any known capital expenditure requirements or outstanding statutory notices?");
  qs.push("Please confirm the basis of the quoted areas and provide floor plans.");
  return Array.from(new Set(qs));
}

/** Generate a DD request list from all open due diligence workstreams. */
export function generateDDRequestList(file: DealFile): string[] {
  const open = file.dueDiligence.filter((i) => isDdOpen(i.status));
  if (open.length === 0) return ["All due diligence workstreams are cleared — no outstanding requests."];
  return open.map(
    (i) => `[${i.section}] ${i.question ?? i.item}${i.owner ? ` — owner: ${i.owner}` : ""} (${DD_STATUS_LABEL[i.status]})`,
  );
}

/** Assemble selected sections into a single plain-text document for copy/export. */
export function assembleDocument(
  sectionKeys: MemoSectionKey[],
  content: Partial<Record<MemoSectionKey, string>>,
  title: string,
): string {
  const header = `${title}\nGenerated by Reiwa OS — draft for internal review\n${"=".repeat(60)}`;
  const body = sectionKeys
    .map((k, i) => `${i + 1}. ${SECTION_LABEL[k].toUpperCase()}\n\n${content[k]?.trim() || "[to be drafted]"}`)
    .join("\n\n");
  return `${header}\n\n${body}`;
}
