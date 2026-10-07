-- ============================================================================
-- 0052 — flag governance: audited edits, an admin+reason gate, staff-only
-- platform_settings
-- ----------------------------------------------------------------------------
-- Two independent fixes from the same review round:
--
-- 1. Every edit to opportunities.flags or deal_investor.flags is now logged
--    (who, when, before/after — same shape as every other audit table in
--    this codebase), and specifically turning regulated_disclosure OFF at
--    either level while the platform_settings default is ON requires a
--    reiwa_admin AND a non-empty reason (the legitimate case: a specified/
--    professional investor exemption). Turning it on needs no special role.
--    Any other flags edit (a different key, or regulated_disclosure moving
--    in the direction the platform already defaults to) is unrestricted
--    beyond the ordinary can_write() RLS already on these tables — this is
--    a narrow gate on one specific, risky transition, not a lockdown of the
--    column.
--
--    The reason has nowhere to live in a plain `update ... set flags = $1`
--    statement, so it travels as a transaction-local GUC
--    (`app.flag_change_reason`, set with `set_config(..., true)` exactly as
--    `withSession` already does for `request.jwt.claims`) rather than a
--    persistent column that would need clearing after the fact. A caller
--    that updates flags without going through
--    src/lib/data/deal-flags.ts — including a raw UPDATE run directly in
--    SQL — simply never sets that GUC, so it reads as "no reason given" and
--    the gated transition is refused exactly as if a reason had been
--    omitted on purpose.
--
-- 2. platform_settings was readable by any authenticated session (0051),
--    which includes the investor portal — an investor must not be able to
--    read a firm-wide setting at all. Restricted to internal staff via
--    app.current_global_role() <> 'anon', the same idiom
--    app.current_global_role() itself establishes (an investor session
--    carries no global_role claim and defaults to 'anon' there).
-- ============================================================================

-- ---- Fix 2: platform_settings is staff-only, not every authenticated session
drop policy if exists platform_settings_select on platform_settings;
create policy platform_settings_select on platform_settings for select to authenticated
  using (app.current_global_role() <> 'anon');
-- platform_settings_admin_write (0051) is unchanged: still is_admin()-gated,
-- and a subset of what staff may now read.

-- ---- Fix 1: audit tables, same shape as opportunity_legacy_exempt_audit (0050)
create table if not exists opportunity_flags_audit (
  audit_id       uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(opportunity_id) on delete cascade,
  before         jsonb not null,
  after          jsonb not null,
  reason         text,
  changed_by     uuid references profiles(user_id),
  changed_at     timestamptz not null default now()
);
create index if not exists idx_opportunity_flags_audit_opp
  on opportunity_flags_audit(opportunity_id, changed_at desc);

create table if not exists deal_investor_flags_audit (
  audit_id         uuid primary key default gen_random_uuid(),
  deal_investor_id uuid not null references deal_investor(deal_investor_id) on delete cascade,
  before           jsonb not null,
  after            jsonb not null,
  reason           text,
  changed_by       uuid references profiles(user_id),
  changed_at       timestamptz not null default now()
);
create index if not exists idx_deal_investor_flags_audit_di
  on deal_investor_flags_audit(deal_investor_id, changed_at desc);

comment on table opportunity_flags_audit is
  'Append-only history of every opportunities.flags change. Written only by app.record_opportunity_flags_audit() — never by application code.';
comment on table deal_investor_flags_audit is
  'Append-only history of every deal_investor.flags change. Written only by app.record_deal_investor_flags_audit() — never by application code.';

alter table opportunity_flags_audit enable row level security;
alter table deal_investor_flags_audit enable row level security;

drop policy if exists opportunity_flags_audit_select on opportunity_flags_audit;
create policy opportunity_flags_audit_select on opportunity_flags_audit for select to authenticated
  using (exists (
    select 1 from opportunities o
     where o.opportunity_id = opportunity_flags_audit.opportunity_id
       and app.has_org(o.org_id)
  ));

drop policy if exists deal_investor_flags_audit_select on deal_investor_flags_audit;
create policy deal_investor_flags_audit_select on deal_investor_flags_audit for select to authenticated
  using (exists (
    select 1 from deal_investor di
     where di.deal_investor_id = deal_investor_flags_audit.deal_investor_id
       and app.has_org(di.org_id)
  ));

revoke all on opportunity_flags_audit, deal_investor_flags_audit from anon, public;
grant select on opportunity_flags_audit to authenticated;
grant select on deal_investor_flags_audit to authenticated;
-- No insert/update/delete policy for either — same reasoning as every other
-- audit table here: the trigger is SECURITY DEFINER, and `authenticated`
-- has no grant to write either table directly.

-- ---- Guard: the one gated transition (per table) --------------------------
create or replace function app.guard_opportunity_flags_regulated_disclosure() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    old_rd boolean;
    new_rd boolean;
    platform_rd boolean;
    reason text;
  begin
    if new.flags is distinct from old.flags then
      old_rd := coalesce((old.flags->>'regulated_disclosure')::boolean, false);
      new_rd := coalesce((new.flags->>'regulated_disclosure')::boolean, false);
      if old_rd and not new_rd then
        select (value = 'true'::jsonb) into platform_rd
          from public.platform_settings where key = 'regulated_disclosure';
        if coalesce(platform_rd, false) then
          if not app.is_admin() then
            raise exception
              'Turning off regulated_disclosure for opportunity % while the platform setting is on requires a reiwa_admin',
              old.opportunity_id;
          end if;
          reason := nullif(btrim(current_setting('app.flag_change_reason', true)), '');
          if reason is null then
            raise exception
              'Turning off regulated_disclosure for opportunity % while the platform setting is on requires a reason',
              old.opportunity_id;
          end if;
        end if;
      end if;
    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_opportunity_flags_guard on opportunities;
create trigger trg_opportunity_flags_guard before update on opportunities
  for each row execute function app.guard_opportunity_flags_regulated_disclosure();

create or replace function app.guard_deal_investor_flags_regulated_disclosure() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    old_rd boolean;
    new_rd boolean;
    platform_rd boolean;
    reason text;
  begin
    if new.flags is distinct from old.flags then
      old_rd := coalesce((old.flags->>'regulated_disclosure')::boolean, false);
      new_rd := coalesce((new.flags->>'regulated_disclosure')::boolean, false);
      if old_rd and not new_rd then
        select (value = 'true'::jsonb) into platform_rd
          from public.platform_settings where key = 'regulated_disclosure';
        if coalesce(platform_rd, false) then
          if not app.is_admin() then
            raise exception
              'Turning off regulated_disclosure for deal_investor % while the platform setting is on requires a reiwa_admin',
              old.deal_investor_id;
          end if;
          reason := nullif(btrim(current_setting('app.flag_change_reason', true)), '');
          if reason is null then
            raise exception
              'Turning off regulated_disclosure for deal_investor % while the platform setting is on requires a reason',
              old.deal_investor_id;
          end if;
        end if;
      end if;
    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_deal_investor_flags_guard on deal_investor;
create trigger trg_deal_investor_flags_guard before update on deal_investor
  for each row execute function app.guard_deal_investor_flags_regulated_disclosure();

-- ---- Audit: every flags change, gated or not -------------------------------
create or replace function app.record_opportunity_flags_audit() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  begin
    if new.flags is distinct from old.flags then
      insert into public.opportunity_flags_audit (opportunity_id, before, after, reason, changed_by)
        values (new.opportunity_id, old.flags, new.flags,
                nullif(btrim(current_setting('app.flag_change_reason', true)), ''),
                app.current_user_id()::uuid);
    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_opportunity_flags_audit on opportunities;
create trigger trg_opportunity_flags_audit after update on opportunities
  for each row execute function app.record_opportunity_flags_audit();

create or replace function app.record_deal_investor_flags_audit() returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  begin
    if new.flags is distinct from old.flags then
      insert into public.deal_investor_flags_audit (deal_investor_id, before, after, reason, changed_by)
        values (new.deal_investor_id, old.flags, new.flags,
                nullif(btrim(current_setting('app.flag_change_reason', true)), ''),
                app.current_user_id()::uuid);
    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_deal_investor_flags_audit on deal_investor;
create trigger trg_deal_investor_flags_audit after update on deal_investor
  for each row execute function app.record_deal_investor_flags_audit();

-- ROLLBACK:
--   drop trigger if exists trg_deal_investor_flags_audit on deal_investor;
--   drop function if exists app.record_deal_investor_flags_audit();
--   drop trigger if exists trg_opportunity_flags_audit on opportunities;
--   drop function if exists app.record_opportunity_flags_audit();
--   drop trigger if exists trg_deal_investor_flags_guard on deal_investor;
--   drop function if exists app.guard_deal_investor_flags_regulated_disclosure();
--   drop trigger if exists trg_opportunity_flags_guard on opportunities;
--   drop function if exists app.guard_opportunity_flags_regulated_disclosure();
--   drop table if exists deal_investor_flags_audit;
--   drop table if exists opportunity_flags_audit;
--   drop policy if exists platform_settings_select on platform_settings;
--   create policy platform_settings_select on platform_settings for select to authenticated using (true);
