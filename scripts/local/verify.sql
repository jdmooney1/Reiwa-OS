-- ============================================================================
-- Migration verification - assertions, not eyeballing.
-- ----------------------------------------------------------------------------
-- Runs against a throwaway local cluster after the full migration chain. Every
-- check RAISEs on failure, so `npm run db:verify` exits non-zero when a claim
-- in the migrations stops being true.
--
-- This complements, and does not replace, tests/integration: those run against
-- real Supabase with real Supabase Auth. These prove the SQL itself is sound
-- without needing network access or production credentials.
-- ============================================================================

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users(id, email) values
  ('11111111-1111-1111-1111-111111111111','a@example.com'),
  ('22222222-2222-2222-2222-222222222222','b@example.com') on conflict do nothing;
insert into profiles(user_id, email, name, global_role) values
  ('11111111-1111-1111-1111-111111111111','a@example.com','A','org_user'),
  ('22222222-2222-2222-2222-222222222222','b@example.com','B','org_user') on conflict do nothing;
insert into organizations(org_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Org A'),
  ('bbbbbbbb-0000-0000-0000-000000000002','Org B') on conflict do nothing;
insert into properties(property_id, org_id, name, address, postcode, identity_key)
  values ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
          '16 Conduit Street','16 Conduit Street, London','W1S 2XJ','pc:W1S2XJ|16conduitstreet')
  on conflict do nothing;
insert into opportunities(opportunity_id, org_id, property_id, name, stage, status)
  values ('ffffffff-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
          'cccccccc-0000-0000-0000-000000000001','16 Conduit Street','inbox','active')
  on conflict do nothing;
insert into ingestion_batches(batch_id, org_id, label, channel)
  values ('dddddddd-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','A batch','upload')
  on conflict do nothing;
insert into ingestion_items(item_id, org_id, batch_id, sequence, raw_payload, display_name)
  values ('eeeeeeee-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
          'dddddddd-0000-0000-0000-000000000001', 1,
          '{"Property":"16 Conduit Street","EPC Band":"C"}'::jsonb,'16 Conduit Street')
  on conflict do nothing;
insert into property_events(org_id, property_id, opportunity_id, event_type, headline)
  values ('aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001',
          'ffffffff-0000-0000-0000-000000000001','price_quoted','Guide GBP 12.5m')
  on conflict do nothing;

-- ---- Helper ----------------------------------------------------------------
create or replace function pg_temp.check(label text, actual bigint, expected bigint)
  returns void language plpgsql as $$
  begin
    if actual is distinct from expected then
      raise exception 'FAIL % - expected %, got %', label, expected, actual;
    end if;
    raise notice 'ok   % (%)', label, actual;
  end $$;

create or replace function pg_temp.claims(sub text, orgs text) returns void
  language plpgsql as $$
  begin
    perform set_config('request.jwt.claims', format(
      '{"sub":"%s","role":"authenticated","app_metadata":{"global_role":"org_user","org_ids":%s,"can_write":true}}',
      sub, orgs), true);
  end $$;

-- ---- 1. Org isolation on every ingestion table ------------------------------
do $$
declare n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform pg_temp.claims('11111111-1111-1111-1111-111111111111',
                         '["aaaaaaaa-0000-0000-0000-000000000001"]');
  select count(*) into n from ingestion_items;       perform pg_temp.check('org A sees its items', n, 1);
  select count(*) into n from ingestion_batches;     perform pg_temp.check('org A sees its batches', n, 1);
  select count(*) into n from property_events;       perform pg_temp.check('org A sees its events', n, 1);

  perform pg_temp.claims('22222222-2222-2222-2222-222222222222',
                         '["bbbbbbbb-0000-0000-0000-000000000002"]');
  select count(*) into n from ingestion_items;       perform pg_temp.check('org B sees no items', n, 0);
  select count(*) into n from ingestion_batches;     perform pg_temp.check('org B sees no batches', n, 0);
  select count(*) into n from match_candidates;      perform pg_temp.check('org B sees no candidates', n, 0);
  select count(*) into n from import_mapping_templates; perform pg_temp.check('org B sees no templates', n, 0);
  select count(*) into n from property_events;       perform pg_temp.check('org B sees no events', n, 0);
  perform set_config('role', 'postgres', true);
end $$;

-- ---- 2. An investor session reaches none of it -----------------------------
-- An investor authenticates on the same `authenticated` role but carries no
-- org_ids, so app.has_org() is false and no permissive policy matches.
do $$
declare n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","app_metadata":{}}', true);
  select count(*) into n from ingestion_items;   perform pg_temp.check('investor sees no items', n, 0);
  select count(*) into n from ingestion_batches; perform pg_temp.check('investor sees no batches', n, 0);
  select count(*) into n from property_events;   perform pg_temp.check('investor sees no events', n, 0);
  select count(*) into n from properties;        perform pg_temp.check('investor sees no properties', n, 0);
  select count(*) into n from opportunities;     perform pg_temp.check('investor sees no opportunities', n, 0);
  perform set_config('role', 'postgres', true);
end $$;

-- ---- 3. No ingestion table grants anything to anon --------------------------
do $$
declare n bigint;
begin
  select count(*) into n
    from information_schema.role_table_grants
   where grantee = 'anon'
     and table_name in ('ingestion_batches','ingestion_items','match_candidates',
                        'import_mapping_templates','property_events');
  perform pg_temp.check('anon holds no privilege on ingestion tables', n, 0);
end $$;

-- ---- 4. Property identity is actually unique -------------------------------
do $$
begin
  begin
    insert into properties(org_id, name, identity_key)
      values ('aaaaaaaa-0000-0000-0000-000000000001','Duplicate','pc:W1S2XJ|16conduitstreet');
    raise exception 'FAIL duplicate identity_key was accepted';
  exception when unique_violation then
    raise notice 'ok   duplicate identity_key rejected';
  end;

  -- Null keys must NOT collide: a property with too little address detail to
  -- key is legitimate and simply never auto-matches.
  insert into properties(org_id, name) values
    ('aaaaaaaa-0000-0000-0000-000000000001','Unkeyed 1'),
    ('aaaaaaaa-0000-0000-0000-000000000001','Unkeyed 2');
  raise notice 'ok   multiple null identity_keys allowed';
end $$;

-- ---- 5. The raw payload is frozen ------------------------------------------
do $$
begin
  begin
    update ingestion_items set raw_payload = '{}'::jsonb
     where item_id = 'eeeeeeee-0000-0000-0000-000000000001';
    raise exception 'FAIL raw_payload was mutable';
  exception when others then
    if sqlerrm like '%raw_payload is immutable%' then
      raise notice 'ok   raw_payload is immutable';
    else raise; end if;
  end;

  update ingestion_items set review_status = 'approved'
   where item_id = 'eeeeeeee-0000-0000-0000-000000000001';
  raise notice 'ok   other ingestion_items columns remain updatable';
end $$;

-- ---- 6. The status axes accept the new values and reject nonsense ----------
do $$
begin
  update opportunities set stage = 'investor_ready', status = 'watchlist',
         market_status = 'under_offer', reiwa_position = 'bid_submitted'
   where opportunity_id = 'ffffffff-0000-0000-0000-000000000001';
  raise notice 'ok   new stage/status/market_status/reiwa_position accepted';

  begin
    update opportunities set market_status = 'nonsense'
     where opportunity_id = 'ffffffff-0000-0000-0000-000000000001';
    raise exception 'FAIL market_status accepted an invalid value';
  exception when check_violation then
    raise notice 'ok   market_status rejects invalid values';
  end;
end $$;

-- ---- 7. Events survive their opportunity, keeping property history ---------
-- The longitudinal claim: deleting a marketing campaign must not erase what we
-- learned about the building.
do $$
declare n bigint;
begin
  delete from opportunities where opportunity_id = 'ffffffff-0000-0000-0000-000000000001';
  select count(*) into n from property_events
   where property_id = 'cccccccc-0000-0000-0000-000000000001';
  perform pg_temp.check('property events outlive the opportunity', n, 1);

  select count(*) into n from property_events
   where property_id = 'cccccccc-0000-0000-0000-000000000001' and opportunity_id is null;
  perform pg_temp.check('the surviving event detached cleanly', n, 1);
end $$;

\echo ''
\echo 'All migration assertions passed.'
