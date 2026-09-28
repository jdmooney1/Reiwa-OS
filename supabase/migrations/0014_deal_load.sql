-- ============================================================================
-- 0014 — Pipeline deal load: triage state and load provenance
-- ----------------------------------------------------------------------------
-- The first bulk load brings 132 opportunities out of a spreadsheet. Two things
-- have to be true of them that are not true of a record somebody typed.
--
-- 1. THEY ARE NOT TRIAGED, AND MUST NOT LOOK AS IF THEY ARE.
--    The staging workbook carries three columns - Status, Priority, Triage Note
--    - that are filled in by a human before a deal is believed. At load time
--    they are empty on all 132 rows. The tempting default is 'live', and it is
--    wrong: it would silently promote an untouched spreadsheet row into active
--    pipeline, and nothing downstream could tell it apart from a deal somebody
--    had actually looked at.
--
--    So `triage_status` is NOT NULL, defaults to 'untriaged', and 'untriaged'
--    is a real state rather than an absence. The count of untriaged rows is the
--    load's progress measure: it starts at 132 and falls to zero as triage
--    happens. A null would have made that number unknowable.
--
--    'dead' is not a lesser state than 'live'. A deal that was passed, sold or
--    withdrawn, with the reason recorded, is the record this system exists to
--    accumulate - see docs/17 on longitudinal intelligence. It loads, it keeps
--    its note, and it stays searchable.
--
-- 2. THEY MUST BE RE-LOADABLE WITHOUT DUPLICATING.
--    `reference` has existed since 0002 and was never used. It becomes the
--    load's idempotency key, unique per organisation, so re-running the loader
--    updates the row it made last time instead of making another. Partial,
--    because an opportunity created by hand has no reference and several such
--    nulls must not collide.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT ADD:
--
--   * No investor-visibility flag. Visibility already requires an explicit
--     `publication_sources` row (0005), so an opportunity with no publication
--     is invisible to every investor by construction. A second gate defaulting
--     closed would be a weaker copy of one that already fails closed, and two
--     gates disagreeing is worse than one.
--
--   * No JPY column anywhere. The workbook's JPY figures are display formulas
--     over two FX cells. Storing them would freeze a rate into the data and
--     reproduce exactly the staleness that made the spreadsheet untrustworthy.
--     Base currency and base amount are stored; JPY is a read-time conversion.
--
--   * No yield column on the opportunity. Yield is projected from the
--     investment case by the 0009 trigger, which is the only writer of money
--     onto an opportunity row.
-- ============================================================================

-- ---- 1. Triage -------------------------------------------------------------
alter table opportunities
  add column if not exists triage_status text not null default 'untriaged',
  add column if not exists triage_priority text,
  add column if not exists triage_note text,
  add column if not exists triaged_at timestamptz,
  add column if not exists triaged_by uuid references profiles(user_id);

alter table opportunities drop constraint if exists opportunities_triage_status_check;
alter table opportunities add constraint opportunities_triage_status_check
  check (triage_status in ('untriaged', 'live', 'dead', 'reference'));

alter table opportunities drop constraint if exists opportunities_triage_priority_check;
alter table opportunities add constraint opportunities_triage_priority_check
  check (triage_priority is null or triage_priority in ('P1', 'P2', 'P3'));

-- Priority is only meaningful on a live deal; a dead one carries its note.
alter table opportunities drop constraint if exists opportunities_triage_priority_scope_check;
alter table opportunities add constraint opportunities_triage_priority_scope_check
  check (triage_priority is null or triage_status = 'live');

comment on column opportunities.triage_status is
  'untriaged = loaded from the pipeline sheet and not yet reviewed. Never a '
  'null and never defaulted to live: an untriaged row must be visibly '
  'incomplete rather than silently active. dead = passed, sold or withdrawn, '
  'and kept deliberately - it is the longitudinal record, not a discard. '
  'reference = comparable evidence, never a deal.';

create index if not exists idx_opportunities_triage
  on opportunities(org_id, triage_status);

-- ---- 2. Idempotency --------------------------------------------------------
create unique index if not exists opportunities_reference_key
  on opportunities(org_id, reference) where reference is not null;

comment on column opportunities.reference is
  'External source reference (LON-001, AMS-014). Unique per organisation and '
  'used as the load idempotency key: re-running the loader updates the row it '
  'created rather than creating a second one.';

-- ---- 3. Load provenance ----------------------------------------------------
-- Which run produced a row, and what the source said at the time. Kept so a
-- figure can be traced back to the cell it came from months later, and so a
-- re-run can be compared against the one before it.
create table if not exists deal_load_batches (
  batch_id     uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(org_id) on delete cascade,
  source_file  text not null,
  source_sheet text,
  -- sha256 of the workbook, so an unchanged file is recognisable as such.
  content_hash text,
  rows_read    int not null default 0,
  rows_created int not null default 0,
  rows_updated int not null default 0,
  rows_skipped int not null default 0,
  rows_failed  int not null default 0,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  created_by   uuid not null references profiles(user_id)
);
create index if not exists idx_deal_load_batches_org
  on deal_load_batches(org_id, started_at desc);

create table if not exists deal_load_rows (
  load_row_id    uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(org_id) on delete cascade,
  batch_id       uuid not null references deal_load_batches(batch_id) on delete cascade,
  reference      text not null,
  -- The source row VERBATIM, every column including ones nothing maps to.
  -- Frozen after insert: it is the evidence behind every value derived from it.
  raw_row        jsonb not null,
  outcome        text not null
                   check (outcome in ('created', 'updated', 'skipped', 'failed', 'excluded')),
  reason         text,
  opportunity_id uuid references opportunities(opportunity_id) on delete set null,
  property_id    uuid references properties(property_id) on delete set null,
  -- True when the property could not be keyed, so this row is 1:1 with its
  -- property by default rather than by identity. Reported, never hidden.
  property_unkeyed boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (batch_id, reference)
);
create index if not exists idx_deal_load_rows_batch on deal_load_rows(batch_id);
create index if not exists idx_deal_load_rows_ref on deal_load_rows(org_id, reference);

create or replace function app.guard_deal_load_raw() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    if new.raw_row is distinct from old.raw_row then
      raise exception 'deal_load_rows.raw_row is immutable (row %)', old.load_row_id;
    end if;
    return new;
  end
  $fn$;
drop trigger if exists trg_deal_load_raw_immutable on deal_load_rows;
create trigger trg_deal_load_raw_immutable before update on deal_load_rows
  for each row execute function app.guard_deal_load_raw();

-- ---- 4. RLS and privileges -------------------------------------------------
-- The 0002 shape. No investor policy is written, so an investor session - which
-- holds no organisation membership - matches no permissive policy here and
-- reads nothing. 0007 removed the blanket default grant, so `authenticated` is
-- named explicitly and `anon` is revoked rather than assumed.
do $$
declare t text;
begin
  foreach t in array array['deal_load_batches', 'deal_load_rows'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select to authenticated using (app.has_org(org_id))', t, t);
    execute format('drop policy if exists %I_insert on %I', t, t);
    execute format('create policy %I_insert on %I for insert to authenticated with check (app.has_org(org_id) and app.can_write())', t, t);
    execute format('drop policy if exists %I_update on %I', t, t);
    execute format('create policy %I_update on %I for update to authenticated using (app.has_org(org_id) and app.can_write()) with check (app.has_org(org_id) and app.can_write())', t, t);
    execute format('revoke all on %I from anon, public', t);
    execute format('grant select, insert, update on %I to authenticated', t);
  end loop;
end $$;
