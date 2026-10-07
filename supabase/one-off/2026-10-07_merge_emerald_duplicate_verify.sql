-- READ ONLY. Run after 2026-10-07_merge_emerald_duplicate.sql was applied. Nothing here writes.
-- Survivor: 0f4d3e03-02ef-4957-918d-1ffb9d75bd48   Duplicate: b5c09009-02e1-4350-b163-e6c62fb74714

-- 1. The two records: the survivor active and renamed, the duplicate merged, archived and pointing at it.
select opportunity_id, reference, name, status, archived_at, merged_into_opportunity_id, broker_name, source_contact_name, deal_stage, size_sqft, property_id
  from opportunities
 where opportunity_id in ('0f4d3e03-02ef-4957-918d-1ffb9d75bd48', 'b5c09009-02e1-4350-b163-e6c62fb74714')
 order by created_at;

-- 2. Underwriting: the survivor's own v1 untouched, the duplicate's case kept as the next version, a DRAFT.
select opportunity_id, version, status, acquisition_price, entry_yield_pct, created_at
  from investment_cases
 where opportunity_id in ('0f4d3e03-02ef-4957-918d-1ffb9d75bd48', 'b5c09009-02e1-4350-b163-e6c62fb74714')
 order by opportunity_id, version;

-- 3. What the merge recorded on the survivor (old name, where the duplicate's values went, clashes left for a human).
select name, source_facts -> '_previous_names' as previous_names, jsonb_pretty(source_facts -> '_merged_from') as merged_from
  from opportunities where opportunity_id = '0f4d3e03-02ef-4957-918d-1ffb9d75bd48';

-- 4. The loader's audit row now points at the survivor, with the reason annotated.
select reference, outcome, reason, opportunity_id, property_id
  from deal_load_rows where opportunity_id = '0f4d3e03-02ef-4957-918d-1ffb9d75bd48' and reason like '%merged into%';

-- 5. The append-only timeline: both first-seen events still exist, plus one new note on the survivor's property.
select e.event_type, e.headline, e.opportunity_id, e.property_id, e.recorded_at
  from property_events e
 where e.opportunity_id in ('0f4d3e03-02ef-4957-918d-1ffb9d75bd48', 'b5c09009-02e1-4350-b163-e6c62fb74714')
 order by e.recorded_at;

-- 6. Nothing live is left that describes this building twice (should return no rows).
select a.opportunity_id as a_id, a.name as a_name, b.opportunity_id as b_id, b.name as b_name
  from opportunities a join opportunities b
    on a.org_id = b.org_id and a.property_id = b.property_id and a.opportunity_id < b.opportunity_id
 where a.status = 'active' and b.status = 'active'
   and a.opportunity_id in ('0f4d3e03-02ef-4957-918d-1ffb9d75bd48', 'b5c09009-02e1-4350-b163-e6c62fb74714');
