// ============================================================================
// Properties — resolve-or-create identity, and match candidate lookup.
// ----------------------------------------------------------------------------
// A property is the DURABLE physical identity. The same building recurring in
// the pipeline in 2025, 2026 and 2027 is one property with three opportunities
// hanging off it, which is what makes the timeline worth having.
//
// Before this module, createOpportunity() inserted a fresh `properties` row on
// every call, so the property-centric model documented in docs/10 was not
// actually true in the data (docs/17 D1). resolveProperty() is the fix, and
// every write path must go through it.
//
// Every call runs under withSession, so RLS enforces org isolation.
// ============================================================================
import { withSession, type Session, type Queryable } from "@/lib/db/client";
import { num, str } from "@/lib/data/coerce";
import {
  propertyIdentityKey, normaliseAddress, normalisePostcode, normaliseCountry, findPostcode,
} from "@/lib/ingestion/normalise";
import { rankMatches, type MatchResult, type MatchTarget } from "@/lib/ingestion/match";

export interface PropertyInput {
  orgId: string;
  name: string;
  address?: string | null;
  postcode?: string | null;
  city?: string | null;
  country?: string | null;
  market?: string | null;
  submarket?: string | null;
  assetType?: string | null;
  /** When the SOURCE first evidenced this property, not when the row was written. */
  firstSeenAt?: string | null;
}

export interface ResolvedProperty {
  propertyId: string;
  identityKey: string | null;
  created: boolean;
  /** True when an existing property was found and its blanks were filled in. */
  enriched: boolean;
}

/**
 * Find the property this input describes, or create it.
 *
 * Matching is by identity key alone — postcode plus street part. A null key
 * (too little address detail) ALWAYS creates, and never merges: a missed match
 * becomes a review task, whereas a false match silently fuses two buildings and
 * corrupts the history of both.
 *
 * Existing rows are enriched, never overwritten: a blank column is filled, a
 * populated one is left alone. Conflicting values are the provenance ledger's
 * problem in Phase 2, not something to resolve by clobbering.
 */
export async function resolveProperty(
  tx: Queryable, input: PropertyInput,
): Promise<ResolvedProperty> {
  const postcode = normalisePostcode(input.postcode) ?? normalisePostcode(input.address);
  const addressNormalised = normaliseAddress(input.address) || null;
  const identityKey = propertyIdentityKey({
    address: input.address, postcode: postcode ?? input.postcode,
    name: input.name, city: input.city,
  });

  const countryCode = normaliseCountry(input.country)
    ?? (findPostcode(postcode ?? input.address)?.country ?? null);

  if (identityKey) {
    const existing = await tx.query<{ property_id: string }>(
      "select property_id from properties where org_id = $1 and identity_key = $2",
      [input.orgId, identityKey]);

    if (existing.rows[0]) {
      const propertyId = existing.rows[0].property_id;
      // Fill blanks only. coalesce keeps whatever is already recorded.
      await tx.query(
        `update properties set
           address       = coalesce(address, $2),
           postcode      = coalesce(postcode, $3),
           city          = coalesce(city, $4),
           country       = coalesce(country, $5),
           country_code  = coalesce(country_code, $6),
           market        = coalesce(market, $7),
           submarket     = coalesce(submarket, $8),
           address_normalised = coalesce(address_normalised, $9),
           last_seen_at  = greatest(coalesce(last_seen_at, now()), now())
         where property_id = $1`,
        [propertyId, str(input.address), postcode, str(input.city), str(input.country),
         countryCode, str(input.market), str(input.submarket), addressNormalised]);
      return { propertyId, identityKey, created: false, enriched: true };
    }
  }

  const inserted = await tx.query<{ property_id: string }>(
    `insert into properties(org_id, name, address, postcode, city, country, country_code,
       market, submarket, asset_type, address_normalised, identity_key, first_seen_at, last_seen_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, coalesce($13::timestamptz, now()), now())
     returning property_id`,
    [input.orgId, input.name, str(input.address), postcode, str(input.city), str(input.country),
     countryCode, str(input.market), str(input.submarket), input.assetType ?? "other",
     addressNormalised, identityKey, input.firstSeenAt ?? null]);

  return { propertyId: inserted.rows[0].property_id, identityKey, created: true, enriched: false };
}

/** Session-scoped wrapper for callers outside an existing transaction. */
export async function resolvePropertyFor(
  session: Session, input: PropertyInput,
): Promise<ResolvedProperty> {
  return withSession(session, (tx) => resolveProperty(tx, input));
}

// ---- Candidate lookup ------------------------------------------------------
export interface PropertyCandidate extends MatchTarget {
  propertyId: string;
  opportunityId: string | null;
  opportunityName: string | null;
  stage: string | null;
  status: string | null;
  lastSeenAt: string | null;
}

/**
 * Narrow the search to plausible candidates in SQL, then score them in
 * TypeScript. The database is good at "same postcode or similar name"; the
 * weighting and the banding belong in one unit-tested place.
 */
export async function findCandidates(
  tx: Queryable,
  orgId: string,
  subject: { address?: string | null; postcode?: string | null; name?: string | null; city?: string | null },
  limit = 25,
): Promise<PropertyCandidate[]> {
  const postcode = normalisePostcode(subject.postcode) ?? normalisePostcode(subject.address);
  const compact = postcode ? postcode.replace(/\s/g, "").toUpperCase() : null;
  const outward = findPostcode(postcode ?? subject.address)?.outward ?? null;
  const addressNormalised = normaliseAddress(subject.address) || null;
  const name = subject.name ?? null;

  const { rows } = await tx.query<Record<string, unknown>>(
    `select p.property_id, p.name, p.address, p.postcode, p.city,
            p.identity_key, p.last_seen_at,
            o.opportunity_id, o.name as opportunity_name, o.stage, o.status,
            o.broker_name, o.target_price
       from properties p
       left join lateral (
         select o.opportunity_id, o.name, o.stage, o.status, o.broker_name, o.target_price
           from opportunities o
          where o.property_id = p.property_id
          order by o.updated_at desc
          limit 1) o on true
      where p.org_id = $1
        and (
          ($2::text is not null and upper(replace(p.postcode, ' ', '')) = $2)
          or ($3::text is not null and upper(replace(p.postcode, ' ', '')) like $3 || '%')
          or ($4::text is not null and p.address_normalised % $4)
          or ($5::text is not null and p.name % $5)
        )
      limit $6`,
    [orgId, compact, outward, addressNormalised, name, limit]);

  return rows.map((r) => ({
    propertyId: r.property_id as string,
    opportunityId: (r.opportunity_id as string) ?? null,
    opportunityName: str(r.opportunity_name),
    name: str(r.name),
    address: str(r.address),
    postcode: str(r.postcode),
    city: str(r.city),
    broker: str(r.broker_name),
    price: num(r.target_price),
    identityKey: str(r.identity_key),
    stage: str(r.stage),
    status: str(r.status),
    lastSeenAt: str(r.last_seen_at),
    label: str(r.opportunity_name) ?? str(r.name) ?? "Untitled property",
  }));
}

/** Candidates, scored and banded, best first. */
export async function rankCandidates(
  tx: Queryable,
  orgId: string,
  subject: { address?: string | null; postcode?: string | null; name?: string | null;
             city?: string | null; broker?: string | null; price?: number | null },
): Promise<MatchResult[]> {
  const candidates = await findCandidates(tx, orgId, subject);
  return rankMatches(subject, candidates);
}
