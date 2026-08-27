-- ============================================================================
-- 0003 — Asset Intelligence (persisted Phase-1 subset)
-- ----------------------------------------------------------------------------
-- asset = the owned position, created on conversion, linked to property /
-- opportunity / investment_case / transaction. The first business_plan
-- (plan_type='underwriting') is IMMUTABLE — the original underwriting baseline.
-- Forecasts are new versions; actuals are append-only performance_periods.
-- ============================================================================

create table if not exists assets (
  asset_id           uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(org_id) on delete cascade,
  portfolio_id       uuid references portfolios(portfolio_id),
  property_id        uuid references properties(property_id),
  opportunity_id     uuid references opportunities(opportunity_id),
  investment_case_id uuid references investment_cases(case_id),
  transaction_id     uuid references transactions(transaction_id),
  name               text not null,
  lifecycle_stage    text not null default 'operating',
  currency           text not null default 'GBP',
  acquisition_date   date,
  acquisition_price  numeric(18,2),
  equity_invested    numeric(18,2),
  hold_thesis        text,
  is_demo            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_assets_org on assets(org_id);
create index if not exists idx_assets_property on assets(property_id);

-- Shared metric columns for plans & periods (three-way comparison).
create table if not exists business_plans (
  plan_id             uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(org_id) on delete cascade,
  asset_id            uuid not null references assets(asset_id) on delete cascade,
  plan_type           text not null check (plan_type in ('underwriting','approved','current_forecast')),
  version             int not null default 1,
  as_of_date          date not null,
  label               text,
  gross_rental_income numeric(18,2),
  noi                 numeric(18,2),
  operating_expenses  numeric(18,2),
  occupancy_pct       numeric(5,2),
  capex               numeric(18,2),
  valuation           numeric(18,2),
  yield_pct           numeric(7,4),
  debt                numeric(18,2),
  ltv_pct             numeric(7,4),
  cash_on_cash_pct    numeric(7,4),
  equity_multiple     numeric(7,4),
  irr_pct             numeric(7,4),
  created_at          timestamptz not null default now(),
  unique (asset_id, plan_type, version)
);
create index if not exists idx_plans_asset on business_plans(asset_id);

-- The underwriting baseline is immutable.
create or replace function app.block_underwriting_plan() returns trigger
  language plpgsql as $$
  begin
    if coalesce(old.plan_type, '') = 'underwriting' then
      raise exception 'Underwriting business plan % is immutable', old.plan_id;
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end $$;
drop trigger if exists trg_plans_immutable on business_plans;
create trigger trg_plans_immutable before update or delete on business_plans
  for each row execute function app.block_underwriting_plan();

create table if not exists performance_periods (
  period_id           uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(org_id) on delete cascade,
  asset_id            uuid not null references assets(asset_id) on delete cascade,
  period_label        text not null,
  period_end          date not null,
  status              text not null default 'draft' check (status in ('draft','closed')),
  gross_rental_income numeric(18,2),
  noi                 numeric(18,2),
  operating_expenses  numeric(18,2),
  occupancy_pct       numeric(5,2),
  capex               numeric(18,2),
  valuation           numeric(18,2),
  yield_pct           numeric(7,4),
  debt                numeric(18,2),
  ltv_pct             numeric(7,4),
  cash_on_cash_pct    numeric(7,4),
  created_at          timestamptz not null default now(),
  unique (asset_id, period_label)
);
create index if not exists idx_periods_asset on performance_periods(asset_id, period_end desc);

create table if not exists asset_risks (
  risk_id          uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(org_id) on delete cascade,
  asset_id         uuid not null references assets(asset_id) on delete cascade,
  title            text not null,
  category         text not null default 'other',
  description      text,
  probability      int,
  financial_impact numeric(18,2),
  severity         text,
  mitigation       text,
  owner            text,
  deadline         date,
  status           text not null default 'open',
  created_at       timestamptz not null default now()
);
create index if not exists idx_arisks_asset on asset_risks(asset_id);

create table if not exists asset_decisions (
  decision_id      uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(org_id) on delete cascade,
  asset_id         uuid not null references assets(asset_id) on delete cascade,
  title            text not null,
  issue            text,
  recommendation   text,
  financial_impact numeric(18,2),
  decision_maker   text,
  deadline         date,
  status           text not null default 'open',
  created_at       timestamptz not null default now()
);
create index if not exists idx_adec_asset on asset_decisions(asset_id);

create table if not exists valuations (
  valuation_id   uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(org_id) on delete cascade,
  asset_id       uuid not null references assets(asset_id) on delete cascade,
  valuation_date date not null,
  valuer         text,
  valuation      numeric(18,2),
  valuation_type text not null default 'external',
  noi            numeric(18,2),
  yield_pct      numeric(7,4),
  erv            numeric(18,2),
  created_at     timestamptz not null default now()
);
create index if not exists idx_valuations_asset on valuations(asset_id, valuation_date);

create or replace function app.touch_asset_updated() returns trigger
  language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_assets_touch on assets;
create trigger trg_assets_touch before update on assets
  for each row execute function app.touch_asset_updated();

-- ---- RLS -------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['assets','business_plans','performance_periods','asset_risks','asset_decisions','valuations'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select to authenticated using (app.has_org(org_id))', t, t);
    execute format('drop policy if exists %I_insert on %I', t, t);
    execute format('create policy %I_insert on %I for insert to authenticated with check (app.has_org(org_id) and app.can_write())', t, t);
    execute format('drop policy if exists %I_update on %I', t, t);
    execute format('create policy %I_update on %I for update to authenticated using (app.has_org(org_id) and app.can_write()) with check (app.has_org(org_id) and app.can_write())', t, t);
    execute format('drop policy if exists %I_delete on %I', t, t);
    execute format('create policy %I_delete on %I for delete to authenticated using (app.has_org(org_id) and app.can_write())', t, t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;
