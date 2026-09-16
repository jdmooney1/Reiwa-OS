-- ============================================================================
-- 0012 — Property identity and the longitudinal record
-- ----------------------------------------------------------------------------
-- `properties` has been the durable physical identity since 0002, and the
-- lifecycle in docs/10 is built on the claim that the same building recurring
-- in the pipeline is ONE property with several opportunities hanging off it.
--
-- That claim was not true in the data. `createOpportunity` inserted a fresh
-- `properties` row on every call, so 16 Conduit Street quoted in 2025 and
-- relaunched in 2027 produced two unrelated properties with no shared history —
-- and nothing in the schema could tell they were the same asset. The record
-- that was supposed to answer "has this been round before?" could only ever
-- answer "no".
--
-- This migration gives the table what identity requires:
--
--   1. The columns matching needs — postcode, a normalised address, and a
--      derived identity_key — with a PARTIAL unique index enforcing it.
--   2. `property_events`, the longitudinal spine. Events hang off the PROPERTY
--      rather than the opportunity, which is what lets a later campaign join
--      the same history instead of starting a new one.
--
-- WHY THE UNIQUE INDEX IS PARTIAL. A property with too little address detail to
-- key is legitimate — a brochure titled "Mayfair Asset" with no address is a
-- real thing to record. Those rows carry a null key, collide with nothing, and
-- always create. That is the safe direction: a missed match becomes a review
-- task, whereas a false match silently fuses two buildings and corrupts the
-- history of both, irreversibly and invisibly.
--
-- WHY identity_key IS NOT BACKFILLED HERE. The key is computed by
-- src/lib/ingestion/normalise.ts — street-type expansion, unit/floor noise
-- removal, accent folding. Reimplementing that in SQL would create a second
-- normaliser that drifts from the first, and two implementations of an identity
-- rule is worse than one implementation applied late. Existing rows are keyed
-- by `npm run db:backfill-property-identity`, which uses the one normaliser and
-- REFUSES to key rows that would collide, reporting them instead — the same
-- posture 0010 took on authorship. Until then an unkeyed row simply never
-- auto-matches, which is the safe direction above.
--
-- Privileges follow 0007: `anon` is revoked explicitly and `authenticated` is
-- granted by name, because 0007 removed the blanket default and a table without
-- an explicit grant is unreachable.
-- ============================================================================

-- Trigram indexes for fuzzy name and address lookup when narrowing candidates.
create extension if not exists pg_trgm;

-- ---- 1. Identity -----------------------------------------------------------
alter table properties
  add column if not exists postcode           text,
  add column if not exists submarket          text,
  add column if not exists country_code       text,
  -- Comparable form of `address`: lower case, accents folded, abbreviations
  -- expanded, unit/floor noise removed, postcode stripped.
  add column if not exists address_normalised text,
  -- Postcode-led where a postcode exists, address-led otherwise. Null when
  -- there is not enough to identify a building at all.
  add column if not exists identity_key       text,
  -- When the SOURCE first evidenced this property, as distinct from created_at,
  -- which is when the row was written. A 2025 deal recorded in 2026 keeps its
  -- real date.
  add column if not exists first_seen_at      timestamptz not null default now(),
  add column if not exists last_seen_at       timestamptz;

comment on column properties.identity_key is
  'Deduplication key derived by src/lib/ingestion/normalise.ts. Null means the '
  'row carries too little address detail to identify a building; such rows never '
  'auto-match, which is deliberate. Backfilled by db:backfill-property-identity.';

create unique index if not exists properties_identity_key
  on properties(org_id, identity_key) where identity_key is not null;

create index if not exists properties_postcode
  on properties(org_id, upper(replace(postcode, ' ', ''))) where postcode is not null;

create index if not exists properties_name_trgm
  on properties using gin (name gin_trgm_ops);
create index if not exists properties_address_trgm
  on properties using gin (address_normalised gin_trgm_ops);

-- ---- 2. The longitudinal spine ---------------------------------------------
create table if not exists property_events (
  event_id       uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(org_id) on delete cascade,
  -- The durable anchor. An event belongs to a PROPERTY first and to a marketing
  -- campaign second, so deleting an opportunity detaches its events rather than
  -- erasing what was learned about the building.
  property_id    uuid not null references properties(property_id) on delete cascade,
  opportunity_id uuid references opportunities(opportunity_id) on delete set null,

  event_type     text not null check (event_type in (
    'first_seen', 'price_quoted', 'price_changed', 'income_revised',
    'broker_changed', 'brochure_received', 'email_received', 'tenancy_revised',
    'market_status_changed', 'withdrawn', 'relaunched', 'sold', 'failed_sale',
    'bid_submitted', 'reiwa_passed', 'reiwa_stage_changed', 'investor_approached',
    'published', 'imported', 'note')),

  -- When it happened in the MARKET. May predate recorded_at by years for
  -- history captured after the fact.
  occurred_at    timestamptz not null default now(),
  recorded_at    timestamptz not null default now(),

  headline       text not null,
  detail         text,
  numeric_value  numeric(18,2),
  previous_value numeric(18,2),
  currency       text,

  -- Provenance. `source_kind` says what kind of thing asserted this; the id
  -- columns are reserved for the source tables a later phase adds, and are
  -- plain uuids until those tables exist to be referenced.
  source_kind        text check (source_kind in (
    'broker_email', 'brochure', 'spreadsheet', 'reiwa_manual',
    'reiwa_assumption', 'underwriting', 'public_record')),
  source_document_id uuid,
  source_email_id    uuid,
  ingestion_item_id  uuid,

  created_by     uuid references profiles(user_id),

  -- Authorship, in the shape 0010 established. An event is either something a
  -- PERSON recorded or something derived from a SOURCE; it may not be neither,
  -- because an event attributed to nothing is indistinguishable from one whose
  -- attribution was lost. Unlike the tables in 0010, `created_by` alone cannot
  -- be required: an event derived from an inbound broker email has a source and
  -- genuinely has no author.
  constraint property_events_attribution_check
    check (created_by is not null or source_kind is not null)
);

comment on table property_events is
  'The longitudinal record of a property across every marketing campaign: when '
  'it came to market, who marketed it, how pricing moved, what happened to the '
  'sale, and whether it returned. Append-only by privilege — no DELETE is '
  'granted, so a wrong event is corrected by recording another.';

create index if not exists idx_property_events_property
  on property_events(property_id, occurred_at desc);
create index if not exists idx_property_events_opportunity
  on property_events(opportunity_id, occurred_at desc);
create index if not exists idx_property_events_org
  on property_events(org_id, occurred_at desc);

-- ---- 3. Backfill what can be derived without a second normaliser -----------
-- `address_normalised` here is a deliberately conservative subset of the
-- TypeScript normaliser: lower case, punctuation collapsed. It does NOT expand
-- street abbreviations, so it is only ever used to narrow trigram candidates —
-- never to decide identity. identity_key is left null (see the header) and is
-- written by the backfill script and by resolveProperty from then on.
update properties
   set address_normalised = coalesce(
         address_normalised,
         nullif(trim(regexp_replace(lower(coalesce(address, '')), '[^a-z0-9]+', ' ', 'g')), '')),
       country_code = coalesce(country_code, case lower(coalesce(country, ''))
           when 'united kingdom'   then 'GB'
           when 'uk'               then 'GB'
           when 'england'          then 'GB'
           when 'scotland'         then 'GB'
           when 'wales'            then 'GB'
           when 'netherlands'      then 'NL'
           when 'the netherlands'  then 'NL'
           when 'japan'            then 'JP'
           when 'germany'          then 'DE'
           when 'france'           then 'FR'
           else null end),
       last_seen_at = coalesce(last_seen_at, created_at),
       first_seen_at = least(first_seen_at, created_at)
 where address_normalised is null
    or country_code is null
    or last_seen_at is null;

-- Open the timeline for every opportunity already on file, so the record is
-- complete from today rather than only for whatever is created next.
insert into property_events (org_id, property_id, opportunity_id, event_type,
                             occurred_at, headline, detail, source_kind, created_by)
select o.org_id, o.property_id, o.opportunity_id, 'first_seen',
       o.created_at,
       'Opportunity logged in Reiwa OS',
       nullif(concat_ws(' ', 'Sourced as', nullif(o.source_type, 'other')), 'Sourced as'),
       'reiwa_manual',
       o.created_by
  from opportunities o
 where o.property_id is not null
   and not exists (select 1
                     from property_events e
                    where e.opportunity_id = o.opportunity_id
                      and e.event_type = 'first_seen');

-- ---- 4. RLS and privileges -------------------------------------------------
-- The 0002 loop, minus DELETE: the timeline is the product, and a record you
-- can quietly erase is not one. No investor policy is written, so an investor
-- session — which holds no `organization_members` row and therefore no org ids —
-- matches no permissive policy here and reads nothing, by construction.
alter table property_events enable row level security;

drop policy if exists property_events_select on property_events;
create policy property_events_select on property_events for select to authenticated
  using (app.has_org(org_id));

drop policy if exists property_events_insert on property_events;
create policy property_events_insert on property_events for insert to authenticated
  with check (app.has_org(org_id) and app.can_write());

drop policy if exists property_events_update on property_events;
create policy property_events_update on property_events for update to authenticated
  using (app.has_org(org_id) and app.can_write())
  with check (app.has_org(org_id) and app.can_write());

-- 0007 removed the blanket default grant, so this table is unreachable until
-- named. DELETE is withheld deliberately; `anon` is revoked explicitly rather
-- than relying on that default having been set correctly elsewhere.
revoke all on property_events from anon, public;
grant select, insert, update on property_events to authenticated;
