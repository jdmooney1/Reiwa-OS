// ============================================================================
// Turning one composed memo into the text a reviewer reads. PURE.
// ----------------------------------------------------------------------------
// The input is a ComposedMemo and the overrides beside it - the SAME object the
// workspace and the print view render, with the human text applied. Nothing in
// this file opens a connection, imports a data module or looks at a table: if a
// fact is not already in the memo object, the review does not get to see it.
// That is the same boundary loadMemoSource() draws on the way in, drawn again on
// the way out, and tests/unit/memo-review-boundaries.test.ts holds it.
//
// So the broker, the vendor, the source contact, the triage note, the address,
// the coordinates and every investor record are all absent here for the same
// reason they are absent from the memo: they were never copied into it.
//
// Sections are rendered at INTERNAL fidelity whatever format is open. A reviewer
// is a staff tool whose output never reaches an investor or a prospect, and the
// sections most worth a second look before finalising - Recommendation, Risk and
// Mitigation, Tax and Structuring - are exactly the internal-only ones. The open
// format is passed as context, not as a filter, so the model can also say "this
// will print blank in the Investor Teaser".
//
// NUMBERS ARE PASSED THROUGH UNTOUCHED. No rounding, no unit conversion, no
// recomputation - the raw recorded value and its format tag, so the reviewer
// compares what the record actually holds. A reviewer that reformatted a figure
// would be the first step towards one that corrects it.
// ============================================================================
import {
  resolveSection, type ComposedMemo, type MemoOverrides, type Block, type ResolvedSection,
} from "@/lib/memo/compose";
import { MEMO_SECTIONS, FORMAT_BY_KEY, SECTION_LABEL, type OutputFormat } from "@/lib/memo/sections";
import { FINDING_CATEGORIES } from "@/lib/memo-review/findings";

export const REVIEW_SYSTEM_PROMPT = [
  "You are reviewing an internal investment memorandum for Reiwa Capital before a member of staff finalises it.",
  "",
  "Your only job is to point at things a person should look at again. You are not approving the memo, not scoring it, and not summarising it.",
  "",
  "Rules, all of them absolute:",
  "- Never state a corrected figure, a recomputed value or what a number should be. If two figures disagree, say that they disagree and name both sections. Which one is right is for the analyst to determine from the records.",
  "- Never rewrite, draft or suggest replacement wording for any part of the memo.",
  "- Never give a verdict. Do not say the memo is fine, complete, ready, or well put together. If you have nothing to raise, return an empty list of findings - that is a normal and expected answer.",
  "- Raise only what you can point to in the memo text given to you. Do not infer facts about the property, the market or the borrower from outside it.",
  "- One finding per issue. Do not raise the same issue twice under different categories.",
  "- A finding reason is a single short sentence saying what you noticed and why it is worth checking.",
  "",
  "Be selective. A short list of real things beats a long list of hedges; an empty list is better than a padded one.",
].join("\n");

/** The categories, written out for the prompt so the model and the schema agree. */
function categoryGuide(): string {
  return FINDING_CATEGORIES.map((c) => `- ${c.key}: ${c.hint}`).join("\n");
}

function metricLine(label: string, value: number | string | null, format: string, currency: string): string {
  if (value === null) return `    ${label}: (not recorded)`;
  const unit = format === "money" ? ` ${currency}`
    : format === "pct" || format === "pct1" ? " %"
    : format === "multiple" ? "x"
    : format === "years" ? " years"
    : format === "area_sqft" ? " sq ft"
    : format === "area_sqm" ? " sq m"
    : "";
  return `    ${label}: ${String(value)}${unit}`;
}

function blockLines(block: Block, currency: string): string[] {
  const out: string[] = [];
  const head = `  [${block.audience}] source: ${block.source}`;
  switch (block.kind) {
    case "metrics":
      out.push(`${head}${block.label ? ` - ${block.label}` : ""}`);
      for (const m of block.items) out.push(metricLine(m.label, m.value, m.format, currency));
      break;
    case "text":
      out.push(`${head}${block.label ? ` - ${block.label}` : ""}`);
      out.push(`    ${block.text.replace(/\n/g, "\n    ")}`);
      break;
    case "list":
      out.push(`${head}${block.label ? ` - ${block.label}` : ""}`);
      for (const i of block.items) {
        out.push(`    - ${i.title}${i.tags.length ? ` [${i.tags.join(", ")}]` : ""}`);
        if (i.detail) out.push(`      ${i.detail.replace(/\n/g, "\n      ")}`);
      }
      break;
    case "facts":
      out.push(head);
      for (const f of block.items) out.push(`    ${f.label}: ${f.value}`);
      break;
  }
  return out;
}

function sectionText(label: string, resolved: ResolvedSection, currency: string): string {
  const lines = [`## ${label}`];
  for (const f of resolved.flags) lines.push(`  (flag) ${f}`);
  if (resolved.state === "edited") {
    lines.push("  [written by hand, replaces the composed content]");
    lines.push(`    ${(resolved.overrideText ?? "").replace(/\n/g, "\n    ")}`);
  } else if (resolved.state === "empty") {
    lines.push(`  (empty) ${resolved.emptyReason ?? "Nothing is recorded for this section."}`);
  } else {
    for (const b of resolved.blocks) lines.push(...blockLines(b, currency));
  }
  return lines.join("\n");
}

/** The Snapshot grid, when this memo has one. Its gaps are the clearest placeholder signal in the record. */
function snapshotText(memo: ComposedMemo): string {
  const s = memo.snapshot;
  if (!s) return "";
  const lines = ["## One-Page Asset Snapshot (data grid)"];
  const f = (label: string, v: unknown) => {
    if (v !== null && v !== undefined) lines.push(`    ${label}: ${String(v)}`);
  };
  f("Reference", s.ref);
  f("Prepared on", s.preparedOn);
  f("Name", s.name);
  f("City", s.city);
  f("Country", s.country);
  f("Submarket", s.submarket);
  f("Asset type", s.assetType);
  f(`Price (${s.currency})`, s.price);
  f("Price (JPY)", s.priceJpy);
  f("Net initial yield %", s.niyPct);
  f("Passing rent", s.passingRent);
  f("ERV", s.erv);
  f("Occupancy %", s.occupancyPct);
  f("Capex", s.capex);
  if (s.allocation) {
    f("Land value", s.allocation.land);
    f("Building value", s.allocation.building);
    f("Land %", s.allocation.landPct);
    f("Building %", s.allocation.buildingPct);
    if (s.allocation.depreciation) {
      f("Depreciation years", s.allocation.depreciation.years);
      f("Depreciation method", s.allocation.depreciation.method);
      f("Depreciation annual", s.allocation.depreciation.annual);
    }
  }
  f("Basis", s.basisLabel);
  if (s.fx?.staleNote) lines.push(`    (flag) ${s.fx.staleNote}`);
  if (s.gaps.length) {
    lines.push("  Gaps the Snapshot template records as unfilled:");
    for (const g of s.gaps) lines.push(`    - ${g.label}: ${g.why}`);
  }
  return lines.join("\n");
}

/**
 * The whole memo as the reviewer sees it: every section, overrides applied,
 * internal content included, plus which format the person is finalising in.
 */
export function buildReviewPrompt(
  memo: ComposedMemo, overrides: MemoOverrides, format: OutputFormat,
): string {
  const fmt = FORMAT_BY_KEY[format];
  const basis = memo.basis.kind === "none"
    ? "no underwriting version"
    : `underwriting v${memo.basis.version ?? "?"} (${memo.basis.kind === "approved" ? "approved" : "working version, not approved"})`;

  const header = [
    "Here is the full composed memorandum. Review it and report anything worth a second look before it is finalised.",
    "",
    `Asset: ${memo.assetName}`,
    `Currency of all money figures unless stated: ${memo.currency}`,
    `Composed from: ${basis}`,
    `The person is working in the "${fmt.label}" format. Sections outside that format are shown to you anyway, because you are an internal tool; if something will print blank or read oddly in that format, that is worth raising.`,
    "",
    "Look for these four things and nothing else:",
    categoryGuide(),
    "",
    "A section marked (empty) has nothing recorded behind it, and the memo says so openly - that is not automatically a finding. Raise it only when it is a placeholder or gap marker that looks like it was meant to be filled before finalising.",
    "",
    "=== MEMORANDUM ===",
  ].join("\n");

  // Every section, in memo order, at internal fidelity.
  const sections = MEMO_SECTIONS.map((s) =>
    sectionText(SECTION_LABEL[s.key], resolveSection(memo.sections[s.key], overrides[s.key], "ic"), memo.currency),
  );

  const japanese = overrides.japanese_summary
    ? `## Japanese Language Summary (written by hand)\n    ${overrides.japanese_summary.replace(/\n/g, "\n    ")}`
    : "";

  return [header, ...sections, snapshotText(memo), japanese].filter(Boolean).join("\n\n");
}
