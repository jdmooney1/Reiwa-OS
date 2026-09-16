// ============================================================================
// Opportunity matching - does this incoming item describe something we know?
// ----------------------------------------------------------------------------
// Weighted signals, scored in TypeScript so the logic is unit-testable without
// a database. The database narrows the candidate set (postcode, trigram); this
// module decides what the candidates mean.
//
// The governing rule from the brief: never merge uncertain opportunities
// silently. Nothing here returns "merged" - it returns a score and a band, and
// a human makes the call. The one exception is an exact content or message
// hash, which is a genuine re-send of material already held rather than a
// judgement about two similar deals.
//
// Pure module. Fully unit tested.
// ============================================================================
import {
  normaliseAddress, normaliseName, findPostcode, similarity,
  streetPart, buildingNumber, propertyIdentityKey,
} from "@/lib/ingestion/normalise";

export interface MatchSubject {
  address?: string | null;
  postcode?: string | null;
  name?: string | null;
  city?: string | null;
  broker?: string | null;
  price?: number | null;
  identityKey?: string | null;
}

export interface MatchTarget extends MatchSubject {
  propertyId: string;
  opportunityId?: string | null;
  /** For display in the review queue. */
  label?: string;
}

export type MatchBand = "exact" | "strong" | "possible" | "weak";

export interface MatchResult {
  target: MatchTarget;
  score: number;
  band: MatchBand;
  /** Per-signal contributions, so the review screen can explain the score. */
  signals: Record<string, number>;
  reasons: string[];
}

/**
 * Signal weights. Postcode and address dominate deliberately: broker and price
 * are corroboration, never identification. Two different buildings marketed by
 * the same agent at a similar price must not reach a merge suggestion on those
 * two facts alone, which is why their combined weight cannot clear the
 * "possible" floor.
 */
/**
 * Signal weights. Address and postcode dominate deliberately: broker and price
 * are corroboration, never identification.
 *
 * Scores are normalised over the weight of the signals that are actually
 * COMPARABLE, so a source that simply omits a postcode is not punished for it.
 * Two guards stop that normalisation being abused:
 *
 *   * without a comparable address or postcode, the score is capped below the
 *     review floor - broker and price alone can never suggest a merge;
 *   * only an identity-key match is ever "exact". Everything else tops out one
 *     band below, so a merge always passes through a human.
 */
export const WEIGHTS = {
  postcode: 0.35,
  address: 0.50,
  name: 0.10,
  broker: 0.03,
  price: 0.02,
} as const;

export const BANDS = { exact: 0.97, strong: 0.90, possible: 0.60 } as const;

/** Ceiling for anything short of an identity-key match. */
const INEXACT_CEILING = 0.96;
/** Ceiling when neither address nor postcode could be compared. */
const UNIDENTIFIED_CEILING = 0.35;
/** Ceiling when the two postcodes are definitely different. */
const CONFLICT_CEILING = 0.20;

export function scoreMatch(subject: MatchSubject, target: MatchTarget): MatchResult {
  const signals: Record<string, number> = {};
  const reasons: string[] = [];

  // Identity keys are derived here when the caller did not supply them, so the
  // strongest signal cannot be lost to a forgetful call site.
  const subjectKey = subject.identityKey ?? propertyIdentityKey(subject);
  const targetKey = target.identityKey ?? propertyIdentityKey(target);

  if (subjectKey && targetKey && subjectKey === targetKey) {
    return {
      target, score: 1, band: "exact",
      signals: { identityKey: 1 },
      reasons: ["Same normalised address and postcode."],
    };
  }

  const parts: { key: string; weight: number; score: number }[] = [];
  let postcodeConflict = false;
  let identifiable = false;

  // ---- Postcode ------------------------------------------------------------
  const subjectPostcode = findPostcode(subject.postcode) ?? findPostcode(subject.address);
  const targetPostcode = findPostcode(target.postcode) ?? findPostcode(target.address);

  if (subjectPostcode && targetPostcode) {
    identifiable = true;
    if (subjectPostcode.compact === targetPostcode.compact) {
      parts.push({ key: "postcode", weight: WEIGHTS.postcode, score: 1 });
      reasons.push(`Same postcode (${subjectPostcode.formatted}).`);
    } else if (subjectPostcode.outward === targetPostcode.outward) {
      // Same routeing district is proximity, not identity.
      parts.push({ key: "postcode", weight: WEIGHTS.postcode, score: 0.25 });
      reasons.push(`Same postcode district (${subjectPostcode.outward}).`);
    } else {
      postcodeConflict = true;
      parts.push({ key: "postcode", weight: WEIGHTS.postcode, score: 0 });
      reasons.push(`Different postcodes (${subjectPostcode.formatted} vs ${targetPostcode.formatted}).`);
    }
  }

  // ---- Address -------------------------------------------------------------
  const a = normaliseAddress(subject.address);
  const b = normaliseAddress(target.address);
  if (a && b) {
    identifiable = true;
    const streetA = streetPart(a);
    const streetB = streetPart(b);
    const numberA = buildingNumber(subject.address);
    const numberB = buildingNumber(target.address);

    let score: number;
    if (a === b || (streetA && streetB && streetA === streetB)) {
      score = 1;
      reasons.push("Same street address.");
    } else {
      score = similarity(a, b);
      if (score > 0.8) reasons.push("Very similar address.");
    }

    // The building number is the discriminator on a single street: 16 Conduit
    // Street and 22 Conduit Street are textually near-identical and are not the
    // same asset.
    if (numberA && numberB && numberA !== numberB) {
      score = Math.min(score, 0.4);
      reasons.push(`Different building numbers (${numberA} vs ${numberB}).`);
    }

    parts.push({ key: "address", weight: WEIGHTS.address, score });
  }

  // ---- Name ----------------------------------------------------------------
  const nameA = normaliseName(subject.name);
  const nameB = normaliseName(target.name);
  if (nameA && nameB) {
    const score = nameA === nameB ? 1 : similarity(nameA, nameB);
    parts.push({ key: "name", weight: WEIGHTS.name, score });
    if (score > 0.9) reasons.push("Same property name.");
  }

  // ---- Broker --------------------------------------------------------------
  const brokerA = normaliseName(subject.broker);
  const brokerB = normaliseName(target.broker);
  if (brokerA && brokerB) {
    const score = similarity(brokerA, brokerB) > 0.85 ? 1 : 0;
    parts.push({ key: "broker", weight: WEIGHTS.broker, score });
    if (score === 1) reasons.push("Same broker.");
  }

  // ---- Price ---------------------------------------------------------------
  if (subject.price != null && target.price != null && subject.price > 0 && target.price > 0) {
    const drift = Math.abs(subject.price - target.price) / Math.max(subject.price, target.price);
    const score = drift <= 0.10 ? 1 - drift / 0.10 : 0;
    parts.push({ key: "price", weight: WEIGHTS.price, score });
    if (score > 0) reasons.push("Similar asking price.");
  }

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  for (const part of parts) {
    signals[part.key] = Number((part.weight * part.score).toFixed(4));
  }

  let score = totalWeight === 0
    ? 0
    : parts.reduce((sum, p) => sum + p.weight * p.score, 0) / totalWeight;

  // Guards, applied in order of severity.
  score = Math.min(score, INEXACT_CEILING);
  if (!identifiable) {
    score = Math.min(score, UNIDENTIFIED_CEILING);
    reasons.push("No address or postcode to compare - this cannot identify a property on its own.");
  }
  if (postcodeConflict) {
    score = Math.min(score, CONFLICT_CEILING);
  }

  score = Math.max(0, Math.min(1, score));
  return { target, score: Number(score.toFixed(4)), band: bandFor(score), signals, reasons };
}


export function bandFor(score: number): MatchBand {
  if (score >= BANDS.exact) return "exact";
  if (score >= BANDS.strong) return "strong";
  if (score >= BANDS.possible) return "possible";
  return "weak";
}

/**
 * Rank candidates, best first, dropping anything below the "possible" floor.
 * A caller that gets an empty array should create a new opportunity.
 */
export function rankMatches(
  subject: MatchSubject,
  targets: readonly MatchTarget[],
  limit = 5,
): MatchResult[] {
  return targets
    .map((t) => scoreMatch(subject, t))
    .filter((r) => r.score >= BANDS.possible)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export type MatchDisposition =
  | { action: "create"; reason: string }
  | { action: "review"; reason: string; candidates: MatchResult[] }
  | { action: "attach"; reason: string; candidate: MatchResult };

/**
 * What the pipeline should DO with an item.
 *
 * `attach` is returned only for an exact identity match, and even then the
 * review queue pre-selects rather than commits: promotion is always a human
 * action. Anything in the strong or possible bands is `review` with the
 * candidates attached, never an automatic merge.
 */
export function disposition(subject: MatchSubject, targets: readonly MatchTarget[]): MatchDisposition {
  const ranked = rankMatches(subject, targets);
  if (ranked.length === 0) {
    return { action: "create", reason: "No existing property scored above the match threshold." };
  }

  const [best] = ranked;
  if (best.band === "exact") {
    return {
      action: "attach",
      reason: "Exact address match - pre-selected for confirmation.",
      candidate: best,
    };
  }

  return {
    action: "review",
    reason: `${ranked.length} possible match${ranked.length === 1 ? "" : "es"} found.`,
    candidates: ranked,
  };
}

/** Percentage form for the review UI: 0.9234 -> 92. */
export function matchPercent(score: number): number {
  return Math.round(score * 100);
}
