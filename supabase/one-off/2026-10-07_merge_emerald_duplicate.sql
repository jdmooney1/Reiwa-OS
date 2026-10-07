-- ============================================================================
-- ONE-OFF DATA MERGE - NOT a schema migration. Review before running. Run in the Supabase SQL editor.
-- ----------------------------------------------------------------------------
-- Folds the duplicate "Emerald Theatre, Covent Garden" (created by the deal-seed loader on 7 Oct)
-- into the original "Emerald Theater" (30 Sept pipeline load).
--
-- WHERE IT LIVES AND WHY. supabase/one-off/, not supabase/migrations/. scripts/migrate.ts applies every
-- file in migrations/ to every database (local, test, staging); this changes two specific rows in one.
-- It needs migration 0036 (the 'merged' status and merged_into_opportunity_id) applied FIRST.
--
-- HOW IT RUNS. One DO block, so it is one statement and therefore atomic: either everything below
-- happens or nothing does.
--   v_apply = false (the default)  DRY RUN. Does every step, checks the result, then RAISES AN EXCEPTION
--                                  that rolls it all back and prints the full report as the error text.
--                                  The "error" is the report. Nothing is changed.
--   v_apply = true                 Same steps; the block completes and commits.
-- Run it as a dry run first, read the report, then change v_apply to true and run it again.
-- Afterwards run 2026-10-07_merge_emerald_duplicate_verify.sql (read-only).
--
-- IT STOPS (raises, changes nothing) if anything is not as the plan assumes: a missing or already-merged
-- row, different organisations, any dependent record on the duplicate other than its one case, its
-- first-seen event and its loader audit row, a price difference over 1%, a different broker firm, an
-- approved or superseded case on the duplicate. Running it twice is safe: the second run finds the
-- duplicate already merged and stops.
--
-- WHAT IT DOES
--   1. Survivor = the original (v_old). Keeps its id, reference, property, history.
--   2. Folds into the survivor ONLY fields that are empty on it: source contact, source line, deal stage,
--      data completeness, size, photo reference. Nothing already present is overwritten.
--   3. source_facts: the duplicate's facts are added under the survivor's (the survivor wins on a clash);
--      every clash is recorded, with the duplicate's loader flags, under source_facts._merged_from.
--   4. Building facts on the property (heritage, tenure, ground rent, WAULT, covenant, EPC, transport...):
--      empty fields on the survivor's property are filled; clashes are recorded, never resolved.
--   5. The duplicate's underwriting is KEPT as the survivor's next version, status 'draft' (not current),
--      so no figure is chosen over another. The survivor's own case is untouched.
--   6. Renames the survivor to v_final_name, keeping the old name in source_facts._previous_names.
--   7. Records one new 'note' event on the survivor's property (events are append-only; the duplicate's own
--      first-seen event stays where it is).
--   8. Repoints the loader's audit row(s) (deal_load_rows) at the survivor and annotates the reason.
--      raw_row is immutable and untouched; outcome stays 'created' because that is what happened.
--   9. Marks the duplicate status 'merged', archived, pointing at the survivor. It is NOT deleted.
-- WHAT IT DELIBERATELY DOES NOT DO
--   * Delete anything. * Touch the duplicate's property row (it may be a separate shell; see the report).
--   * Rename the property. * Change any figure on the survivor's own case.
-- ============================================================================

do $merge$
declare
  -- ===== PARAMETERS: review these =============================================
  v_old        uuid := '0f4d3e03-02ef-4957-918d-1ffb9d75bd48';  -- SURVIVOR  "Emerald Theater", 30 Sept pipeline load
  v_new        uuid := 'b5c09009-02e1-4350-b163-e6c62fb74714';  -- DUPLICATE "Emerald Theatre, Covent Garden", 7 Oct seed
  v_final_name text := 'Emerald Theatre, Covent Garden';
  v_apply      boolean := false;                                -- false = DRY RUN (rolls back and prints the report)
  -- ===========================================================================

  r            text := '';
  o_old        public.opportunities;
  o_new        public.opportunities;
  p_old        public.properties;
  p_new        public.properties;
  same_prop    boolean;
  c_new        public.investment_cases;
  n_new_cases  int;
  next_version int;
  old_price    numeric;
  new_price    numeric;
  rec          record;
  n            int;
  blockers     text := '';
  fact_clashes jsonb;
  prop_clashes jsonb := '{}'::jsonb;
  moved_note   text := 'none (duplicate had no underwriting case)';
  merged_obj   jsonb;
  rows_audit   int;
begin
  -- ---- 1. Load both rows, locked ---------------------------------------------------------------
  select * into o_old from public.opportunities where opportunity_id = v_old for update;
  if not found then raise exception 'STOP: survivor % does not exist', v_old; end if;
  select * into o_new from public.opportunities where opportunity_id = v_new for update;
  if not found then raise exception 'STOP: duplicate % does not exist', v_new; end if;

  -- ---- 2. Preconditions: refuse anything the plan did not expect ---------------------------------
  if v_old = v_new then raise exception 'STOP: survivor and duplicate are the same record'; end if;
  if o_old.org_id <> o_new.org_id then raise exception 'STOP: the two records belong to different organisations'; end if;
  if o_new.status = 'merged' then
    raise exception 'STOP: the duplicate is already merged (into %). Nothing to do.', o_new.merged_into_opportunity_id;
  end if;
  if o_old.status <> 'active' or o_old.archived_at is not null then
    raise exception 'STOP: the survivor is not an active, unarchived record (status %, archived %)', o_old.status, o_old.archived_at;
  end if;
  if o_new.status <> 'active' or o_new.archived_at is not null then
    raise exception 'STOP: the duplicate is not an active, unarchived record (status %, archived %)', o_new.status, o_new.archived_at;
  end if;
  if o_new.reference is null or o_new.reference not like 'SEED-%' then
    raise exception 'STOP: the duplicate (reference %) does not look like a deal-seed record', o_new.reference;
  end if;
  if o_new.created_at <= o_old.created_at then
    raise exception 'STOP: the duplicate (%) is not newer than the survivor (%)', o_new.created_at, o_old.created_at;
  end if;
  if o_old.property_id is null or o_new.property_id is null then
    raise exception 'STOP: both records must be bound to a property (survivor %, duplicate %)', o_old.property_id, o_new.property_id;
  end if;
  same_prop := (o_old.property_id = o_new.property_id);
  select * into p_old from public.properties where property_id = o_old.property_id;
  select * into p_new from public.properties where property_id = o_new.property_id;

  -- Nothing may hang off the duplicate except the three things this script knows how to handle.
  -- Generic on purpose: every base table in public with an opportunity_id column is counted, so a
  -- dependent added later (or one I have not seen on the real database) stops the run.
  for rec in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'opportunity_id'
       and c.table_name not in ('opportunities', 'investment_cases', 'property_events', 'deal_load_rows')
  loop
    execute format('select count(*) from public.%I where opportunity_id = $1', rec.table_name) into n using v_new;
    if n > 0 then blockers := blockers || format('%s=%s ', rec.table_name, n); end if;
  end loop;
  if blockers <> '' then
    raise exception 'STOP: the duplicate has dependent records this script does not handle: %', blockers;
  end if;
  if exists (select 1 from public.opportunities where merged_into_opportunity_id = v_new) then
    raise exception 'STOP: other records are already merged into the duplicate';
  end if;

  select count(*) into n_new_cases from public.investment_cases where opportunity_id = v_new;
  if n_new_cases > 1 then raise exception 'STOP: the duplicate has % underwriting cases (expected at most 1)', n_new_cases; end if;
  if n_new_cases = 1 then
    select * into c_new from public.investment_cases where opportunity_id = v_new;
    if c_new.status not in ('draft', 'current') then
      raise exception 'STOP: the duplicate''s case is % (only a draft or current case may be moved)', c_new.status;
    end if;
  end if;

  -- Same-deal sanity net: I have not seen these rows, so check they look like one deal.
  select acquisition_price into old_price from public.investment_cases where opportunity_id = v_old order by version limit 1;
  new_price := c_new.acquisition_price;
  if old_price is not null and new_price is not null
     and abs(old_price - new_price) / greatest(old_price, new_price) > 0.01 then
    raise exception 'STOP: prices differ by more than 1%% (survivor % vs duplicate %): this does not look like the same deal', old_price, new_price;
  end if;
  if coalesce(o_old.broker_name, '') <> '' and coalesce(o_new.broker_name, '') <> ''
     and split_part(lower(o_old.broker_name), ' ', 1) <> split_part(lower(o_new.broker_name), ' ', 1) then
    raise exception 'STOP: different broker firm (survivor "%" vs duplicate "%")', o_old.broker_name, o_new.broker_name;
  end if;

  -- ---- 3. BEFORE ------------------------------------------------------------------------------------
  r := r || format(E'BEFORE\n  survivor  %s  "%s"  ref %s  broker "%s"  contact "%s"  created %s\n', v_old, o_old.name, o_old.reference, o_old.broker_name, o_old.source_contact_name, o_old.created_at);
  r := r || format(E'  duplicate %s  "%s"  ref %s  broker "%s"  contact "%s"  created %s\n', v_new, o_new.name, o_new.reference, o_new.broker_name, o_new.source_contact_name, o_new.created_at);
  r := r || format(E'  survivor property %s  address "%s"  market "%s"  key "%s"\n', p_old.property_id, p_old.address, p_old.market, p_old.identity_key);
  r := r || format(E'  duplicate property %s  address "%s"  market "%s"  key "%s"%s\n', p_new.property_id, p_new.address, p_new.market, p_new.identity_key, case when same_prop then '  (SAME PROPERTY)' else '' end);
  for rec in select version, status, acquisition_price, entry_yield_pct from public.investment_cases where opportunity_id = v_old order by version loop
    r := r || format(E'  survivor case v%s  %s  price %s  entry yield %s\n', rec.version, rec.status, rec.acquisition_price, rec.entry_yield_pct);
  end loop;
  if n_new_cases = 1 then
    r := r || format(E'  duplicate case v%s  %s  price %s  entry yield %s\n', c_new.version, c_new.status, c_new.acquisition_price, c_new.entry_yield_pct);
  end if;
  select count(*) into n from public.publication_sources where opportunity_id = v_old;
  if n > 0 then
    r := r || format(E'  WARNING: the survivor feeds %s publication(s). The rename will show there as "internal record has changed".\n', n);
  end if;

  -- ---- 4. Fold the duplicate's facts into the survivor (empty fields only) ---------------------------
  select coalesce(jsonb_object_agg(k, jsonb_build_object('kept', o_old.source_facts -> k, 'other', o_new.source_facts -> k)), '{}'::jsonb)
    into fact_clashes
    from jsonb_object_keys(o_new.source_facts) k
   where k not like E'\\_%' and o_old.source_facts ? k and (o_old.source_facts -> k) is distinct from (o_new.source_facts -> k);

  if not same_prop then
    select coalesce(jsonb_strip_nulls(jsonb_build_object(
        'heritage_status',        case when p_old.heritage_status is not null and p_new.heritage_status is not null and p_old.heritage_status is distinct from p_new.heritage_status then jsonb_build_object('kept', p_old.heritage_status, 'other', p_new.heritage_status) end,
        'tenure',                 case when p_old.tenure is not null and p_new.tenure is not null and p_old.tenure is distinct from p_new.tenure then jsonb_build_object('kept', p_old.tenure, 'other', p_new.tenure) end,
        'unexpired_term_years',   case when p_old.unexpired_term_years is not null and p_new.unexpired_term_years is not null and p_old.unexpired_term_years is distinct from p_new.unexpired_term_years then jsonb_build_object('kept', p_old.unexpired_term_years, 'other', p_new.unexpired_term_years) end,
        'ground_rent_pa',         case when p_old.ground_rent_pa is not null and p_new.ground_rent_pa is not null and p_old.ground_rent_pa is distinct from p_new.ground_rent_pa then jsonb_build_object('kept', p_old.ground_rent_pa, 'other', p_new.ground_rent_pa) end,
        'ground_rent_note',       case when p_old.ground_rent_note is not null and p_new.ground_rent_note is not null and p_old.ground_rent_note is distinct from p_new.ground_rent_note then jsonb_build_object('kept', p_old.ground_rent_note, 'other', p_new.ground_rent_note) end,
        'wault_to_expiry_years',  case when p_old.wault_to_expiry_years is not null and p_new.wault_to_expiry_years is not null and p_old.wault_to_expiry_years is distinct from p_new.wault_to_expiry_years then jsonb_build_object('kept', p_old.wault_to_expiry_years, 'other', p_new.wault_to_expiry_years) end,
        'wault_to_breaks_years',  case when p_old.wault_to_breaks_years is not null and p_new.wault_to_breaks_years is not null and p_old.wault_to_breaks_years is distinct from p_new.wault_to_breaks_years then jsonb_build_object('kept', p_old.wault_to_breaks_years, 'other', p_new.wault_to_breaks_years) end,
        'covenant_rating',        case when p_old.covenant_rating is not null and p_new.covenant_rating is not null and p_old.covenant_rating is distinct from p_new.covenant_rating then jsonb_build_object('kept', p_old.covenant_rating, 'other', p_new.covenant_rating) end,
        'rent_review_mechanism',  case when p_old.rent_review_mechanism is not null and p_new.rent_review_mechanism is not null and p_old.rent_review_mechanism is distinct from p_new.rent_review_mechanism then jsonb_build_object('kept', p_old.rent_review_mechanism, 'other', p_new.rent_review_mechanism) end,
        'epc_rating',             case when p_old.epc_rating is not null and p_new.epc_rating is not null and p_old.epc_rating is distinct from p_new.epc_rating then jsonb_build_object('kept', p_old.epc_rating, 'other', p_new.epc_rating) end,
        'transport_connectivity', case when p_old.transport_connectivity is not null and p_new.transport_connectivity is not null and p_old.transport_connectivity is distinct from p_new.transport_connectivity then jsonb_build_object('kept', p_old.transport_connectivity, 'other', p_new.transport_connectivity) end
      )), '{}'::jsonb) into prop_clashes;

    update public.properties p set
        heritage_status        = coalesce(p.heritage_status, x.heritage_status),
        tenure                 = coalesce(p.tenure, x.tenure),
        unexpired_term_years   = coalesce(p.unexpired_term_years, x.unexpired_term_years),
        ground_rent_pa         = coalesce(p.ground_rent_pa, x.ground_rent_pa),
        ground_rent_note       = coalesce(p.ground_rent_note, x.ground_rent_note),
        wault_to_expiry_years  = coalesce(p.wault_to_expiry_years, x.wault_to_expiry_years),
        wault_to_breaks_years  = coalesce(p.wault_to_breaks_years, x.wault_to_breaks_years),
        covenant_rating        = coalesce(p.covenant_rating, x.covenant_rating),
        rent_review_mechanism  = coalesce(p.rent_review_mechanism, x.rent_review_mechanism),
        epc_rating             = coalesce(p.epc_rating, x.epc_rating),
        transport_connectivity = coalesce(p.transport_connectivity, x.transport_connectivity)
      from public.properties x
     where p.property_id = o_old.property_id and x.property_id = o_new.property_id;
  end if;

  -- ---- 5. The duplicate's underwriting becomes the survivor's next version, as a draft ----------------
  if n_new_cases = 1 then
    select coalesce(max(version), 0) + 1 into next_version from public.investment_cases where opportunity_id = v_old;
    update public.investment_cases
       set opportunity_id = v_old, version = next_version, status = 'draft'
     where case_id = c_new.case_id;
    moved_note := format('moved to the survivor as v%s, draft (was v%s, %s); price %s, entry yield %s', next_version, c_new.version, c_new.status, c_new.acquisition_price, c_new.entry_yield_pct);
  end if;

  -- ---- 6. Survivor: fold, rename, record where everything came from -----------------------------------
  merged_obj := jsonb_build_object(
    'merged_at', now(), 'opportunity_id', v_new, 'reference', o_new.reference, 'name', o_new.name,
    'broker_name', o_new.broker_name, 'source', o_new.source, 'created_at', o_new.created_at,
    'property_id', o_new.property_id, 'case', moved_note,
    'loader_flags', coalesce(o_new.source_facts -> '_loader_flags', '[]'::jsonb),
    'fact_clashes', fact_clashes, 'property_clashes', prop_clashes);

  update public.opportunities o set
      source_contact_name  = coalesce(o.source_contact_name, x.source_contact_name),
      source               = coalesce(o.source, x.source),
      deal_stage           = coalesce(o.deal_stage, x.deal_stage),
      data_completeness    = coalesce(o.data_completeness, x.data_completeness),
      size_sqft            = coalesce(o.size_sqft, x.size_sqft),
      photo_reference_type = case when o.photo_reference_type is null then x.photo_reference_type else o.photo_reference_type end,
      photo_url            = case when o.photo_reference_type is null then x.photo_url else o.photo_url end,
      source_attachments   = case when o.photo_reference_type is null then x.source_attachments else o.source_attachments end,
      name                 = v_final_name,
      source_facts         = (x.source_facts - '_loader_flags' - '_merged_from' - '_previous_names') || o.source_facts
                             || jsonb_build_object(
                                  '_merged_from', coalesce(o.source_facts -> '_merged_from', '[]'::jsonb) || jsonb_build_array(merged_obj),
                                  '_previous_names', coalesce(o.source_facts -> '_previous_names', '[]'::jsonb)
                                      || case when o.name is distinct from v_final_name
                                              then jsonb_build_array(jsonb_build_object('name', o.name, 'until', now(), 'reason', 'merged with ' || x.name))
                                              else '[]'::jsonb end)
    from public.opportunities x
   where o.opportunity_id = v_old and x.opportunity_id = v_new;

  -- ---- 7. One append-only note on the survivor's property ---------------------------------------------
  insert into public.property_events (org_id, property_id, opportunity_id, event_type, headline, detail, source_kind)
  values (o_old.org_id, o_old.property_id, v_old, 'note', 'Duplicate record merged into this opportunity',
          format('"%s" (%s) was loaded from broker material on %s as a second record of this building and merged here. '
                 'Its underwriting is kept as a draft version. Its own first-seen event stays on that record. Details: source_facts._merged_from.',
                 o_new.name, o_new.reference, to_char(o_new.created_at, 'DD Mon YYYY')),
          'reiwa_manual');

  -- ---- 8. The loader's audit trail ----------------------------------------------------------------------
  update public.deal_load_rows
     set opportunity_id = v_old,
         property_id    = o_old.property_id,
         reason         = case when reason is null then '' else reason || ' | ' end
                          || format('merged into %s on %s: duplicate of the 30 Sept pipeline record', v_old, to_char(now(), 'YYYY-MM-DD'))
   where opportunity_id = v_new;
  get diagnostics rows_audit = row_count;

  -- ---- 9. The duplicate stops being a deal, and says where it went; it is not deleted --------------------
  update public.opportunities
     set status = 'merged', merged_into_opportunity_id = v_old, archived_at = coalesce(archived_at, now())
   where opportunity_id = v_new;

  -- ---- 10. Postconditions: if any is false, everything above is rolled back --------------------------------
  select * into o_new from public.opportunities where opportunity_id = v_new;
  select * into o_old from public.opportunities where opportunity_id = v_old;
  if o_new.status <> 'merged' or o_new.merged_into_opportunity_id <> v_old or o_new.archived_at is null then
    raise exception 'POSTCONDITION FAILED: the duplicate is not merged and archived';
  end if;
  if o_old.status <> 'active' or o_old.archived_at is not null or o_old.name <> v_final_name then
    raise exception 'POSTCONDITION FAILED: the survivor is not active, unarchived and renamed';
  end if;
  if exists (select 1 from public.investment_cases where opportunity_id = v_new) then
    raise exception 'POSTCONDITION FAILED: the duplicate still has an underwriting case';
  end if;
  if n_new_cases = 1 and not exists (select 1 from public.investment_cases where case_id = c_new.case_id and opportunity_id = v_old and status = 'draft') then
    raise exception 'POSTCONDITION FAILED: the moved case is not a draft on the survivor';
  end if;
  if (select count(*) from public.investment_cases where opportunity_id = v_old and status = 'current') > 1 then
    raise exception 'POSTCONDITION FAILED: the survivor has more than one current case';
  end if;

  -- ---- 11. AFTER ---------------------------------------------------------------------------------------------
  r := r || format(E'AFTER\n  survivor  "%s"  status %s  contact "%s"  deal stage "%s"  size %s\n', o_old.name, o_old.status, o_old.source_contact_name, o_old.deal_stage, o_old.size_sqft);
  for rec in select version, status, acquisition_price, entry_yield_pct from public.investment_cases where opportunity_id = v_old order by version loop
    r := r || format(E'  survivor case v%s  %s  price %s  entry yield %s\n', rec.version, rec.status, rec.acquisition_price, rec.entry_yield_pct);
  end loop;
  r := r || format(E'  duplicate  status %s  archived %s  merged into %s\n', o_new.status, o_new.archived_at, o_new.merged_into_opportunity_id);
  r := r || format(E'  case: %s\n', moved_note);
  r := r || format(E'  source_facts clashes (survivor kept): %s\n  property clashes (survivor kept): %s\n', fact_clashes, prop_clashes);
  r := r || format(E'  loader audit rows repointed: %s\n', rows_audit);
  r := r || format(E'  note recorded on property %s\n', o_old.property_id);
  if not same_prop then
    r := r || format(E'  LEFT AS IS: the duplicate''s own property %s ("%s") is now referenced only by the archived duplicate and its first-seen event. Tidy it later.\n', o_new.property_id, p_new.name);
  end if;

  raise notice E'%', r;
  if not v_apply then
    raise exception E'DRY RUN - NOTHING WAS CHANGED. Set v_apply := true and run again to apply.\n\n%', r;
  end if;
end
$merge$;
