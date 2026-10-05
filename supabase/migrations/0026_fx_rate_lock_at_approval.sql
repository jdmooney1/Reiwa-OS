-- ============================================================================
-- 0026 - Lock the FX rate that drove a case when the committee approves it
-- ----------------------------------------------------------------------------
-- fx_rates moves (daily, from the ECB, or by an administrator). An approved
-- case's numbers must not move with it: the committee decided against ONE rate,
-- and that rate has to stay recoverable after the live one has gone elsewhere.
--
-- The snapshot is taken by app.apply_ic_decision(), in the SAME statement that
-- flips the case to 'approved' and stamps approved_at / approved_by. Not by the
-- application: for the same reason approval itself lives in the trigger, there is
-- no path to an approved case with no rate recorded beside it.
--
-- What is locked is the rate for the OPPORTUNITY's currency (investment_cases has
-- no currency column of its own; the opportunity does, and a case is a version of
-- it). Three columns, all NULL until approval and then immutable:
--
--   fx_rate_to_gbp_at_approval   GBP per 1 unit of the case currency
--   fx_rate_source_at_approval   the source string the rate carried at that moment
--   fx_rate_as_of_at_approval    the date the rate was good for
--
-- Nothing is fabricated:
--   * a draft case has none of the three;
--   * a case approved before this migration has none, and is NOT backfilled (today's
--     rate against a past approval would be a number the committee never saw);
--   * if fx_rates has no row for the currency at that instant, all three stay NULL
--     and the memo says no rate was locked. The approval itself is not blocked.
-- The CHECK makes the three move together.
--
-- Immutability needs no new rule. app.block_if_approved_case() (0008) compares
-- to_jsonb(old) with to_jsonb(new) wholesale, naming only the columns that MAY
-- move (status, superseded_at, and the generated total_cost), so a column added
-- here is locked the moment it exists. tests/fx-rate-lock.test.ts proves it.
--
-- create or replace keeps the EXECUTE revoke from 0022 (grants survive a replace).
-- ============================================================================
alter table investment_cases
  add column if not exists fx_rate_to_gbp_at_approval numeric(12,6),
  add column if not exists fx_rate_source_at_approval text,
  add column if not exists fx_rate_as_of_at_approval  date;

alter table investment_cases drop constraint if exists investment_cases_fx_lock_whole;
alter table investment_cases add constraint investment_cases_fx_lock_whole check (
  (fx_rate_to_gbp_at_approval is null) = (fx_rate_source_at_approval is null)
  and (fx_rate_to_gbp_at_approval is null) = (fx_rate_as_of_at_approval is null)
);

alter table investment_cases drop constraint if exists investment_cases_fx_lock_only_when_approved;
alter table investment_cases add constraint investment_cases_fx_lock_only_when_approved check (
  fx_rate_to_gbp_at_approval is null or status in ('approved', 'superseded')
);

comment on column investment_cases.fx_rate_to_gbp_at_approval is
  'GBP per 1 unit of the opportunity currency, as it stood in fx_rates when the committee approved this case. NULL for drafts, for cases approved before 0026, and when no rate existed. Immutable once approved (app.block_if_approved_case).';

create or replace function app.apply_ic_decision() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    case_status text;
    lock_rate   numeric(12,6);
    lock_source text;
    lock_as_of  date;
  begin
    select status into case_status
      from public.investment_cases where case_id = new.investment_case_id;

    if case_status = 'superseded' then
      raise exception 'Investment case % is superseded and cannot be taken to committee',
        new.investment_case_id;
    end if;

    if new.outcome in ('approved', 'approved_with_conditions') then
      -- Close out any earlier approval for this opportunity first, so the
      -- single-live-approved index never sees two.
      update public.investment_cases
         set status = 'superseded', superseded_at = now()
       where opportunity_id = new.opportunity_id
         and status = 'approved'
         and case_id <> new.investment_case_id;

      if case_status <> 'approved' then
        -- The rate live at this instant for the deal's currency. No row, no lock:
        -- the three variables stay NULL rather than becoming a guess.
        select f.rate_to_gbp, f.source, f.as_of_date
          into lock_rate, lock_source, lock_as_of
          from public.opportunities o
          join public.fx_rates f on f.currency = o.currency
         where o.opportunity_id = new.opportunity_id;

        update public.investment_cases
           set status = 'approved', approved_at = now(), approved_by = new.recorded_by,
               fx_rate_to_gbp_at_approval = lock_rate,
               fx_rate_source_at_approval = lock_source,
               fx_rate_as_of_at_approval  = lock_as_of
         where case_id = new.investment_case_id;
      end if;
    end if;

    return new;
  end
  $fn$;
