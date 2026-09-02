-- ============================================================================
-- 20260901000002 — Property (neutral identity) → Opportunity → Investment Case
--                  → Transaction
-- ----------------------------------------------------------------------------
-- Unchanged data model from the approved persistence gate. Policies use the
-- Supabase-native helpers (auth.uid()-derived membership): reads via has_org,
-- writes via can_write_org. Approved investment cases and transactions remain
-- IMMUTABLE via triggers.
-- ============================================================================

-- ---- Portfolios & properties -----------------------------------------------
create table if not exists portfolios (
  portfolio_id uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(org_id) on delete cascade,
  name         text not null,
  country      text,
  currency     text not null default 'GBP',
  created_at   timestamptz not null default now()
);
create index if not exists idx_portfolios_org on portfolios(org_id);

create table if not exists properties (
  property_id uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(org_id) on delete cascade,
  name        text not null,
  address     text,
  city        text,
  country     text,
  market      text,
  asset_type  text not null default 'other',
  latitude    numeric(9,6),
  longitude   numeric(9,6),
  created_at  timestamptz not null default now()
);
create index if not exists idx_properties_org on properties(org_id);

-- ---- Opportunities (the pipeline record) -----------------------------------
create table if not exists opportunities (
  opportunity_id     uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(org_id) on delete cascade,
  property_id        uuid references properties(property_id),
  reference          text,
  name               text not null,
  market             text,
  submarket          text,
  asset_type         text not null default 'other',
  strategy           text,
  stage              text not null default 'new'
                      check (stage in ('new','screening','underwriting','ic','approved','acquired')),
  status             text not null default 'active'
                      check (status in ('active','rejected','withdrawn','lost','converted')),
  currency           text not null default 'GBP',
  target_price       numeric(18,2),
  source             text,
  broker_name        text,
  vendor_name        text,
  size_sqft          numeric(14,2),
  size_sqm           numeric(14,2),
  passing_rent       numeric(18,2),
  erv                numeric(18,2),
  niy                numeric(7,4),
  reversionary_yield numeric(7,4),
  capex_budget       numeric(18,2),
  target_irr         numeric(7,4),
  equity_multiple    numeric(7,4),
  probability        int,
  summary            text,
  owner_user_id      uuid references users(user_id),
  created_by         uuid references users(user_id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  archived_at        timestamptz
);
create index if not exists idx_opportunities_org on opportunities(org_id);
create index if not exists idx_opportunities_stage on opportunities(org_id, stage);

create or replace function app.touch_updated_at() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_opportunities_touch on opportunities;
create trigger trg_opportunities_touch before update on opportunities
  for each row execute function app.touch_updated_at();

-- ---- Investment case (underwriting snapshot; approved => immutable) ---------
create table if not exists investment_cases (
  case_id                 uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references organizations(org_id) on delete cascade,
  opportunity_id          uuid not null references opportunities(opportunity_id) on delete cascade,
  version                 int not null default 1,
  status                  text not null default 'draft' check (status in ('draft','approved')),
  approved_at             timestamptz,
  acquisition_price       numeric(18,2),
  acquisition_date        date,
  noi                     numeric(18,2),
  occupancy_pct           numeric(5,2),
  erv                     numeric(18,2),
  capex                   numeric(18,2),
  debt                    numeric(18,2),
  ltv_pct                 numeric(7,4),
  valuation               numeric(18,2),
  target_irr              numeric(7,4),
  target_equity_multiple  numeric(7,4),
  thesis                  text,
  business_plan_assumptions text,
  created_at              timestamptz not null default now(),
  unique (opportunity_id, version)
);
create index if not exists idx_cases_opp on investment_cases(opportunity_id);

-- ---- Transaction (acquisition; immutable) ----------------------------------
create table if not exists transactions (
  transaction_id     uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(org_id) on delete cascade,
  opportunity_id     uuid not null references opportunities(opportunity_id),
  property_id        uuid references properties(property_id),
  investment_case_id uuid references investment_cases(case_id),
  acquisition_price  numeric(18,2),
  acquisition_date   date,
  acquisition_costs  numeric(18,2),
  equity_invested    numeric(18,2),
  debt               numeric(18,2),
  completed_at       timestamptz not null default now(),
  created_at         timestamptz not null default now()
);
create index if not exists idx_transactions_opp on transactions(opportunity_id);

-- ---- Immutability guards ---------------------------------------------------
create or replace function app.block_if_approved_case() returns trigger
  language plpgsql as $$
  begin
    if (tg_op = 'DELETE') then
      if old.status = 'approved' then
        raise exception 'Approved investment case % is immutable', old.case_id;
      end if;
      return old;
    end if;
    if old.status = 'approved' then
      raise exception 'Approved investment case % is immutable', old.case_id;
    end if;
    return new;
  end $$;
drop trigger if exists trg_cases_immutable on investment_cases;
create trigger trg_cases_immutable before update or delete on investment_cases
  for each row execute function app.block_if_approved_case();

create or replace function app.block_transaction_change() returns trigger
  language plpgsql as $$
  begin
    raise exception 'Transactions are immutable (transaction %)', coalesce(old.transaction_id, new.transaction_id);
  end $$;
drop trigger if exists trg_transactions_immutable on transactions;
create trigger trg_transactions_immutable before update or delete on transactions
  for each row execute function app.block_transaction_change();

-- ---- RLS: reads via has_org; writes via can_write_org ------------------------
do $$
declare t text;
begin
  foreach t in array array['portfolios','properties','opportunities','investment_cases','transactions'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select to authenticated using (app.has_org(org_id))', t, t);
    execute format('drop policy if exists %I_insert on %I', t, t);
    execute format('create policy %I_insert on %I for insert to authenticated with check (app.has_org(org_id) and app.can_write_org(org_id))', t, t);
    execute format('drop policy if exists %I_update on %I', t, t);
    execute format('create policy %I_update on %I for update to authenticated using (app.has_org(org_id) and app.can_write_org(org_id)) with check (app.has_org(org_id) and app.can_write_org(org_id))', t, t);
    execute format('drop policy if exists %I_delete on %I', t, t);
    execute format('create policy %I_delete on %I for delete to authenticated using (app.has_org(org_id) and app.can_write_org(org_id))', t, t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;
