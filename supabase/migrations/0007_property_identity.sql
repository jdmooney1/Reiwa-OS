-- ============================================================================
-- 0007 — Property identity, longitudinal events, three-axis status
-- ----------------------------------------------------------------------------
-- Three things, all prerequisites for bulk import (see docs/17 §C.2, §D1, §D2):
--
--   1. properties gains the columns deduplication needs (postcode, normalised
--      address, identity_key) and a unique index to enforce it. Until now
--      createOpportunity inserted a fresh property on every call, so the
--      property-centric model in docs/10 was not actually true in the data.
--      Importing 500 rows against that would create 500 orphan properties.
--
--   2. property_events — the longitudinal spine. Events hang off the PROPERTY,
--      not the opportunity, which is what makes a 2027 relaunch part of the
--      same history as a 2025 campaign. opportunity_id is nullable and records
--      which campaign an event belonged to.
--
--   3. The status axes. `stage` and `status` are extended rather than replaced,
--      and market_status / reiwa_position are added alongside, so the database
--      can distinguish "Reiwa passed" from "the vendor withdrew" and "Reiwa is
--      under offer" from "somebody else is".
--
-- Security posture follows 0002 and 0005 exactly: org-scoped RLS, no investor
-- policy of any kind (an investor's current_org_ids() is empty, so has_org is
-- false and their SELECT matches no permissive policy), and anon/PUBLIC
-- privileges revoked rather than left at Supabase's defaults.
-- ============================================================================

-- Trigram matching for fuzzy property-name and address lookup. Available on
-- Supabase; the extension lands in `extensions`, which is already on the
-- search_path for the roles that need it.
create extension if not exists pg_trgm;

-- ---- 1. Property identity --------------------------------------------------
alter table properties
  add column if not exists postcode           text,
  add column if not exists submarket          text,
  add column if not exists country_code       text,
  add column if not exists address_normalised text,
  add column if not exists identity_key       text,
  add column if not exists first_seen_at      timestamptz not null default now(),
  add column if not exists last_seen_at       timestamptz;

-- The deduplication constraint. Partial, because a property with too little
-- address detail to key is legitimate: it simply never auto-matches, which is
-- the safe direction (a missed match is a review task; a false match silently
-- merges two buildings).
create unique index if not exists properties_identity_key
  on properties(org_id, identity_key) where identity_key is not null;

create index if not exists properties_postcode
  on properties(org_id, upper(replace(postcode, ' ', ''))) where postcode is not null;

create index if not exists properties_name_trgm
  on properties using gin (name gin_trgm_ops);
create index if not exists properties_address_trgm
  on properties using gin (address_normalised gin_trgm_ops);

-- ---- 2. Status axes --------------------------------------------------------
-- `stage` gains 'inbox' (arrived, not yet screened) and 'investor_ready' (the
-- gate in front of the existing publication flow). 'new' is retained so rows
-- written before this migration stay valid.
alter table opportunities drop constraint if exists opportunities_stage_check;
alter table opportunities add constraint opportunities_stage_check
  check (stage in ('new','inbox','screening','underwriting','ic','investor_ready','approved','acquired'));

-- `status` gains 'watchlist': tracked, but not being progressed.
alter table opportunities drop constraint if exists opportunities_status_check;
alter table opportunities add constraint opportunities_status_check
  check (status in ('active','watchlist','rejected','withdrawn','lost','converted'));

-- What happened to the ASSET in the market, independent of Reiwa's view of it.
alter table opportunities
  add column if not exists market_status text not null default 'unknown',
  add column if not exists reiwa_position text not null default 'none',
  -- When the opportunity first entered Reiwa OS, as distinct from created_at,
  -- which is when the row was written. A 2025 deal imported in 2026 keeps its
  -- real date.
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_source_at timestamptz;

alter table opportunities drop constraint if exists opportunities_market_status_check;
alter table opportunities add constraint opportunities_market_status_check
  check (market_status in ('available','under_offer','sold','withdrawn','unknown'));

alter table opportunities drop constraint if exists opportunities_reiwa_position_check;
alter table opportunities add constraint opportunities_reiwa_position_check
  check (reiwa_position in ('none','bid_submitted','under_offer','exclusive','legals'));

create index if not exists idx_opportunities_market_status
  on opportunities(org_id, market_status);
create index if not exists idx_opportunities_property
  on opportunities(org_id, property_id);

-- ---- 3. Longitudinal property events ---------------------------------------
create table if not exists property_events (
  event_id       uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(org_id) on delete cascade,
  -- The durable spine. An event belongs to a PROPERTY first and a marketing
  -- campaign second.
  property_id    uuid not null references properties(property_id) on delete cascade,
  opportunity_id uuid references opportunities(opportunity_id) on delete set null,

  event_type     text not null,
  -- When it happened in the market. May predate recorded_at by years for
  -- imported history.
  occurred_at    timestamptz not null default now(),
  recorded_at    timestamptz not null default now(),

  headline       text not null,
  detail         text,
  numeric_value  numeric(18,2),
  previous_value numeric(18,2),
  currency       text,

  -- Provenance. The referenced tables arrive in later phases, so these are
  -- plain uuids for now and gain their foreign keys with the tables.
  source_kind        text,
  source_document_id uuid,
  source_email_id    uuid,
  ingestion_item_id  uuid,

  created_by     uuid references profiles(user_id),
  constraint property_events_type_check check (event_type in (
    'first_seen', 'price_quoted', 'price_changed', 'income_revised',
    'broker_changed', 'brochure_received', 'email_received', 'tenancy_revised',
    'market_status_changed', 'withdrawn', 'relaunched', 'sold', 'failed_sale',
    'bid_submitted', 'reiwa_passed', 'reiwa_stage_changed', 'investor_approached',
    'published', 'imported', 'note'))
);

create index if not exists idx_property_events_property
  on property_events(property_id, occurred_at desc);
create index if not exists idx_property_events_opportunity
  on property_events(opportunity_id, occurred_at desc);
create index if not exists idx_property_events_org
  on property_events(org_id, occurred_at desc);

-- ---- 4. Backfill -----------------------------------------------------------
-- Existing seeded properties get a normalised address and an identity key so
-- they participate in matching immediately. Done in SQL rather than in the
-- application because it must be atomic with the unique index above.
--
-- This is a deliberately conservative subset of src/lib/ingestion/normalise.ts:
-- lower case, punctuation stripped, whitespace collapsed. It does not expand
-- street abbreviations. Rows it keys differently from the TypeScript
-- normaliser simply fail to auto-match and go to review, which is the safe
-- direction; the resolve-or-create path writes the canonical key from then on.
update properties
   set address_normalised = coalesce(address_normalised,
         nullif(regexp_replace(lower(coalesce(address, name, '')), '[^a-z0-9]+', ' ', 'g'), ' ')),
       country_code = coalesce(country_code,
         case lower(coalesce(country, ''))
           when 'united kingdom' then 'GB'
           when 'uk' then 'GB'
           when 'england' then 'GB'
           when 'netherlands' then 'NL'
           when 'the netherlands' then 'NL'
           when 'japan' then 'JP'
           when 'germany' then 'DE'
           when 'france' then 'FR'
           else null
         end),
       last_seen_at = coalesce(last_seen_at, created_at)
 where address_normalised is null or country_code is null or last_seen_at is null;

-- Every existing opportunity gets its "first seen" anchor and a first_seen
-- event, so the timeline is complete from the day this ships rather than only
-- for records created afterwards.
update opportunities
   set first_seen_at = coalesce(first_seen_at, created_at)
 where first_seen_at is null;

insert into property_events (org_id, property_id, opportunity_id, event_type,
                             occurred_at, recorded_at, headline, source_kind)
select o.org_id, o.property_id, o.opportunity_id, 'first_seen',
       o.created_at, now(),
       'Opportunity recorded in Reiwa OS', 'reiwa_manual'
  from opportunities o
 where o.property_id is not null
   and not exists (
     select 1 from property_events e
      where e.opportunity_id = o.opportunity_id and e.event_type = 'first_seen');

-- ---- 5. RLS ----------------------------------------------------------------
-- Same loop as 0002. No investor policy is written, so an investor session
-- matches no permissive policy on this table and reads nothing.
do $$
declare t text;
begin
  foreach t in array array['property_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select to authenticated using (app.has_org(org_id))', t, t);
    execute format('drop policy if exists %I_insert on %I', t, t);
    execute format('create policy %I_insert on %I for insert to authenticated with check (app.has_org(org_id) and app.can_write())', t, t);
    execute format('drop policy if exists %I_update on %I', t, t);
    execute format('create policy %I_update on %I for update to authenticated using (app.has_org(org_id) and app.can_write()) with check (app.has_org(org_id) and app.can_write())', t, t);
    -- No delete policy: the timeline is the product. Events are corrected by
    -- appending, not by erasing.
    execute format('revoke all on %I from anon, public', t);
    execute format('grant select, insert, update on %I to authenticated', t);
  end loop;
end $$;
