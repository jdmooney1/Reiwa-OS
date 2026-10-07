-- ============================================================================
-- 0038 — Deal-level flags, and the investor introduction/progression register
-- ----------------------------------------------------------------------------
-- PART 1 adds the deal-level flags the Session 3 gate evaluator reads for
-- conditional gates (geared, hedged, jurisdiction) — small enough not to
-- deserve its own migration, and it belongs beside the investor-level
-- equivalent (`deal_investor.investor_type`) added in Part 2.
--
-- PART 2 is the club-deal model: one opportunity, many investors, each at
-- their own point in their own process — the product brief's founding
-- requirement. `investor_org_id` points at the EXISTING, separate investor
-- tenancy (investor_organizations, 0005); this table is written only by
-- staff and lives entirely in the internal schema, so nothing here crosses
-- the investor/staff boundary docs 12/14/20 keep shut.
--
-- `originating_share_id` (docs/24 revision) is a staff-side FK to
-- `deal_shares` (0029) — admin table to admin table, no investor_* path
-- touched. It lets a prospect who was first shown the deal via a prospect
-- link, and only later formally tracked, carry their real introduction date
-- forward rather than restarting the clock at the day someone got round to
-- adding them.
-- ============================================================================

-- ============================================================================
-- Part 1 — deal-level flags
-- ============================================================================
alter table opportunities
  add column if not exists flags jsonb not null default '{}'::jsonb;

comment on column opportunities.flags is
  'Deal-level conditions the gate engine reads for conditional doc_type.gate_condition values: {"geared": true, "hedged": true, "jurisdiction": "UK"|"NL"}. Investor-level conditions (investor_type:corporate) live on deal_investor instead.';

-- ============================================================================
-- Part 2 — deal_investor and its status log
-- ============================================================================
create table if not exists deal_investor (
  deal_investor_id uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(org_id) on delete cascade,
  opportunity_id   uuid not null references opportunities(opportunity_id) on delete cascade,
  investor_org_id  uuid not null references investor_organizations(investor_org_id) on delete restrict,

  status           text not null default 'matched'
                     check (status in ('matched', 'teaser_sent', 'nda_signed', 'pack_released',
                                        'ioi_received', 'soft_circled', 'committed',
                                        'completed', 'declined')),

  -- Staff-side only. See docs/24 §2 revision — never joined against anything
  -- investor_*; deal_shares is itself an admin-only table (0029).
  originating_share_id uuid references deal_shares(share_id) on delete set null,
  -- Computed and protected by app.set_deal_investor_first_introduced() below.
  -- Never written directly by application code.
  first_introduced_at  timestamptz not null default now(),

  introduced_by  uuid references profiles(user_id),
  investor_type  text check (investor_type in ('individual', 'corporate', 'family_office', 'institutional', 'other')),
  flags          jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists deal_investor_one_per_opportunity
  on deal_investor(opportunity_id, investor_org_id);
create index if not exists idx_deal_investor_opportunity on deal_investor(opportunity_id);
create index if not exists idx_deal_investor_org_investor on deal_investor(investor_org_id);

comment on table deal_investor is
  'One row per (opportunity, investor organisation): the club-deal progression and introduction register for mandated investors. For pre-mandate prospects, see the deal_introduction_register view (0044) over deal_shares/deal_share_views instead — never this table.';

drop trigger if exists trg_deal_investor_touch on deal_investor;
create trigger trg_deal_investor_touch before update on deal_investor
  for each row execute function app.touch_updated_at();

-- ---- first_introduced_at: computed, monotonically non-increasing ----------
create or replace function app.set_deal_investor_first_introduced() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    earliest_view timestamptz;
  begin
    if tg_op = 'INSERT' then
      if new.originating_share_id is not null then
        select min(viewed_at) into earliest_view
          from public.deal_share_views where share_id = new.originating_share_id;
      end if;
      -- The earlier of "this row was created" and "the originating share was
      -- first opened before we even created it". Never trusts a caller-
      -- supplied value for this column at all.
      new.first_introduced_at := least(now(), coalesce(earliest_view, now()));
      return new;
    end if;

    if tg_op = 'UPDATE' then
      if new.originating_share_id is distinct from old.originating_share_id
         and new.originating_share_id is not null then
        select min(viewed_at) into earliest_view
          from public.deal_share_views where share_id = new.originating_share_id;
        if earliest_view is not null and earliest_view < old.first_introduced_at then
          new.first_introduced_at := earliest_view;
          return new;
        end if;
      end if;
      -- No legitimate recomputation applies: the value may not move.
      if new.first_introduced_at is distinct from old.first_introduced_at then
        raise exception
          'deal_investor.first_introduced_at (row %) is immutable except when an earlier-viewed originating_share_id is attached',
          old.deal_investor_id;
      end if;
      return new;
    end if;

    return new;
  end
  $fn$;

drop trigger if exists trg_deal_investor_first_introduced on deal_investor;
create trigger trg_deal_investor_first_introduced before insert or update on deal_investor
  for each row execute function app.set_deal_investor_first_introduced();

-- ---- status log -------------------------------------------------------------
create table if not exists deal_investor_status_log (
  log_id           uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(org_id) on delete cascade,
  deal_investor_id uuid not null references deal_investor(deal_investor_id) on delete cascade,
  from_status      text,
  to_status        text not null,
  at               timestamptz not null default now(),
  changed_by       uuid references profiles(user_id)
);
create index if not exists idx_deal_investor_status_log on deal_investor_status_log(deal_investor_id, at desc);

comment on table deal_investor_status_log is
  'Append-only. Written only by app.log_deal_investor_status_change() — status on deal_investor is never changed without a logged reason to look back on.';

-- SECURITY DEFINER, for the same reason app.record_doc_type_audit() (0036)
-- is: `authenticated` has no grant on deal_investor_status_log at all, by
-- design, so a SECURITY INVOKER trigger would fail to write it.
create or replace function app.log_deal_investor_status_change() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  begin
    if tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.status is distinct from new.status) then
      insert into public.deal_investor_status_log (org_id, deal_investor_id, from_status, to_status, changed_by)
        values (new.org_id, new.deal_investor_id,
                case when tg_op = 'INSERT' then null else old.status end,
                new.status, app.current_user_id()::uuid);
    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_deal_investor_status_log on deal_investor;
create trigger trg_deal_investor_status_log after insert or update on deal_investor
  for each row execute function app.log_deal_investor_status_change();

-- ---- RLS --------------------------------------------------------------------
alter table deal_investor enable row level security;
alter table deal_investor_status_log enable row level security;

drop policy if exists deal_investor_select on deal_investor;
create policy deal_investor_select on deal_investor for select to authenticated
  using (app.has_org(org_id));
drop policy if exists deal_investor_insert on deal_investor;
create policy deal_investor_insert on deal_investor for insert to authenticated
  with check (app.has_org(org_id) and app.can_write());
drop policy if exists deal_investor_update on deal_investor;
create policy deal_investor_update on deal_investor for update to authenticated
  using (app.has_org(org_id) and app.can_write()) with check (app.has_org(org_id) and app.can_write());
drop policy if exists deal_investor_delete on deal_investor;
create policy deal_investor_delete on deal_investor for delete to authenticated
  using (app.has_org(org_id) and app.can_write());

drop policy if exists deal_investor_status_log_select on deal_investor_status_log;
create policy deal_investor_status_log_select on deal_investor_status_log for select to authenticated
  using (app.has_org(org_id));
-- No insert/update/delete policy for any role — the trigger's SECURITY
-- DEFINER status writes it regardless; `authenticated` has no grant (below)
-- so nothing else can.

revoke all on deal_investor, deal_investor_status_log from anon, public;
grant select, insert, update, delete on deal_investor to authenticated;
grant select on deal_investor_status_log to authenticated;

-- ROLLBACK:
--   drop trigger if exists trg_deal_investor_status_log on deal_investor;
--   drop function if exists app.log_deal_investor_status_change();
--   drop table if exists deal_investor_status_log;
--   drop trigger if exists trg_deal_investor_first_introduced on deal_investor;
--   drop function if exists app.set_deal_investor_first_introduced();
--   drop trigger if exists trg_deal_investor_touch on deal_investor;
--   drop table if exists deal_investor;
--   alter table opportunities drop column if exists flags;
