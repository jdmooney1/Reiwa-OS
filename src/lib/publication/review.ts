// ============================================================================
// Publish review - what is about to change in front of investors, in words.
// ----------------------------------------------------------------------------
// Pure and import-free of anything server-only, so the same function builds the
// screen an administrator reads and the phrase the server later checks.
//
// A publication version is an immutable snapshot; "publish" swaps which snapshot
// investors see. This module compares the version about to go live with the one
// that is live now and says, field by field and document by document, what an
// investor will notice. When nothing is live yet, everything is new.
//
// It is deliberately NOT a control on who may publish. It is a pause: the person
// has to be shown the change and type back a sentence built from it.
// ============================================================================

export interface ReviewVersion {
  title: string;
  headline: string | null;
  overview: string | null;
  highlights: string[];
  market: string | null;
  submarket: string | null;
  city: string | null;
  country: string | null;
  assetType: string | null;
  strategy: string | null;
  currency: string;
  holdPeriodYears: number | null;
  headlinePrice: number | null;
  targetNiy: number | null;
  targetIrr: number | null;
  targetEquityMultiple: number | null;
  sizeSqft: number | null;
  sizeSqm: number | null;
}

export interface ReviewDocument {
  /** The same document across versions (a copy keeps it); a fresh upload has a new one. */
  lineageId: string;
  title: string;
  category: string;
  accessLevel: string;
  fileName: string | null;
  sizeBytes: number | null;
}

export type FieldKind = "text" | "figure";

export interface FieldChange {
  key: string;
  label: string;
  kind: FieldKind;
  before: string | null;
  after: string | null;
}

export type DocumentChangeType = "added" | "removed" | "changed";

export interface DocumentChange {
  type: DocumentChangeType;
  title: string;
  /** What moved, for a "changed" row; the access tier for an added/removed one. */
  detail: string;
}

export interface ReviewDiff {
  /** True when no version is live: every populated field is new to investors. */
  firstPublication: boolean;
  fields: FieldChange[];
  documents: DocumentChange[];
  /** Fields and documents that differ. The number the confirmation sentence quotes. */
  changeCount: number;
}

const TEXT_FIELDS: { key: keyof ReviewVersion; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "headline", label: "Headline" },
  { key: "overview", label: "Overview" },
  { key: "market", label: "Market" },
  { key: "submarket", label: "Submarket" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "assetType", label: "Asset type" },
  { key: "strategy", label: "Strategy" },
  { key: "currency", label: "Currency" },
];

const FIGURE_FIELDS: { key: keyof ReviewVersion; label: string; unit: string }[] = [
  { key: "headlinePrice", label: "Headline price", unit: "money" },
  { key: "targetNiy", label: "Target NIY", unit: "%" },
  { key: "targetIrr", label: "Target IRR", unit: "%" },
  { key: "targetEquityMultiple", label: "Equity multiple", unit: "x" },
  { key: "holdPeriodYears", label: "Hold period", unit: " yrs" },
  { key: "sizeSqft", label: "Size", unit: " sq ft" },
  { key: "sizeSqm", label: "Size", unit: " sq m" },
];

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString("en-GB")}`;
  }
}

/**
 * Figures are shown to the precision stored, not rounded, because a review that
 * hides the difference between 6.25% and 6.3% is the review that missed it.
 */
function figure(value: number | null, unit: string, currency: string): string | null {
  if (value === null || value === undefined) return null;
  if (unit === "money") return money(value, currency);
  return `${value.toLocaleString("en-GB", { maximumFractionDigits: 4 })}${unit}`;
}

function clean(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v === "" ? null : v;
}

function highlightsText(items: string[]): string | null {
  const cleaned = items.map((h) => h.trim()).filter(Boolean);
  return cleaned.length ? cleaned.map((h) => `• ${h}`).join("\n") : null;
}

export function diffVersions(
  live: ReviewVersion | null, candidate: ReviewVersion,
  liveDocs: ReviewDocument[], candidateDocs: ReviewDocument[],
): ReviewDiff {
  const fields: FieldChange[] = [];
  const baseline = live;

  for (const { key, label } of TEXT_FIELDS) {
    const before = clean(baseline ? (baseline[key] as string | null) : null);
    const after = clean(candidate[key] as string | null);
    if (before !== after) fields.push({ key, label, kind: "text", before, after });
  }
  {
    const before = baseline ? highlightsText(baseline.highlights) : null;
    const after = highlightsText(candidate.highlights);
    if (before !== after) fields.push({ key: "highlights", label: "Highlights", kind: "text", before, after });
  }
  for (const { key, label, unit } of FIGURE_FIELDS) {
    const before = baseline ? figure(baseline[key] as number | null, unit, baseline.currency) : null;
    const after = figure(candidate[key] as number | null, unit, candidate.currency);
    if (before !== after) fields.push({ key, label, kind: "figure", before, after });
  }

  const documents: DocumentChange[] = [];
  const liveByLineage = new Map(liveDocs.map((d) => [d.lineageId, d]));
  const nextByLineage = new Map(candidateDocs.map((d) => [d.lineageId, d]));
  for (const d of candidateDocs) {
    const was = liveByLineage.get(d.lineageId);
    if (!was) {
      documents.push({ type: "added", title: d.title, detail: `${d.accessLevel} tier` });
      continue;
    }
    const moved: string[] = [];
    if (was.title !== d.title) moved.push(`title "${was.title}" to "${d.title}"`);
    if (was.accessLevel !== d.accessLevel) moved.push(`tier ${was.accessLevel} to ${d.accessLevel}`);
    if (was.category !== d.category) moved.push(`category ${was.category} to ${d.category}`);
    if (moved.length) documents.push({ type: "changed", title: d.title, detail: moved.join("; ") });
  }
  for (const d of liveDocs) {
    if (!nextByLineage.has(d.lineageId)) {
      documents.push({ type: "removed", title: d.title, detail: `${d.accessLevel} tier` });
    }
  }

  return {
    firstPublication: live === null,
    fields,
    documents,
    changeCount: fields.length + documents.length,
  };
}

/**
 * The sentence a person types to publish. It quotes the two numbers the screen
 * puts at the top - how much is changing and how many organisations will see it
 * - so it cannot be typed from memory of a previous publish. If the Overview is
 * the internal summary, it also names that.
 */
export function confirmationPhrase(
  versionNumber: number, changeCount: number, organisationCount: number,
  options: { echoesInternalSummary?: boolean } = {},
): string {
  const changes = `${changeCount} ${changeCount === 1 ? "change" : "changes"}`;
  const orgs = `${organisationCount} ${organisationCount === 1 ? "organisation" : "organisations"}`;
  const base = `publish v${versionNumber} with ${changes} to ${orgs}`;
  // When the Overview is the internal summary, the sentence says so. A warning can
  // be scrolled past; a sentence has to be typed, and this one has to be typed in
  // full, including the part that names the problem.
  return options.echoesInternalSummary ? `${base} with the internal summary as the overview` : base;
}

/** Case and spacing carry no meaning in the typed sentence; the words and numbers do. */
export function normalisePhrase(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function phraseMatches(typed: string, expected: string): boolean {
  return normalisePhrase(typed) === normalisePhrase(expected);
}
