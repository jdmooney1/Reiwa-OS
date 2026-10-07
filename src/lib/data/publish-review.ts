// ============================================================================
// Publish review - the server half of "show me what I am about to publish".
// ----------------------------------------------------------------------------
// getPublishReview() assembles, under the caller's own RLS, what going live would
// change: the diff against the version investors see now, who would see it, and a
// small set of warnings. It also derives two values the confirmation depends on:
//
//   phrase  the sentence the person must type back, built from the diff and the
//           audience (see lib/publication/review).
//   digest  a hash of everything the screen showed. The publish action receives
//           it back and recomputes it; if anything moved between "screen opened"
//           and "button pressed" (the live version, the documents, who is
//           entitled) the publish is refused and the person is sent back to read
//           the new picture.
//
// assertPublishConfirmed() is what the server action calls before publishing.
// It is a speed bump on one person at a time. It is not separation of duties:
// the person who is shown the diff and types the sentence is free to be the
// person who wrote the content.
// ============================================================================
import { createHash } from "node:crypto";
import { withSession, type Session } from "@/lib/db/client";
import {
  listPublicationVersions, listPublicationDocuments,
  type PublicationVersion, type PublicationDocument,
} from "@/lib/data/investor-portal";
import { listEntitlementsForPublication } from "@/lib/data/admin-portal";
import { AppError } from "@/lib/errors";
import {
  diffVersions, confirmationPhrase, phraseMatches,
  type ReviewVersion, type ReviewDocument, type ReviewDiff,
} from "@/lib/publication/review";

export interface ReviewAudienceRow {
  investorOrgId: string;
  organisation: string;
  documentLevel: string;
}

export interface PublishReview {
  versionId: string;
  publicationId: string;
  versionNumber: number;
  status: PublicationVersion["status"];
  title: string;
  liveVersionNumber: number | null;
  diff: ReviewDiff;
  /** Organisations that will be able to open this version the moment it is published. */
  audience: ReviewAudienceRow[];
  /** Entitled but not able to see it right now (hidden, or the organisation is not active). */
  notAbleToSee: { organisation: string; reason: string }[];
  warnings: ReviewWarning[];
  /** The sentence to type. Names the problem when the Overview is the internal summary. */
  phrase: string;
  digest: string;
}

export interface ReviewWarning {
  code: "overview_blank" | "overview_matches_internal" | "no_audience";
  message: string;
}

function toReview(v: PublicationVersion): ReviewVersion {
  return {
    title: v.title, headline: v.headline, overview: v.overview, highlights: v.highlights,
    market: v.market, submarket: v.submarket, city: v.city, country: v.country,
    assetType: v.assetType, strategy: v.strategy, currency: v.currency,
    holdPeriodYears: v.holdPeriodYears, headlinePrice: v.headlinePrice, targetNiy: v.targetNiy,
    targetIrr: v.targetIrr, targetEquityMultiple: v.targetEquityMultiple,
    sizeSqft: v.sizeSqft, sizeSqm: v.sizeSqm,
  };
}

function toReviewDoc(d: PublicationDocument): ReviewDocument {
  return {
    storagePath: d.storagePath, title: d.title, category: d.category,
    accessLevel: d.accessLevel, fileName: d.fileName, sizeBytes: d.sizeBytes,
  };
}

const squash = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * The internal summary is never copied into an investor draft any more, but a
 * person can still paste it in by hand. When the Overview about to go live is the
 * internal summary, or contains a passage of it, say so, because that is exactly
 * the mistake this whole screen exists to catch.
 */
export function overviewEchoesInternal(overview: string | null, internal: string | null): boolean {
  if (!overview || !internal) return false;
  const o = squash(overview);
  const i = squash(internal);
  if (!o || !i) return false;
  return o === i || (i.length >= 40 && o.includes(i)) || (o.length >= 40 && i.includes(o));
}

export async function getPublishReview(
  session: Session, versionId: string,
): Promise<PublishReview | null> {
  const located = await withSession(session, async (tx) => {
    const { rows } = await tx.query<{ publication_id: string }>(
      "select publication_id from publication_versions where version_id = $1", [versionId]);
    if (!rows[0]) return null;
    const publicationId = rows[0].publication_id;
    const active = await tx.query<{ active_version_id: string | null }>(
      "select active_version_id from investor_publications where publication_id = $1", [publicationId]);
    // The internal summary lives on the opportunity, reachable only through the
    // private mapping. Read here for the warning below and for nothing else.
    const internal = await tx.query<{ summary: string | null }>(
      `select o.summary
         from publication_sources ps join opportunities o on o.opportunity_id = ps.opportunity_id
        where ps.publication_id = $1`, [publicationId]);
    return {
      publicationId,
      activeVersionId: active.rows[0]?.active_version_id ?? null,
      internalSummary: internal.rows[0]?.summary ?? null,
    };
  });
  if (!located) return null;

  const versions = await listPublicationVersions(session, located.publicationId);
  const candidate = versions.find((v) => v.versionId === versionId);
  if (!candidate) return null;
  const live = located.activeVersionId && located.activeVersionId !== versionId
    ? versions.find((v) => v.versionId === located.activeVersionId) ?? null
    : null;

  const [candidateDocs, liveDocs, entitlements] = await Promise.all([
    listPublicationDocuments(session, candidate.versionId),
    live ? listPublicationDocuments(session, live.versionId) : Promise.resolve([] as PublicationDocument[]),
    listEntitlementsForPublication(session, located.publicationId),
  ]);

  const diff = diffVersions(
    live ? toReview(live) : null, toReview(candidate),
    liveDocs.map(toReviewDoc), candidateDocs.map(toReviewDoc),
  );

  const audience: ReviewAudienceRow[] = [];
  const notAbleToSee: { organisation: string; reason: string }[] = [];
  for (const e of entitlements) {
    if (!e.isVisible) notAbleToSee.push({ organisation: e.investorOrgName, reason: "access is hidden" });
    else if (e.investorOrgStatus !== "active") {
      notAbleToSee.push({ organisation: e.investorOrgName, reason: `organisation is ${e.investorOrgStatus}` });
    } else {
      audience.push({
        investorOrgId: e.investorOrgId, organisation: e.investorOrgName, documentLevel: e.documentAccessLevel,
      });
    }
  }

  const warnings: ReviewWarning[] = [];
  let echoesInternal = false;
  if (!candidate.overview || !candidate.overview.trim()) {
    warnings.push({
      code: "overview_blank",
      message: "The Overview is blank. Investors will see a headline and figures with no written description.",
    });
  } else if (overviewEchoesInternal(candidate.overview, located.internalSummary)) {
    echoesInternal = true;
    warnings.push({
      code: "overview_matches_internal",
      message: "The Overview matches the internal summary on the opportunity. That text was written for the team, not for investors. Read it again before this goes out.",
    });
  }
  if (audience.length === 0) {
    warnings.push({
      code: "no_audience",
      message: "No investor organisation can see this publication yet. Publishing it changes nothing on any investor's screen until access is granted.",
    });
  }

  const phrase = confirmationPhrase(
    candidate.versionNumber, diff.changeCount, audience.length, { echoesInternalSummary: echoesInternal });
  const digest = createHash("sha256").update(JSON.stringify({
    versionId: candidate.versionId,
    liveVersionId: live?.versionId ?? null,
    status: candidate.status,
    candidate: toReview(candidate),
    live: live ? toReview(live) : null,
    candidateDocs: candidateDocs.map(toReviewDoc),
    liveDocs: liveDocs.map(toReviewDoc),
    audience: audience.map((a) => [a.investorOrgId, a.documentLevel]).sort(),
  })).digest("hex");

  return {
    versionId: candidate.versionId,
    publicationId: located.publicationId,
    versionNumber: candidate.versionNumber,
    status: candidate.status,
    title: candidate.title,
    liveVersionNumber: live?.versionNumber ?? null,
    diff, audience, notAbleToSee, warnings, phrase, digest,
  };
}

/**
 * The gate the publish action goes through. Throws an AppError, written for a
 * person, on any of: the version is not in review, the screen they read is no
 * longer true, or the sentence typed is not the sentence the screen asked for.
 */
export async function assertPublishConfirmed(
  session: Session, versionId: string, confirmation: { digest: string; typed: string } | null | undefined,
): Promise<PublishReview> {
  // A request that never went through the review screen carries no confirmation at
  // all. That is the same refusal as a wrong one, not a crash.
  const digest = typeof confirmation?.digest === "string" ? confirmation.digest : "";
  const typed = typeof confirmation?.typed === "string" ? confirmation.typed : "";
  const review = await getPublishReview(session, versionId);
  if (!review) throw new AppError("That version could not be found, or you cannot publish it.");
  if (review.status !== "in_review") {
    throw new AppError("Only a version that has been submitted for review can be published.");
  }
  if (!digest || digest !== review.digest) {
    throw new AppError(
      "This publication changed after you opened the review screen. Reload it and read what is changing before publishing.");
  }
  if (!phraseMatches(typed, review.phrase)) {
    throw new AppError("The confirmation sentence does not match. Type it exactly as shown.");
  }
  return review;
}
