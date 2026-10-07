-- ============================================================================
-- 0033 - The investor Overview is its own field, never a copy of the internal summary
-- ----------------------------------------------------------------------------
-- THE DEFECT. app.opportunity_publication_source() (0005) prefilled the investor-facing
-- `overview` from `opportunities.summary`, the internal thesis/summary an associate types
-- at intake. A note explicitly marked do-not-disclose reached a publication draft with no
-- friction at all, and from there it was two clicks from an investor's screen.
--
-- THE FIX. A separate, nullable column, `opportunities.investor_overview`, written for
-- investors and nowhere else. The boundary function now reads that column and not
-- `summary`. NULL means "nobody has written an investor-facing overview yet", and the
-- function then omits the key entirely (jsonb_strip_nulls), so a new draft starts with a
-- blank Overview. There is no fallback to `summary`, by design: blank is safe, guessed is
-- not.
--
-- EXISTING DATA. Nothing is back-filled. `summary` is free text that may mix a sentence an
-- investor could read with a sentence they must never see, and a script cannot tell which
-- is which. Every existing opportunity therefore has `investor_overview` NULL, and a human
-- writes it. Draft and published versions that ALREADY hold copied text are not touched
-- (a published version is immutable, and an unpublished one is the author's work); the
-- read-only query in docs/24 lists them for review.
--
-- DRIFT RE-BASE. The "internal record has changed" warning compares a fingerprint taken
-- when a draft was made with the boundary function's output today. Changing what the
-- function returns changes every fingerprint, which would light that warning on every
-- existing publication although nothing internal moved. So, before the function changes,
-- the versions whose fingerprint still matched are recorded; after it changes, their
-- stored fingerprint is recomputed under the new definition. A version that had ALREADY
-- drifted keeps its old fingerprint and so keeps reporting drift: real drift is never
-- hidden by this migration.
--
-- NO POLICY, GRANT OR VIEW CHANGE. The column is on `opportunities`, which investors cannot
-- read (their access is the publication tables only); the investor portal reads
-- `investor_feed`, which does not name it. Its only way across is the boundary function.
-- ============================================================================

-- 1. Remember which versions had no drift under the OLD definition.
create temp table _pub_no_drift on commit drop as
  select vs.version_id
    from public.publication_version_sources vs
    join public.publication_versions v on v.version_id = vs.version_id
    join public.publication_sources ps on ps.publication_id = v.publication_id
   where vs.source_fingerprint is not distinct from
         app.opportunity_publication_fingerprint(ps.opportunity_id);

-- 2. The new column. Blank text is not an overview: refuse it, so NULL is the one
--    representation of "not written".
alter table public.opportunities
  add column if not exists investor_overview text;

alter table public.opportunities
  drop constraint if exists opportunities_investor_overview_nonblank;
alter table public.opportunities
  add constraint opportunities_investor_overview_nonblank
  check (investor_overview is null or btrim(investor_overview) <> '');

comment on column public.opportunities.investor_overview is
  'Written FOR investors. The only free-text field that crosses into a publication draft '
  '(app.opportunity_publication_source). NULL = not written; the draft Overview then starts blank. '
  'Never derived from, and never falls back to, the internal `summary`.';
comment on column public.opportunities.summary is
  'INTERNAL thesis / summary. Does not cross into any investor-facing record; '
  'see opportunities.investor_overview for the investor-facing wording.';

-- 3. The boundary: identical to 0005 except `overview` now reads investor_overview.
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
             'overview',               o.investor_overview))
      from public.opportunities o
      left join public.properties pr on pr.property_id = o.property_id
     where o.opportunity_id = p_opportunity_id
  $fn$;

-- 4. Re-base the fingerprints that were in step with the source, and only those.
update public.publication_version_sources vs
   set source_fingerprint = app.opportunity_publication_fingerprint(ps.opportunity_id)
  from public.publication_versions v
  join public.publication_sources ps on ps.publication_id = v.publication_id
 where v.version_id = vs.version_id
   and vs.version_id in (select version_id from _pub_no_drift);
