-- ============================================================================
-- 0013 — Property identity: market-scoped, address-led, postcode as data
-- ----------------------------------------------------------------------------
-- Amends 0012 in three ways, all of them consequences of what the real pipeline
-- load turned out to contain.
--
-- 1. THE KEY IS NOW SCOPED BY MARKET.
--    0012 scoped identity to (org_id, identity_key) and let the key itself
--    carry location, because a postcode-led key encodes the city. Not one of
--    the 132 opportunities in the first load carries a postcode, so every key
--    is address-led and encodes no location at all — and "5 Pollen Street" is a
--    plausible address in more than one city. Market carries that instead, and
--    it is coalesced so a property with no market still dedupes.
--
-- 2. THE POSTCODE IS NO LONGER PART OF THE KEY.
--    It stays on the row as an enrichable attribute. This is the important one:
--    the deferred email-extraction phase reads sources that DO carry postcodes
--    ("24-26 Spring Street, Paddington, London W2 1JA"), and a postcode-led key
--    form would mint a second identity for every building already loaded
--    address-led — duplicating the entire pipeline rather than enriching it.
--    One key form, address-led, whatever the source knows.
--
-- 3. THE KEYS THEMSELVES CHANGED SHAPE, so every existing one is cleared.
--    src/lib/ingestion/normalise.ts gained two corrections that alter output:
--      * "St" is read as Saint when it precedes a capitalised name and a real
--        street type follows ("12 St George Street"). It was being expanded to
--        "Street", which reduced that address to the key "12street" — the
--        street name gone, and one house number away from silently merging
--        with "12 St Mary Axe". Five addresses in the first load are affected;
--        they avoided collision only because their house numbers differ.
--      * The house number may LEAD or TRAIL. Dutch addresses put it last
--        ("Wolvenstraat 23"), and the old rule stopped at the street type —
--        the first token in Dutch — so the number was discarded and
--        "Wolvenstraat 23" was indistinguishable from "Wolvenstraat 99". Only
--        0012's digit guard stopped them merging. 22 of the 23 Amsterdam rows
--        were affected.
--    Any key written under 0012 may therefore be wrong rather than merely
--    stale, so they are cleared and rebuilt by db:backfill-property-identity,
--    which refuses to key colliding rows and reports them instead.
--
-- Nothing here drops a column or a row. The postcode column, property_events
-- and every policy from 0012 are untouched.
-- ============================================================================

-- ---- 1. Clear keys written under the superseded normalisation --------------
-- Deliberately not a recompute: this migration cannot call the TypeScript
-- normaliser, and a SQL reimplementation is the second normaliser 0012 refused
-- to create. Cleared keys mean those rows do not auto-match until the backfill
-- runs, which is the safe direction.
update properties set identity_key = null where identity_key is not null;

-- ---- 2. Re-scope the uniqueness -------------------------------------------
drop index if exists properties_identity_key;

-- coalesce(market, '') so a property with no market still participates:
-- NULL never equals NULL in a unique index, so two unkeyed-market duplicates
-- would both be accepted.
create unique index if not exists properties_identity_key
  on properties(org_id, coalesce(market, ''), identity_key)
  where identity_key is not null;

comment on column properties.identity_key is
  'Normalised street address from src/lib/ingestion/normalise.ts: house number '
  '(leading or trailing) composed with the street name. Address-led only — the '
  'postcode is NOT part of it, so a source that supplies one enriches the '
  'property rather than minting a second identity. Unique per (org_id, market). '
  'Null when the address carries no house number, which identifies a street '
  'rather than a building; such rows never auto-match, and that is deliberate.';

comment on column properties.postcode is
  'Enrichable attribute, never part of the identity key. The first pipeline '
  'load carried none; later sources do.';
