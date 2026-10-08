-- ============================================================================
-- 0050 - Investor mandates (what an investor organisation is looking for)
-- ----------------------------------------------------------------------------
-- A mandate is the investor ORGANISATION's stated appetite: the markets, asset types and
-- strategies it wants, the deal size it will consider and the entry yield it needs. It lets Reiwa
-- staff answer "who should I call about this deal" and "what does this investor want".
--
-- STAFF ONLY. This table is on the internal side of the wall 0005 draws, and it is built to stay
-- there:
--   * one policy, Reiwa admin (app.is_admin()), for everything. NO investor policy exists, so an
--     investor session matches nothing and reads no row, whichever columns it asks for.
--   * it is a table of its own, not columns on investor_organizations. An investor-readable row
--     is readable in full (a row policy filters rows, never columns), and 0038 had to remove a
--     policy for exactly that reason. A mandate is the sort of thing that must never be one
--     policy mistake away from the investor it describes.
--   * nothing in the portal, the investor feed or any investor view references it.
--
-- PER ORGANISATION, NOT PER CONTACT. A contact is who to talk to; the mandate is what the
-- organisation wants. One row per organisation (the organisation id is the key).
--
-- NOT THE INVESTMENT SCORE. src/lib/scoring is Reiwa's own 11-factor assessment of a deal's
-- quality. This is a different question - does a deal fit what a particular investor says it
-- wants - and shares no column, function or vocabulary with it.
--
-- DEAL SIZE IS A SIMPLIFICATION. deal_size_min / deal_size_max are compared with a deal's TOTAL
-- COST. An investor's real "ticket" is its equity cheque, which depends on leverage and any
-- co-investment, and no equity-required figure exists on a deal yet. Treat these as "the size of
-- deal they will look at", not as a finished definition of ticket size.
--
-- NOTHING ELSE CHANGES. No existing table, policy or grant is touched. Rolling back is
-- `drop table` (supabase/rollback/0050_investor_mandates.down.sql); it loses only mandates. The
-- screens hide their mandate cards if the table is missing, so applying late does not break them.
-- Deleting an investor organisation deletes its mandate (on delete cascade).
-- ============================================================================

create table if not exists public.investor_mandates (
  investor_org_id      uuid primary key references public.investor_organizations(investor_org_id) on delete cascade,
  -- Empty = no preference on that dimension (it is not tested), not "nothing".
  markets              text[] not null default '{}'  check (cardinality(markets) <= 12),
  asset_types          text[] not null default '{}'  check (cardinality(asset_types) <= 12),
  strategies           text[] not null default '{}'  check (cardinality(strategies) <= 12),
  deal_size_min        numeric(18,2) check (deal_size_min is null or deal_size_min >= 0),
  deal_size_max        numeric(18,2) check (deal_size_max is null or deal_size_max >= 0),
  currency             text not null default 'GBP' check (currency in ('GBP', 'EUR', 'USD', 'JPY')),
  min_entry_yield_pct  numeric(5,2) check (min_entry_yield_pct is null or (min_entry_yield_pct >= 0 and min_entry_yield_pct <= 100)),
  updated_by           uuid references public.profiles(user_id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint investor_mandates_size_order
    check (deal_size_min is null or deal_size_max is null or deal_size_min <= deal_size_max)
);

comment on table public.investor_mandates is
  'Staff-only: what an investor organisation is looking for. No investor policy. Not the investment score.';

drop trigger if exists trg_investor_mandates_touch on public.investor_mandates;
create trigger trg_investor_mandates_touch before update on public.investor_mandates
  for each row execute function app.touch_updated_at();

alter table public.investor_mandates enable row level security;

drop policy if exists investor_mandates_admin on public.investor_mandates;
create policy investor_mandates_admin on public.investor_mandates for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- 0007 removed the blanket default grant, so the privileges are named. RLS is what separates a
-- Reiwa admin from an investor (both are `authenticated`); anon and PUBLIC get nothing at all.
revoke all on public.investor_mandates from anon, public;
grant select, insert, update, delete on public.investor_mandates to authenticated;
