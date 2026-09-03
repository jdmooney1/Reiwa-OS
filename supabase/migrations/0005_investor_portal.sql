-- ============================================================================
-- 0005 — Investment Portal data foundation (P1)
-- ----------------------------------------------------------------------------
-- A hard boundary between internal Reiwa OS data and investor-visible data.
--
--   internal:  organizations / opportunities / investment_cases / assets /
--              business_plans / transactions / performance_periods / valuations
--   provenance (admin only): publication_sources / publication_version_sources
--   investor:  investor_organizations / investor_contacts / investor_publications
--              / publication_versions / publication_documents /
--              publication_entitlements / investor_saved /
--              investor_activity_events / investor_requests
--
-- Nothing bridges the two at the permission level. An investor authenticates as
-- a Supabase Auth user that has NO `profiles` row and NO `organization_members`
-- row, so `app.current_org_ids()` is empty and `app.is_admin()` is false — every
-- internal policy already denies them. Their own access is derived here, in the
-- database, from `auth.uid()` alone: no organisation id, entitlement or document
-- tier is ever accepted from the application or from user metadata.
--
-- The link back to internal data lives in the PROVENANCE tables, which no
-- investor can read at all. Not one investor-readable row carries an internal
-- Reiwa OS identifier — not the publication, not the version, not the feed view.
-- The separation is structural: there is no internal id on those rows to leak,
-- rather than an id that policy happens to protect.
-- ============================================================================

-- ---- Investor tenancy ------------------------------------------------------
-- Deliberately NOT the internal `organizations` table. The two tenancy models
-- are separate so that an internal org membership can never imply portal access
-- and vice versa.
create table if not exists investor_organizations (
  investor_org_id uuid primary key default gen_random_uuid(),
  name            text not null,
  status          text not null default 'active'
                    check (status in ('active', 'suspended', 'closed')),
  -- Reference only, for admin reporting. No policy reads this column.
  linked_internal_organization_id uuid references organizations(org_id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists investor_organizations_name_key
  on investor_organizations (lower(name));

create table if not exists investor_contacts (
  investor_contact_id uuid primary key default gen_random_uuid(),
  investor_org_id     uuid not null references investor_organizations(investor_org_id) on delete cascade,
  email               text not null,
  name                text not null,
  title               text,
  is_active           boolean not null default true,
  -- Nullable: a contact may be provisioned before its Supabase Auth account
  -- exists. Until it is set, the contact can never resolve to a session.
  auth_user_id        uuid unique references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists investor_contacts_email_key
  on investor_contacts (lower(email));
create index if not exists idx_investor_contacts_org on investor_contacts(investor_org_id);

-- ---- Publication identity --------------------------------------------------
-- Carries no internal identifier of any kind. Which internal opportunity this
-- publication came from is recorded in publication_sources, below, which no
-- investor can read.
create table if not exists investor_publications (
  publication_id     uuid primary key default gen_random_uuid(),
  status             text not null default 'draft'
                       check (status in ('draft', 'published', 'withdrawn')),
  active_version_id  uuid,  -- FK added below, once publication_versions exists
  first_published_at timestamptz,
  last_published_at  timestamptz,
  created_by         uuid references profiles(user_id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---- Provenance: publication → internal opportunity (ADMIN ONLY) -----------
-- The private mapping. It is the only place the relationship exists, it is
-- readable by Reiwa admins alone, and it is projected by no investor-facing
-- view. `opportunity_id` is unique, which is what preserves the rule of one
-- publication identity per internal opportunity now that the column has left
-- the investor-readable row.
create table if not exists publication_sources (
  publication_id uuid primary key references investor_publications(publication_id) on delete cascade,
  opportunity_id uuid not null unique references opportunities(opportunity_id) on delete restrict,
  linked_by      uuid references profiles(user_id),
  linked_at      timestamptz not null default now()
);
create index if not exists idx_publication_sources_opportunity
  on publication_sources(opportunity_id);

-- ---- Versions --------------------------------------------------------------
-- A version is an INDEPENDENT snapshot. It is prefilled once from the internal
-- opportunity through the approved whitelist (app.opportunity_publication_source)
-- and thereafter has no live relationship to it: editing the opportunity cannot
-- reach these columns, and the row itself records nothing about where it came
-- from. That provenance — the fingerprint the admin UI uses to warn that the
-- internal record has moved on — lives in publication_version_sources, below.
create table if not exists publication_versions (
  version_id      uuid primary key default gen_random_uuid(),
  publication_id  uuid not null references investor_publications(publication_id) on delete cascade,
  version_number  int not null,
  status          text not null default 'draft'
                    check (status in ('draft', 'in_review', 'published', 'superseded')),

  -- investor-facing approved content
  title                  text not null,
  headline               text,
  overview               text,
  market                 text,
  submarket              text,
  city                   text,
  country                text,
  asset_type             text,
  strategy               text,
  currency               text not null default 'GBP',
  headline_price         numeric(18,2),
  target_niy             numeric(7,4),
  target_irr             numeric(7,4),
  target_equity_multiple numeric(7,4),
  hold_period_years      numeric(5,2),
  size_sqft              numeric(14,2),
  size_sqm               numeric(14,2),
  highlights             jsonb not null default '[]'::jsonb,

  created_by    uuid references profiles(user_id),
  created_at    timestamptz not null default now(),
  submitted_by  uuid references profiles(user_id),
  submitted_at  timestamptz,
  published_by  uuid references profiles(user_id),
  published_at  timestamptz,
  superseded_at timestamptz,
  unique (publication_id, version_number)
);
create index if not exists idx_pubversions_publication on publication_versions(publication_id);

-- Structural guarantee behind the atomic swap: a publication can never have two
-- live published versions, whatever order the updates arrive in.
create unique index if not exists publication_versions_single_published
  on publication_versions(publication_id) where status = 'published';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'investor_publications_active_version_fkey') then
    alter table investor_publications
      add constraint investor_publications_active_version_fkey
      foreign key (active_version_id) references publication_versions(version_id) on delete set null;
  end if;
end $$;

-- ---- Provenance: version → source digest (ADMIN ONLY) ----------------------
-- What this draft was taken from, at the moment it was taken. Kept off the
-- version row so that an investor-readable row carries no trace of the internal
-- record — not an id, and not a digest of one.
create table if not exists publication_version_sources (
  version_id         uuid primary key references publication_versions(version_id) on delete cascade,
  source_fingerprint text not null,
  source_captured_at timestamptz not null default now()
);

-- ---- Documents (version-linked, tiered) ------------------------------------
create table if not exists publication_documents (
  document_id  uuid primary key default gen_random_uuid(),
  version_id   uuid not null references publication_versions(version_id) on delete cascade,
  title        text not null,
  category     text not null default 'other'
                 check (category in ('teaser', 'financials', 'legal', 'technical',
                                     'esg', 'data_room', 'other')),
  -- Private Supabase Storage object path. Investors never receive this directly;
  -- P4 will mint a short-lived signed URL server-side after this RLS check.
  storage_path text not null,
  file_name    text,
  mime_type    text,
  size_bytes   bigint,
  -- 'internal' is never readable by any investor, at any entitlement tier.
  access_level text not null default 'standard'
                 check (access_level in ('standard', 'diligence', 'internal')),
  sort_order   int not null default 0,
  created_by   uuid references profiles(user_id),
  created_at   timestamptz not null default now()
);
create index if not exists idx_pubdocs_version on publication_documents(version_id);

-- ---- Entitlements (default deny) -------------------------------------------
create table if not exists publication_entitlements (
  entitlement_id  uuid primary key default gen_random_uuid(),
  investor_org_id uuid not null references investor_organizations(investor_org_id) on delete cascade,
  publication_id  uuid not null references investor_publications(publication_id) on delete cascade,
  -- Default deny: an entitlement row grants nothing until it is made visible.
  is_visible      boolean not null default false,
  placement       text not null default 'secondary' check (placement in ('featured', 'secondary')),
  sort_order      int not null default 0,
  investor_note   text,
  -- 'internal' is structurally unreachable: it is not an accepted value here.
  document_access_level text not null default 'standard'
                          check (document_access_level in ('standard', 'diligence')),
  granted_by      uuid references profiles(user_id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (investor_org_id, publication_id)
);
create index if not exists idx_entitlements_publication on publication_entitlements(publication_id);

-- At most one visible featured opportunity per investor organisation.
create unique index if not exists publication_entitlements_single_featured
  on publication_entitlements(investor_org_id)
  where is_visible and placement = 'featured';

-- ---- Investor-generated records --------------------------------------------
create table if not exists investor_saved (
  saved_id            uuid primary key default gen_random_uuid(),
  investor_contact_id uuid not null references investor_contacts(investor_contact_id) on delete cascade,
  publication_id      uuid not null references investor_publications(publication_id) on delete cascade,
  created_at          timestamptz not null default now(),
  unique (investor_contact_id, publication_id)
);

-- Factual events only. There is deliberately no engagement-duration, AI-score or
-- inferred-suitability column: `context` carries event facts (for example the
-- set of publication ids in a comparison), never a derived metric.
create table if not exists investor_activity_events (
  event_id            uuid primary key default gen_random_uuid(),
  investor_contact_id uuid not null references investor_contacts(investor_contact_id) on delete cascade,
  investor_org_id     uuid not null references investor_organizations(investor_org_id) on delete cascade,
  event_type          text not null check (event_type in (
                        'login', 'opportunity_viewed', 'saved', 'unsaved', 'compared',
                        'document_viewed', 'document_downloaded', 'information_requested')),
  publication_id      uuid references investor_publications(publication_id) on delete set null,
  version_id          uuid references publication_versions(version_id) on delete set null,
  document_id         uuid references publication_documents(document_id) on delete set null,
  context             jsonb not null default '{}'::jsonb,
  occurred_at         timestamptz not null default now()
);
create index if not exists idx_activity_contact on investor_activity_events(investor_contact_id, occurred_at desc);
create index if not exists idx_activity_publication on investor_activity_events(publication_id);

create table if not exists investor_requests (
  request_id          uuid primary key default gen_random_uuid(),
  investor_contact_id uuid not null references investor_contacts(investor_contact_id) on delete cascade,
  investor_org_id     uuid not null references investor_organizations(investor_org_id) on delete cascade,
  publication_id      uuid references investor_publications(publication_id) on delete set null,
  request_type        text not null check (request_type in
                        ('information', 'meeting', 'diligence_access', 'other')),
  message             text,
  status              text not null default 'new'
                        check (status in ('new', 'acknowledged', 'in_progress', 'closed')),
  handled_by          uuid references profiles(user_id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_requests_contact on investor_requests(investor_contact_id, created_at desc);

-- ============================================================================
-- Database-derived investor authorisation
-- ----------------------------------------------------------------------------
-- These are the ONLY source of investor permission. They are SECURITY DEFINER
-- so that they can resolve membership and entitlement without recursing through
-- the very policies they support, and they run with an empty search_path so a
-- caller-controlled schema cannot capture them.
--
-- Safety property: the identity comes from auth.uid() and nowhere else. The
-- arguments only ever name the object being tested, so no argument can widen the
-- answer beyond what the caller's own contact + entitlement already allow.
-- ============================================================================

create or replace function app.current_investor_contact_id() returns uuid
  language sql stable security definer
  set search_path = ''
  as $fn$
    select c.investor_contact_id
      from public.investor_contacts c
      join public.investor_organizations o using (investor_org_id)
     where c.auth_user_id = auth.uid()
       and c.is_active
       and o.status = 'active'
     limit 1
  $fn$;

create or replace function app.current_investor_org_id() returns uuid
  language sql stable security definer
  set search_path = ''
  as $fn$
    select o.investor_org_id
      from public.investor_contacts c
      join public.investor_organizations o using (investor_org_id)
     where c.auth_user_id = auth.uid()
       and c.is_active
       and o.status = 'active'
     limit 1
  $fn$;

create or replace function app.is_investor() returns boolean
  language sql stable
  set search_path = ''
  as $fn$ select app.current_investor_org_id() is not null $fn$;

/*
 * True on the privileged connection (migrations, seeding, adminQuery), which
 * runs as a BYPASSRLS role and carries no request claims.
 *
 * This is a statement of fact, not a grant: a BYPASSRLS role can already read
 * and write every row directly, so exempting it from an in-function admin check
 * gives it nothing it did not have. It exists so the guards below can refuse the
 * `authenticated` role — the one an investor actually arrives on — without also
 * refusing the seed.
 */
create or replace function app.is_privileged_connection() returns boolean
  language sql stable
  set search_path = ''
  as $fn$
    select coalesce((select r.rolbypassrls from pg_catalog.pg_roles r
                      where r.rolname = current_user), false)
  $fn$;

-- standard < diligence < internal. 'internal' sits above every investor tier.
create or replace function app.document_tier(p_level text) returns int
  language sql immutable
  set search_path = ''
  as $fn$
    select case p_level
             when 'standard'  then 1
             when 'diligence' then 2
             when 'internal'  then 3
             else 99
           end
  $fn$;

-- A publication is readable when the caller's active organisation holds a
-- VISIBLE entitlement to it and the publication is live.
create or replace function app.investor_can_read_publication(p_publication_id uuid) returns boolean
  language sql stable security definer
  set search_path = ''
  as $fn$
    select exists (
      select 1
        from public.publication_entitlements e
        join public.investor_publications p on p.publication_id = e.publication_id
       where e.publication_id = p_publication_id
         and e.investor_org_id = app.current_investor_org_id()
         and e.is_visible
         and p.status = 'published'
         and p.active_version_id is not null)
  $fn$;

-- The one version an investor may read: the publication's active pointer.
-- Drafts, in-review and superseded versions resolve to nothing.
create or replace function app.investor_active_version_id(p_publication_id uuid) returns uuid
  language sql stable security definer
  set search_path = ''
  as $fn$
    select p.active_version_id
      from public.investor_publications p
      join public.publication_entitlements e on e.publication_id = p.publication_id
     where p.publication_id = p_publication_id
       and e.investor_org_id = app.current_investor_org_id()
       and e.is_visible
       and p.status = 'published'
     limit 1
  $fn$;

-- A document is readable when it hangs off the active published version of a
-- readable publication AND sits at or below the entitlement's tier. 'internal'
-- is rejected outright, independently of the tier comparison.
create or replace function app.investor_can_read_document(p_version_id uuid, p_access_level text)
  returns boolean
  language sql stable security definer
  set search_path = ''
  as $fn$
    select p_access_level <> 'internal'
       and exists (
         select 1
           from public.publication_versions v
           join public.investor_publications p on p.publication_id = v.publication_id
           join public.publication_entitlements e on e.publication_id = p.publication_id
          where v.version_id = p_version_id
            and v.status = 'published'
            and p.active_version_id = v.version_id
            and p.status = 'published'
            and e.investor_org_id = app.current_investor_org_id()
            and e.is_visible
            and app.document_tier(p_access_level) <= app.document_tier(e.document_access_level))
  $fn$;

-- ============================================================================
-- The publication boundary: internal opportunity → one-way draft prefill
-- ----------------------------------------------------------------------------
-- This function IS the whitelist. Every field an investor may ever inherit from
-- an internal opportunity is listed here and nowhere else; anything absent
-- cannot reach a publication by any path. Deliberately excluded: broker, vendor
-- and source (counterparty confidential), probability, internal stage/status,
-- capex budget, passing rent, ERV, reference, owner/creator ids and org id.
--
-- SECURITY INVOKER: reading it is gated by the caller's own RLS on
-- `opportunities`, so it returns null for anyone who cannot see the row.
-- ============================================================================
create or replace function app.opportunity_publication_source(p_opportunity_id uuid) returns jsonb
  language sql stable
  set search_path = ''
  as $fn$
    select jsonb_strip_nulls(jsonb_build_object(
             'title',                  o.name,
             'market',                 o.market,
             'submarket',              o.submarket,
             'city',                   pr.city,
             'country',                pr.country,
             'asset_type',             o.asset_type,
             'strategy',               o.strategy,
             'currency',               o.currency,
             'headline_price',         o.target_price,
             'target_niy',             o.niy,
             'target_irr',             o.target_irr,
             'target_equity_multiple', o.equity_multiple,
             'size_sqft',              o.size_sqft,
             'size_sqm',               o.size_sqm,
             'overview',               o.summary))
      from public.opportunities o
      left join public.properties pr on pr.property_id = o.property_id
     where o.opportunity_id = p_opportunity_id
  $fn$;

-- Change detection only — never a security primitive, so md5 is appropriate.
-- jsonb renders its keys in a canonical order, so the digest is stable.
create or replace function app.opportunity_publication_fingerprint(p_opportunity_id uuid) returns text
  language sql stable
  set search_path = ''
  as $fn$
    select md5(app.opportunity_publication_source(p_opportunity_id)::text)
  $fn$;

-- ============================================================================
-- Lifecycle guards
-- ============================================================================

-- Content freezes at submission; the whole row freezes at publication. The one
-- permitted change to a published version is the supersede stamp applied by
-- app.publish_publication_version().
create or replace function app.guard_publication_version() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    meta text[] := array['status', 'submitted_at', 'submitted_by',
                         'published_at', 'published_by', 'superseded_at'];
  begin
    if tg_op = 'DELETE' then
      if old.status in ('published', 'superseded') then
        raise exception 'Publication version % is immutable once published', old.version_id;
      end if;
      return old;
    end if;

    if old.status = 'superseded' then
      raise exception 'Publication version % is superseded and immutable', old.version_id;
    end if;

    if old.status = 'published' then
      if new.status <> 'superseded' then
        raise exception 'Publication version % is immutable once published', old.version_id;
      end if;
      -- Only the status and the supersede stamp may move.
      if (to_jsonb(old) - 'status' - 'superseded_at') <> (to_jsonb(new) - 'status' - 'superseded_at') then
        raise exception 'Publication version % is immutable once published', old.version_id;
      end if;
      return new;
    end if;

    if old.status = 'in_review'
       and (to_jsonb(old) - meta) <> (to_jsonb(new) - meta) then
      raise exception 'Publication version % is in review; return it to draft before editing', old.version_id;
    end if;

    return new;
  end
  $fn$;
drop trigger if exists trg_pubversion_guard on publication_versions;
create trigger trg_pubversion_guard before update or delete on publication_versions
  for each row execute function app.guard_publication_version();

-- Documents attached to a published (or superseded) version are part of that
-- immutable snapshot.
create or replace function app.guard_publication_document() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    target uuid := coalesce(new.version_id, old.version_id);
    state  text;
  begin
    select v.status into state from public.publication_versions v where v.version_id = target;
    if state in ('published', 'superseded') then
      raise exception 'Documents of a published publication version are immutable (version %)', target;
    end if;
    -- An UPDATE that moves a document between versions must clear both ends.
    if tg_op = 'UPDATE' and new.version_id is distinct from old.version_id then
      select v.status into state from public.publication_versions v where v.version_id = old.version_id;
      if state in ('published', 'superseded') then
        raise exception 'Documents of a published publication version are immutable (version %)', old.version_id;
      end if;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end
  $fn$;
drop trigger if exists trg_pubdocument_guard on publication_documents;
create trigger trg_pubdocument_guard before insert or update or delete on publication_documents
  for each row execute function app.guard_publication_document();

-- ---- Atomic publish --------------------------------------------------------
-- Supersedes the outgoing version and repoints the publication in ONE
-- transaction. SECURITY INVOKER, so the caller still needs the admin write
-- policy; the row locks make concurrent publishes serialise rather than race.
--
-- The explicit admin check is belt and braces. Without it a non-admin caller is
-- already harmless — RLS filters every row the function would touch, so it
-- silently changes nothing — but a mutating entry point should refuse loudly
-- rather than no-op, and `authenticated` covers investors as well as staff.
create or replace function app.publish_publication_version(p_version_id uuid, p_actor uuid default null)
  returns uuid
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    v    record;
    prev uuid;
  begin
    if not app.is_admin() and not app.is_privileged_connection() then
      raise exception 'Publishing a version requires a Reiwa administrator';
    end if;

    select * into v from public.publication_versions
      where version_id = p_version_id for update;
    if not found then
      raise exception 'Publication version % not found', p_version_id;
    end if;
    if v.status not in ('draft', 'in_review') then
      raise exception 'Publication version % cannot be published from status %', p_version_id, v.status;
    end if;

    select active_version_id into prev from public.investor_publications
      where publication_id = v.publication_id for update;

    if prev is not null and prev <> p_version_id then
      update public.publication_versions
         set status = 'superseded', superseded_at = now()
       where version_id = prev and status = 'published';
    end if;

    update public.publication_versions
       set status = 'published', published_at = now(), published_by = p_actor
     where version_id = p_version_id;

    update public.investor_publications
       set status = 'published',
           active_version_id = p_version_id,
           first_published_at = coalesce(first_published_at, now()),
           last_published_at = now()
     where publication_id = v.publication_id;

    return p_version_id;
  end
  $fn$;

-- Withdraw the live version: supersede it and drop the pointer, so the
-- publication becomes invisible to every investor immediately.
create or replace function app.supersede_active_version(p_publication_id uuid)
  returns uuid
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    prev uuid;
  begin
    if not app.is_admin() and not app.is_privileged_connection() then
      raise exception 'Withdrawing a publication requires a Reiwa administrator';
    end if;

    select active_version_id into prev from public.investor_publications
      where publication_id = p_publication_id for update;
    if prev is null then
      return null;
    end if;
    update public.publication_versions
       set status = 'superseded', superseded_at = now()
     where version_id = prev and status = 'published';
    update public.investor_publications
       set status = 'withdrawn', active_version_id = null
     where publication_id = p_publication_id;
    return prev;
  end
  $fn$;

-- ---- updated_at ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['investor_organizations', 'investor_contacts', 'investor_publications',
                           'publication_entitlements', 'investor_requests'] loop
    execute format('drop trigger if exists trg_%s_touch on %I', t, t);
    execute format('create trigger trg_%s_touch before update on %I
                    for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;

-- ============================================================================
-- RLS
-- ----------------------------------------------------------------------------
-- Reiwa admins manage everything (app.is_admin(), assembled server-side).
-- Investors get narrow, derived read access and may write only their own saved
-- state, activity and requests. Internal org users get nothing here at all.
--
-- The two provenance tables appear ONLY in this admin-only loop. No investor
-- policy is written for them below, so an investor's SELECT matches no
-- permissive policy and returns nothing, whatever they ask for.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['investor_organizations', 'investor_contacts', 'investor_publications',
                           'publication_sources', 'publication_version_sources',
                           'publication_versions', 'publication_documents', 'publication_entitlements',
                           'investor_saved', 'investor_activity_events', 'investor_requests'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_admin on %I', t, t);
    execute format('create policy %I_admin on %I for all to authenticated
                    using (app.is_admin()) with check (app.is_admin())', t, t);
    -- Supabase's default privileges hand `anon` table rights on everything new
    -- in `public`. RLS already denies anon (every policy here is `to
    -- authenticated`), but an unauthenticated role has no business holding the
    -- privilege at all — take it back and grant only what is used.
    execute format('revoke all on %I from anon, public', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- An investor may read their own organisation record, and only theirs.
drop policy if exists investor_organizations_self on investor_organizations;
create policy investor_organizations_self on investor_organizations for select to authenticated
  using (investor_org_id = app.current_investor_org_id());

-- ...and their own contact record. Not their colleagues'.
drop policy if exists investor_contacts_self on investor_contacts;
create policy investor_contacts_self on investor_contacts for select to authenticated
  using (investor_contact_id = app.current_investor_contact_id());

drop policy if exists investor_publications_entitled on investor_publications;
create policy investor_publications_entitled on investor_publications for select to authenticated
  using (app.investor_can_read_publication(publication_id));

-- Only the active published version — never a draft, in-review or superseded one.
drop policy if exists publication_versions_active on publication_versions;
create policy publication_versions_active on publication_versions for select to authenticated
  using (status = 'published' and version_id = app.investor_active_version_id(publication_id));

drop policy if exists publication_documents_tiered on publication_documents;
create policy publication_documents_tiered on publication_documents for select to authenticated
  using (app.investor_can_read_document(version_id, access_level));

-- Hidden entitlements are invisible even to the organisation they name.
drop policy if exists publication_entitlements_own on publication_entitlements;
create policy publication_entitlements_own on publication_entitlements for select to authenticated
  using (investor_org_id = app.current_investor_org_id() and is_visible);

-- Saved state is per contact, and can only be created against a publication the
-- contact can actually read.
drop policy if exists investor_saved_own_select on investor_saved;
create policy investor_saved_own_select on investor_saved for select to authenticated
  using (investor_contact_id = app.current_investor_contact_id());
drop policy if exists investor_saved_own_insert on investor_saved;
create policy investor_saved_own_insert on investor_saved for insert to authenticated
  with check (investor_contact_id = app.current_investor_contact_id()
              and app.investor_can_read_publication(publication_id));
drop policy if exists investor_saved_own_delete on investor_saved;
create policy investor_saved_own_delete on investor_saved for delete to authenticated
  using (investor_contact_id = app.current_investor_contact_id());

-- Activity is append-only for investors: no update or delete policy exists.
drop policy if exists investor_activity_own_select on investor_activity_events;
create policy investor_activity_own_select on investor_activity_events for select to authenticated
  using (investor_contact_id = app.current_investor_contact_id());
drop policy if exists investor_activity_own_insert on investor_activity_events;
create policy investor_activity_own_insert on investor_activity_events for insert to authenticated
  with check (investor_contact_id = app.current_investor_contact_id()
              and investor_org_id = app.current_investor_org_id());

drop policy if exists investor_requests_own_select on investor_requests;
create policy investor_requests_own_select on investor_requests for select to authenticated
  using (investor_contact_id = app.current_investor_contact_id());
drop policy if exists investor_requests_own_insert on investor_requests;
create policy investor_requests_own_insert on investor_requests for insert to authenticated
  with check (investor_contact_id = app.current_investor_contact_id()
              and investor_org_id = app.current_investor_org_id()
              and (publication_id is null or app.investor_can_read_publication(publication_id)));
-- Triage (status, handled_by) is an admin action: investors cannot edit a
-- submitted request. Covered by investor_requests_admin alone.

-- ---- Internal reference data is not investor data --------------------------
-- fx_rates was readable by every authenticated user (P0). Portal identities are
-- authenticated too, so narrow it: nothing in `public` is readable by an
-- investor unless this migration says so.
drop policy if exists fx_rates_select on fx_rates;
create policy fx_rates_select on fx_rates for select to authenticated
  using (not app.is_investor());

-- ---- Investor read projection ----------------------------------------------
-- Convenience only. `security_invoker = true` means the caller's own RLS still
-- decides every row, so this view can never widen access. It selects from the
-- investor-readable tables alone: the provenance tables are not joined here, and
-- must never be — nothing in this projection is an internal identifier.
drop view if exists investor_feed;
create view investor_feed with (security_invoker = true) as
  select e.investor_org_id,
         p.publication_id,
         v.version_id,
         v.version_number,
         e.placement,
         e.sort_order,
         e.investor_note,
         e.document_access_level,
         v.title, v.headline, v.overview,
         v.market, v.submarket, v.city, v.country,
         v.asset_type, v.strategy, v.currency,
         v.headline_price, v.target_niy, v.target_irr, v.target_equity_multiple,
         v.hold_period_years, v.size_sqft, v.size_sqm, v.highlights,
         v.published_at
    from publication_entitlements e
    join investor_publications p on p.publication_id = e.publication_id
    join publication_versions v on v.version_id = p.active_version_id
   where e.is_visible
     and p.status = 'published'
     and v.status = 'published';

revoke all on investor_feed from anon, public;
grant select on investor_feed to authenticated;

-- ============================================================================
-- Grants
-- ----------------------------------------------------------------------------
-- `create function` grants EXECUTE to PUBLIC by default, which would extend to
-- every present and future role. Revoke that first and then grant deliberately:
-- the `app` schema is reachable by `authenticated` and by nobody else.
--
-- `anon` gets neither USAGE on the schema nor EXECUTE on its functions, so an
-- unauthenticated caller cannot invoke a single helper. `authenticated` covers
-- both internal staff and portal investors, since they share the Postgres role —
-- which is exactly why every helper derives its answer from auth.uid() and every
-- table is gated by RLS rather than by role.
--
-- The schema is also not in PostgREST's exposed schemas, so none of these
-- functions is reachable as an HTTP RPC; they are callable only over the
-- server-side Postgres connection.
-- ============================================================================
revoke all on schema app from public;
revoke execute on all functions in schema app from public;
revoke execute on all functions in schema app from anon;

grant usage on schema app to authenticated;
grant execute on all functions in schema app to authenticated;
