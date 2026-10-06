// ============================================================================
// What a pre-finalisation review is allowed to come back with.
// ----------------------------------------------------------------------------
// A finding is a POINTER, never a correction. It names a place in the memo and
// says why it is worth a second look; it carries no replacement text and no
// corrected number, because nothing downstream of it may write to the memo.
//
// That is not only a UI decision. The system rule is that every figure is
// produced by deterministic code and traceable to a named input, so a model
// stating "the yield should be 5.1%" would be a number from nowhere - untraceable
// by construction, and wrong to put in front of someone about to finalise. A
// finding may say "the yield in Key Metrics and the one in Financial Analysis
// disagree"; it may not say which is right.
//
// The schema is the enforcement, not the prompt: `strictFindingSchema` is handed
// to the model as a structured-output format, so `category` and `sections` cannot
// come back as anything but the values below, and `reason` cannot come back as a
// paragraph. parseFindings() re-checks the same shape when a stored review is
// read, so a row written by an older version can never render as something else.
// ============================================================================
import { z } from "zod";
import { MEMO_SECTIONS, SECTION_LABEL, type MemoSectionKey } from "@/lib/memo/sections";

/**
 * The four things a review is asked to look for. Each is a question about the
 * memo as a document - not a judgement about the deal, and not a recalculation.
 */
export const FINDING_CATEGORIES = [
  {
    key: "numeric_inconsistency",
    label: "Figures disagree",
    hint: "A number in one section does not match the same number in another.",
  },
  {
    key: "outlier_metric",
    label: "Unusual figure",
    hint: "A metric that looks far from normal for this asset class or market, and is worth confirming.",
  },
  {
    key: "unresolved_gap",
    label: "Unresolved gap",
    hint: "A placeholder, a gap marker or a 'not yet captured' note still sitting in the memo.",
  },
  {
    key: "internal_contradiction",
    label: "Narrative contradiction",
    hint: "Something the prose says in one place that conflicts with what it says, or shows, elsewhere.",
  },
] as const;

export type FindingCategory = (typeof FINDING_CATEGORIES)[number]["key"];

export const CATEGORY_LABEL: Record<FindingCategory, string> =
  Object.fromEntries(FINDING_CATEGORIES.map((c) => [c.key, c.label])) as Record<FindingCategory, string>;

const CATEGORY_KEYS = FINDING_CATEGORIES.map((c) => c.key) as [FindingCategory, ...FindingCategory[]];
const SECTION_KEYS = MEMO_SECTIONS.map((s) => s.key) as [MemoSectionKey, ...MemoSectionKey[]];

export const MAX_FINDINGS = 25;
export const MAX_LABEL_CHARS = 120;
export const MAX_REASON_CHARS = 400;

/**
 * The structured-output schema the model answers in. Deliberately narrow: four
 * fields, a closed category set, closed section keys, and a `reason` short
 * enough that it cannot become a rewritten section by the back door.
 */
export const FindingSchema = z.object({
  category: z.enum(CATEGORY_KEYS),
  label: z.string().min(1).max(MAX_LABEL_CHARS),
  sections: z.array(z.enum(SECTION_KEYS)).min(1).max(SECTION_KEYS.length),
  reason: z.string().min(1).max(MAX_REASON_CHARS),
});

/**
 * An empty list is the ordinary, expected answer and means "nothing to raise".
 * It is NOT a statement that the memo is correct, and nothing renders it as one.
 */
export const ReviewSchema = z.object({
  findings: z.array(FindingSchema).max(MAX_FINDINGS),
});

export type Finding = z.infer<typeof FindingSchema>;

/** A finding, as read back out of `memo_ai_reviews.findings`. */
export function parseFindings(raw: unknown): Finding[] {
  const parsed = z.array(FindingSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** "Key Metrics and Financial Analysis" — for display beside a finding. */
export function sectionLabels(sections: MemoSectionKey[]): string {
  return sections.map((s) => SECTION_LABEL[s]).join(", ");
}
