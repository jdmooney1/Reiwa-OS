-- ============================================================================
-- Reiwa OS — Asset Intelligence schema (ADDITIVE)
-- ----------------------------------------------------------------------------
-- Post-acquisition operating layer. Introduces the multi-tenant org/portfolio
-- model and the persistent `asset` entity that carries one asset_id across the
-- lifecycle (Opportunity → Underwriting → Transaction → Asset Intelligence →
-- Exit). Nothing in schema.sql is rewritten; two nullable FKs are added by ALTER
-- so the acquisition underwriting (deals) and documents bind to the asset.
--
-- History is preserved by design:
--   * business_plans are VERSIONED and immutable (underwriting / approved /
--     current_forecast) — a new forecast inserts a new version, never an UPDATE.
--   * performance_periods are append-only and immutable once `closed`.
-- We must be able to reconstruct what management believed at any prior date.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
create type org_type          as enum ('corporate', 'family_office', 'fund', 'jv', 'other');
create type org_role          as enum ('owner', 'manager', 'analyst', 'viewer');
create type lifecycle_stage   as enum ('underwriting', 'transaction', 'operating',
                                       'development', 'stabilising', 'exit', 'realised');
create type plan_type         as enum ('underwriting', 'approved', 'current_forecast');
create type period_status     as enum ('draft', 'closed');
create type lease_status      as enum ('occupied', 'vacant', 'under_offer', 'holdover', 'in_fit_out');
create type capex_kind        as enum ('operating', 'development');
create type capex_status      as enum ('planned', 'approved', 'committed', 'in_progress', 'complete', 'on_hold');
create type dev_status        as enum ('feasibility', 'design', 'consents', 'procurement',
                                       'construction', 'handover', 'complete');
create type milestone_status  as enum ('not_started', 'in_progress', 'complete', 'delayed', 'at_risk');
create type valuation_type    as enum ('acquisition', 'external', 'internal', 'desktop', 'stabilised');
create type refi_status       as enum ('in_place', 'monitoring', 'refinancing', 'maturity_approaching', 'breach_risk');
create type asset_risk_cat    as enum ('leasing', 'development', 'financing', 'valuation', 'legal',
                                       'tax', 'regulatory', 'technical', 'environmental', 'counterparty', 'fx');
create type severity_band     as enum ('low', 'medium', 'high', 'critical');
create type decision_status   as enum ('open', 'required', 'decided', 'deferred', 'rejected');
create type action_priority   as enum ('low', 'medium', 'high', 'urgent');
create type action_status     as enum ('open', 'in_progress', 'blocked', 'complete');
create type event_type        as enum ('rent_review', 'lease_break', 'lease_expiry', 'refinancing',
                                       'loan_maturity', 'construction_milestone', 'planning_deadline',
                                       'valuation', 'tax_deadline', 'hedge_expiry');

-- ----------------------------------------------------------------------------
-- Multi-tenant root
-- ----------------------------------------------------------------------------
create table organizations (
  org_id     uuid primary key default gen_random_uuid(),
  name       text not null,
  type       org_type not null default 'corporate',
  created_at timestamptz not null default now()
);

create table organization_members (
  org_id     uuid not null references organizations(org_id) on delete cascade,
  profile_id text not null,                 -- Clerk user id
  role       org_role not null default 'viewer',
  primary key (org_id, profile_id)
);

create table portfolios (
  portfolio_id uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(org_id) on delete cascade,
  name         text not null,
  country      text,
  currency     currency not null default 'GBP',
  created_at   timestamptz not null default now()
);
create index idx_portfolios_org on portfolios(org_id);

-- ----------------------------------------------------------------------------
-- Persistent asset (one asset_id for the whole lifecycle)
-- ----------------------------------------------------------------------------
create table assets (
  asset_id          uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(org_id) on delete cascade,
  portfolio_id      uuid references portfolios(portfolio_id) on delete set null,
  source_deal_id    uuid references deals(deal_id),   -- the acquisition underwriting case
  name              text not null,
  address           text,
  city              text,
  country           text,
  market            market,
  asset_type        asset_type not null default 'other',
  strategy          strategy,
  lifecycle_stage   lifecycle_stage not null default 'operating',
  currency          currency not null default 'GBP',
  acquisition_date  date,
  acquisition_price numeric(18,2),
  equity_invested   numeric(18,2),
  hold_thesis       text,
  is_demo           boolean not null default false,   -- clearly-flagged demonstration data
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index idx_assets_org on assets(org_id);
create index idx_assets_portfolio on assets(portfolio_id);

-- Bind the acquisition underwriting case and documents to the persistent asset.
alter table deals     add column if not exists asset_id uuid references assets(asset_id);
alter table documents add column if not exists asset_id uuid references assets(asset_id);

-- ----------------------------------------------------------------------------
-- Business plans (versioned, immutable) — the three-way comparison lives here
-- ----------------------------------------------------------------------------
create table business_plans (
  plan_id              uuid primary key default gen_random_uuid(),
  asset_id             uuid not null references assets(asset_id) on delete cascade,
  org_id               uuid not null references organizations(org_id) on delete cascade,
  plan_type            plan_type not null,
  version              int not null default 1,
  as_of_date           date not null,
  label                text,
  -- shared metric set (enables variance vs actuals in one read)
  gross_rental_income  numeric(18,2),
  noi                  numeric(18,2),
  operating_expenses   numeric(18,2),
  occupancy_pct        numeric(5,2),
  capex                numeric(18,2),
  valuation            numeric(18,2),
  yield_pct            numeric(7,4),
  debt                 numeric(18,2),
  ltv_pct              numeric(7,4),
  cash_on_cash_pct     numeric(7,4),
  equity_multiple      numeric(7,4),
  irr_pct              numeric(7,4),
  created_by           text,
  created_at           timestamptz not null default now(),
  unique (asset_id, plan_type, version)
);
create index idx_plans_asset on business_plans(asset_id);
-- No updated_at / no UPDATE path: superseding a plan inserts a new version.

-- ----------------------------------------------------------------------------
-- Performance periods (actuals, append-only, immutable once closed)
-- ----------------------------------------------------------------------------
create table performance_periods (
  period_id            uuid primary key default gen_random_uuid(),
  asset_id             uuid not null references assets(asset_id) on delete cascade,
  org_id               uuid not null references organizations(org_id) on delete cascade,
  period_label         text not null,          -- e.g. 'Q2 2026'
  period_end           date not null,
  status               period_status not null default 'draft',
  -- actuals
  gross_rental_income  numeric(18,2),
  noi                  numeric(18,2),
  operating_expenses   numeric(18,2),
  occupancy_pct        numeric(5,2),
  capex                numeric(18,2),
  valuation            numeric(18,2),
  yield_pct            numeric(7,4),
  debt                 numeric(18,2),
  ltv_pct              numeric(7,4),
  cash_on_cash_pct     numeric(7,4),
  created_at           timestamptz not null default now(),
  unique (asset_id, period_label)
);
create index idx_periods_asset on performance_periods(asset_id, period_end desc);

-- ----------------------------------------------------------------------------
-- Leasing
-- ----------------------------------------------------------------------------
create table tenants (
  tenant_id      uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(org_id) on delete cascade,
  name           text not null,
  covenant_notes text
);

create table leases (
  lease_id             uuid primary key default gen_random_uuid(),
  asset_id             uuid not null references assets(asset_id) on delete cascade,
  org_id               uuid not null references organizations(org_id) on delete cascade,
  tenant_id            uuid references tenants(tenant_id),
  unit                 text,
  use                  text,
  lease_start          date,
  lease_expiry         date,
  break_date           date,
  rent_review_date     date,
  passing_rent         numeric(18,2),
  area_sqft            numeric(14,2),
  erv                  numeric(18,2),
  incentives           text,
  deposit_guarantee    text,
  status               lease_status not null default 'occupied',
  renewal_probability  numeric(5,2),
  notes                text
);
create index idx_leases_asset on leases(asset_id);

-- ----------------------------------------------------------------------------
-- CapEx & development
-- ----------------------------------------------------------------------------
create table capex_items (
  capex_id          uuid primary key default gen_random_uuid(),
  asset_id          uuid not null references assets(asset_id) on delete cascade,
  org_id            uuid not null references organizations(org_id) on delete cascade,
  kind              capex_kind not null default 'operating',
  category          text not null,
  original_budget   numeric(18,2),
  approved_budget   numeric(18,2),
  committed         numeric(18,2),
  spent             numeric(18,2),
  forecast          numeric(18,2),
  cost_to_complete  numeric(18,2),
  contingency       numeric(18,2),
  status            capex_status not null default 'planned',
  responsible       text,
  target_completion date,
  comments          text
);
create index idx_capex_asset on capex_items(asset_id);

create table development_projects (
  project_id          uuid primary key default gen_random_uuid(),
  asset_id            uuid not null references assets(asset_id) on delete cascade,
  org_id              uuid not null references organizations(org_id) on delete cascade,
  name                text not null,
  status              dev_status not null default 'design',
  approved_budget     numeric(18,2),
  committed           numeric(18,2),
  spent               numeric(18,2),
  forecast            numeric(18,2),
  contingency         numeric(18,2),
  start_date          date,
  expected_completion date,
  original_completion date,
  programme_variance_days int,
  notes               text
);

create table milestones (
  milestone_id  uuid primary key default gen_random_uuid(),
  project_id    uuid not null references development_projects(project_id) on delete cascade,
  asset_id      uuid not null references assets(asset_id) on delete cascade,
  name          text not null,
  workstream    text,
  baseline_date date,
  forecast_date date,
  status        milestone_status not null default 'not_started',
  dependencies  text,
  critical      boolean not null default false
);
create index idx_milestones_project on milestones(project_id);

-- ----------------------------------------------------------------------------
-- Valuation history
-- ----------------------------------------------------------------------------
create table valuations (
  valuation_id   uuid primary key default gen_random_uuid(),
  asset_id       uuid not null references assets(asset_id) on delete cascade,
  org_id         uuid not null references organizations(org_id) on delete cascade,
  valuation_date date not null,
  valuer         text,
  valuation      numeric(18,2),
  valuation_type valuation_type not null default 'external',
  noi            numeric(18,2),
  yield_pct      numeric(7,4),
  erv            numeric(18,2),
  methodology    text,
  key_assumptions text
);
create index idx_valuations_asset on valuations(asset_id, valuation_date);

-- ----------------------------------------------------------------------------
-- Financing
-- ----------------------------------------------------------------------------
create table loans (
  loan_id         uuid primary key default gen_random_uuid(),
  asset_id        uuid not null references assets(asset_id) on delete cascade,
  org_id          uuid not null references organizations(org_id) on delete cascade,
  lender          text,
  original_loan   numeric(18,2),
  current_balance numeric(18,2),
  all_in_rate     numeric(7,4),
  margin          numeric(7,4),
  reference_rate  text,
  hedging         text,
  hedge_expiry    date,
  maturity        date,
  amortisation    text,
  covenant_ltv    numeric(7,4),
  covenant_icr    numeric(7,4),
  current_icr     numeric(7,4),
  debt_yield      numeric(7,4),
  refi_status     refi_status not null default 'in_place'
);
create index idx_loans_asset on loans(asset_id);

-- ----------------------------------------------------------------------------
-- Risks / decisions / actions / advisers / events
-- ----------------------------------------------------------------------------
create table asset_risks (
  risk_id          uuid primary key default gen_random_uuid(),
  asset_id         uuid not null references assets(asset_id) on delete cascade,
  org_id           uuid not null references organizations(org_id) on delete cascade,
  title            text not null,
  category         asset_risk_cat not null,
  description      text,
  probability      int check (probability between 1 and 5),
  financial_impact numeric(18,2),
  severity         severity_band,
  mitigation       text,
  owner            text,
  deadline         date,
  status           risk_status not null default 'open',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_asset_risks_asset on asset_risks(asset_id);

create table asset_decisions (
  decision_id      uuid primary key default gen_random_uuid(),
  asset_id         uuid not null references assets(asset_id) on delete cascade,
  org_id           uuid not null references organizations(org_id) on delete cascade,
  title            text not null,
  issue            text,
  background       text,
  options          text,
  financial_impact numeric(18,2),
  recommendation   text,
  decision_maker   text,
  deadline         date,
  status           decision_status not null default 'open',
  final_decision   text,
  decision_date    date,
  rationale        text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_asset_decisions_asset on asset_decisions(asset_id);

create table advisers (
  adviser_id     uuid primary key default gen_random_uuid(),
  asset_id       uuid not null references assets(asset_id) on delete cascade,
  org_id         uuid not null references organizations(org_id) on delete cascade,
  name           text not null,
  company        text,
  role           text,
  workstream     text,
  contact        text,
  responsibility text
);
create index idx_advisers_asset on advisers(asset_id);

create table asset_actions (
  action_id       uuid primary key default gen_random_uuid(),
  asset_id        uuid not null references assets(asset_id) on delete cascade,
  org_id          uuid not null references organizations(org_id) on delete cascade,
  title           text not null,
  owner           text,
  adviser_id      uuid references advisers(adviser_id),
  due_date        date,
  priority        action_priority not null default 'medium',
  status          action_status not null default 'open',
  linked_risk_id     uuid references asset_risks(risk_id),
  linked_decision_id uuid references asset_decisions(decision_id)
);
create index idx_actions_asset on asset_actions(asset_id);

create table asset_events (
  event_id   uuid primary key default gen_random_uuid(),
  asset_id   uuid not null references assets(asset_id) on delete cascade,
  org_id     uuid not null references organizations(org_id) on delete cascade,
  type       event_type not null,
  title      text not null,
  event_date date not null,
  detail     text
);
create index idx_events_asset on asset_events(asset_id, event_date);

create table reporting_periods (
  report_id    uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references assets(asset_id) on delete cascade,
  org_id       uuid not null references organizations(org_id) on delete cascade,
  report_type  text not null,               -- monthly / quarterly / annual / ic_update
  period_end   date not null,
  status       text not null default 'draft',
  narrative    jsonb not null default '{}'::jsonb,   -- generated commentary (provenance-tagged)
  created_at   timestamptz not null default now()
);

-- ============================================================================
-- Row Level Security — ORG-SCOPED (multi-tenant from day one)
-- ----------------------------------------------------------------------------
-- A user sees only rows in organizations they belong to. Every asset-scoped
-- table denormalizes org_id for a single-predicate policy. The service role
-- bypasses RLS for admin / ingestion.
-- ============================================================================
create or replace function user_orgs() returns setof uuid
  language sql stable as $$
    select org_id from organization_members where profile_id = auth.jwt() ->> 'sub'
  $$;

alter table organizations        enable row level security;
alter table organization_members enable row level security;
alter table portfolios           enable row level security;
alter table assets               enable row level security;
alter table business_plans       enable row level security;
alter table performance_periods  enable row level security;
alter table tenants              enable row level security;
alter table leases               enable row level security;
alter table capex_items          enable row level security;
alter table development_projects enable row level security;
alter table milestones           enable row level security;
alter table valuations           enable row level security;
alter table loans                enable row level security;
alter table asset_risks          enable row level security;
alter table asset_decisions      enable row level security;
alter table advisers             enable row level security;
alter table asset_actions        enable row level security;
alter table asset_events         enable row level security;
alter table reporting_periods    enable row level security;

create policy orgs_member on organizations for all to authenticated
  using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
create policy org_members_self on organization_members for select to authenticated
  using (org_id in (select user_orgs()));

-- One org-scoped policy per asset-scoped table.
create policy portfolios_org on portfolios           for all to authenticated using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
create policy assets_org     on assets               for all to authenticated using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
create policy plans_org      on business_plans       for all to authenticated using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
create policy periods_org    on performance_periods  for all to authenticated using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
create policy tenants_org    on tenants              for all to authenticated using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
create policy leases_org     on leases               for all to authenticated using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
create policy capex_org      on capex_items          for all to authenticated using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
create policy dev_org        on development_projects  for all to authenticated using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
create policy milestones_org on milestones           for all to authenticated using (asset_id in (select asset_id from assets where org_id in (select user_orgs()))) with check (true);
create policy valuations_org on valuations           for all to authenticated using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
create policy loans_org      on loans                for all to authenticated using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
create policy arisks_org     on asset_risks          for all to authenticated using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
create policy adec_org       on asset_decisions      for all to authenticated using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
create policy advisers_org   on advisers             for all to authenticated using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
create policy actions_org    on asset_actions        for all to authenticated using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
create policy events_org     on asset_events         for all to authenticated using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
create policy reports_org    on reporting_periods    for all to authenticated using (org_id in (select user_orgs())) with check (org_id in (select user_orgs()));
