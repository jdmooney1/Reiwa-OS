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
-- adding them — but a backdate is never a quiet side effect of an UPDATE:
-- it must be evidenced by the attached share's own first view, move only
-- earlier, and carry a logged, authorised gate_override. See the function
-- below for the full rule (revised after review).
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

-- ---- first_introduced_at: computed at creation, backdatable only with evidence + a logged override ----------
-- Revised per review: the original version let an UPDATE that merely
-- attached an earlier-viewed originating_share_id move the value with no
-- accountability trail at all. Now EVERY post-creation move requires:
--   1. it is strictly earlier than the stored value — never later, no
--      exception, override or not;
--   2. the new value exactly equals what the (newly or already) attached
--      originating share's first view evidences — never an arbitrary
--      caller-supplied timestamp, override or not. An override authorises
--      WHO may apply evidence that already exists; it cannot manufacture
--      evidence that doesn't;
--   3. a matching gate_override row (action = 'backdate_first_introduced'),
--      inserted in the SAME transaction (app.guard_post_close_document_version,
--      0046, established the `go.at = now()` same-transaction correlation
--      this reuses), by admin/ic_member (RLS on gate_override, 0041).
-- Attaching/changing originating_share_id WITHOUT also attempting to move
-- first_introduced_at itself (i.e. leaving it at its stored value) is
-- unrestricted — it is provenance metadata, not the protected fact.
--
-- SECURITY DEFINER, found only by actually running this (not by reading it):
-- `deal_share_views` is readable by `app.is_admin()` ALONE (0029) — an
-- ordinary org_user/ic_member session reading it as SECURITY INVOKER gets
-- zero rows back, so `min(viewed_at)` silently returns NULL and the evidence
-- check fails for every non-admin caller, every time, with no indication why.
-- Same category of gap as app.record_doc_type_audit() / app.log_deal_investor_
-- status_change() (0036/0038) — reading something the caller's own privilege
-- can't reach, not just writing it.
create or replace function app.set_deal_investor_first_introduced() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  declare
    earliest_view timestamptz;
    has_override  boolean;
  begin
    if tg_op = 'INSERT' then
      if new.originating_share_id is not null then
        select min(viewed_at) into earliest_view
          from public.deal_share_views where share_id = new.originating_share_id;
      end if;
      -- The earlier of "this row was created" and "the originating share was
      -- first opened before we even created it". Never trusts a caller-
      -- supplied value for this column at all. Creation is not a "change"
      -- to an existing fact, so no override applies here.
      new.first_introduced_at := least(now(), coalesce(earliest_view, now()));
      return new;
    end if;

    -- tg_op = 'UPDATE'
    if new.first_introduced_at is distinct from old.first_introduced_at then
      if new.first_introduced_at > old.first_introduced_at then
        raise exception
          'deal_investor.first_introduced_at (row %) can never move later',
          old.deal_investor_id;
      end if;

      if new.originating_share_id is not null then
        select min(viewed_at) into earliest_view
          from public.deal_share_views where share_id = new.originating_share_id;
      end if;
      if earliest_view is null or earliest_view <> new.first_introduced_at then
        raise exception
          'deal_investor.first_introduced_at (row %) may only move to the date its originating share''s first view evidences',
          old.deal_investor_id;
      end if;

      select exists (
        select 1 from public.gate_override go
         where go.deal_investor_id = old.deal_investor_id
           and go.action = 'backdate_first_introduced'
           and go.at = now()
      ) into has_override;
      if not has_override then
        raise exception
          'deal_investor.first_introduced_at (row %) cannot be backdated without a matching backdate_first_introduced gate_override in the same transaction',
          old.deal_investor_id;
      end if;
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
