// ============================================================================
// What a deal assessment may say. PURE.
// ----------------------------------------------------------------------------
// The assessment is judgement written over numbers the engine produced. The
// schema is the contract, as for the memo review (docs/21): every field is
// closed, every list is bounded, and no field can carry a computed result.
//
//   - The evidence register refers to INPUT_KEYS only, so a rating always names
//     an input that exists. The value shown beside it comes from the engine's
//     input lines, never from the model.
//   - Proposed terms are INPUTS (a price factor, months of guarantee). The engine
//     prices them; the model never states what they return.
//   - There is no free-standing number field anywhere: a target IRR, a maximum
//     price or a value cannot be smuggled in as a "result".
//
// Numeric terms are clamped after parsing rather than bounded in the schema, so
// a model that suggests 25 months of guarantee gets 24, instead of the whole
// assessment failing over one lever.
// ============================================================================
import { z } from "zod";
import { INPUT_KEYS, type InputKey } from "@/lib/underwrite/inputs";
import type { ProposedTerms } from "@/lib/underwrite/scenarios";

const KEYS = INPUT_KEYS as unknown as [InputKey, ...InputKey[]];
const LEVEL = ["high", "medium", "low"] as const;

export const VERDICTS = [
  { key: "proceed", label: "Proceed" },
  { key: "proceed_at_price", label: "Proceed only on amended terms" },
  { key: "pass", label: "Pass" },
] as const;
export type Verdict = (typeof VERDICTS)[number]["key"];
export const VERDICT_LABEL: Record<Verdict, string> =
  Object.fromEntries(VERDICTS.map((v) => [v.key, v.label])) as Record<Verdict, string>;

export const TERM_KEYS = ["price", "deferred", "guarantee", "top_up", "fee"] as const;

export const AssessmentSchema = z.object({
  verdict: z.enum(VERDICTS.map((v) => v.key) as [Verdict, ...Verdict[]]),
  headline: z.string().min(1).max(220),
  rationale: z.string().min(1).max(1600),
  strengths: z.array(z.string().min(1).max(260)).max(6),
  concerns: z.array(z.object({
    severity: z.enum(LEVEL),
    text: z.string().min(1).max(320),
  })).max(8),
  mostExposedTo: z.enum(KEYS),
  exposureReason: z.string().min(1).max(320),
  evidence: z.array(z.object({
    key: z.enum(KEYS),
    confidence: z.enum(LEVEL),
    evidence: z.string().min(1).max(320),
    howToConfirm: z.string().min(1).max(220),
  })).max(INPUT_KEYS.length),
  proposedTerms: z.object({
    priceFactor: z.number(),
    deferredShare: z.number(),
    extraGuaranteeMonths: z.number(),
    topUpMonths: z.number(),
    acqFeePct: z.number(),
    rationale: z.array(z.object({
      term: z.enum(TERM_KEYS),
      why: z.string().min(1).max(320),
    })).max(TERM_KEYS.length),
    otherTerms: z.array(z.string().min(1).max(260)).max(6),
  }),
  icQuestions: z.array(z.string().min(1).max(260)).max(10),
  dataGaps: z.array(z.string().min(1).max(260)).max(8),
});
export type Assessment = z.infer<typeof AssessmentSchema>;

const clamp = (x: number, lo: number, hi: number) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo);

/** The levers, bounded to what a buyer could plausibly table. */
export function boundTerms(t: Assessment["proposedTerms"]): ProposedTerms {
  return {
    priceFactor: clamp(t.priceFactor, 0.6, 1),
    deferredShare: clamp(t.deferredShare, 0, 0.15),
    extraGuaranteeMonths: Math.round(clamp(t.extraGuaranteeMonths, 0, 24)),
    topUpMonths: Math.round(clamp(t.topUpMonths, 0, 24)),
    acqFeePct: clamp(t.acqFeePct, 0, 0.02),
  };
}

/** An assessment as read back from storage; null when it no longer parses. */
export function parseAssessment(raw: unknown): Assessment | null {
  const p = AssessmentSchema.safeParse(raw);
  return p.success ? p.data : null;
}
