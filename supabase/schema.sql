-- ============================================================================
-- Reiwa OS — Database Schema
-- European real estate deal tracking, underwriting & due diligence
-- ----------------------------------------------------------------------------
-- Target: Supabase Postgres. Clerk is configured as a third-party JWT auth
-- provider, so auth.jwt() ->> 'sub' resolves to the Clerk user id and
-- auth.role() = 'authenticated' for signed-in users.
--
-- Conventions:
--   * Money:        numeric(18,2)        (never floats)
--   * Percentages:  numeric(7,4)         (e.g. 4.2500 == 4.25%)
--   * Areas:        numeric(14,2)
--   * Timestamps:   timestamptz default now()
--   * Primary keys: uuid default gen_random_uuid()
--
-- This file defines tables 1–8 from the Reiwa OS spec, with enums, indexes,
-- triggers, and Row Level Security. Apply with `supabase db reset` or psql.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------
create type currency        as enum ('GBP', 'EUR', 'USD');

create type market           as enum ('London', 'Amsterdam', 'Paris', 'Berlin',
                                      'Frankfurt', 'Madrid', 'Milan', 'Dublin',
                                      'Other');

create type asset_type       as enum ('office', 'retail', 'industrial', 'logistics',
                                      'residential', 'multifamily', 'hotel',
                                      'student_housing', 'healthcare', 'data_centre',
                                      'mixed_use', 'land', 'other');

create type strategy         as enum ('core', 'core_plus', 'value_add',
                                      'opportunistic', 'development');

create type deal_stage       as enum ('sourcing', 'screening', 'underwriting',
                                      'due_diligence', 'investment_committee',
                                      'under_offer', 'exclusivity', 'legals',
                                      'completed', 'aborted');

create type deal_status      as enum ('active', 'on_hold', 'completed',
                                      'withdrawn', 'dead');

-- DD framework sections (London & Amsterdam), in memo order.
create type dd_section      as enum (
  'Executive Summary', 'Submarket Overview', 'Location and Micro Situation',
  'Asset Description', 'Tenure and Ownership', 'Income Profile and Tenancy',
  'Tenant Covenant Review', 'Planning and Heritage', 'ESG and Compliance',
  'Market Commentary', 'Valuation Metrics', 'Insurance and Reinstatement Cost',
  'Capex Plan', 'Business Plan Scenarios', 'Exit Strategy',
  'Vendor and Deal Dynamics', 'SWOT', 'Japan Rationale',
  'Cross Border Tax and Holding Structure', 'Currency Risk and Hedging',
  'Further DD Required');

create type dd_jurisdiction  as enum ('UK', 'Netherlands', 'Japan', 'Cross-border');

create type priority_level   as enum ('low', 'medium', 'high', 'critical');

create type dd_status        as enum ('not_started', 'requested', 'in_progress',
                                      'received', 'reviewed', 'issue_identified',
                                      'resolved', 'not_applicable');

create type risk_level       as enum ('low', 'medium', 'high');

create type risk_category    as enum ('market', 'tenant', 'structural', 'legal',
                                      'financial', 'regulatory', 'planning', 'esg',
                                      'tax', 'fx', 'execution', 'other');

create type risk_status      as enum ('open', 'mitigated', 'accepted', 'closed');

create type doc_category      as enum ('Legal', 'Financial', 'Technical', 'Valuation',
                                      'Marketing', 'Tax', 'Planning', 'ESG',
                                      'Insurance', 'Correspondence', 'Other');

create type recommendation   as enum ('strong_proceed', 'proceed',
                                      'proceed_with_caution', 'weak', 'reject');

create type decision_type    as enum ('screening', 'investment_committee', 'bid',
                                      'exclusivity', 'legal', 'completion',
                                      'abort', 'other');

-- ----------------------------------------------------------------------------
-- updated_at trigger helper
-- ----------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
  language plpgsql as $$
  begin new.updated_at = now(); return new; end $$;

-- ============================================================================
-- 1. deals  (root aggregate)
-- ============================================================================
create table deals (
  deal_id            uuid primary key default gen_random_uuid(),
  asset_name         text not null,
  address            text,
  city               text,
  country            text,
  market             market,
  submarket          text,
  asset_type         asset_type not null default 'other',
  strategy           strategy,
  deal_stage         deal_stage not null default 'sourcing',
  source             text,
  broker_name        text,
  vendor_name        text,
  price_guidance     numeric(18,2),
  currency           currency not null default 'GBP',
  size_sqft          numeric(14,2),
  size_sqm           numeric(14,2),
  passing_rent       numeric(18,2),         -- per annum
  erv                numeric(18,2),         -- estimated rental value, per annum
  niy                numeric(7,4),          -- net initial yield %
  reversionary_yield numeric(7,4),          -- %
  capex_budget       numeric(18,2),
  target_irr         numeric(7,4),          -- %
  equity_multiple    numeric(7,4),          -- x
  status             deal_status not null default 'active',
  probability        int check (probability between 0 and 100),  -- % to completion
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_deals_stage   on deals(deal_stage);
create index idx_deals_market  on deals(market);
create index idx_deals_status  on deals(status);
create trigger trg_deals_updated before update on deals
  for each row execute function set_updated_at();

-- ============================================================================
-- 2. deal_metrics  (1:1 underwriting metrics)
-- ============================================================================
create table deal_metrics (
  metric_id                 uuid primary key default gen_random_uuid(),
  deal_id                   uuid not null unique references deals(deal_id) on delete cascade,
  purchase_price            numeric(18,2),
  acquisition_costs         numeric(18,2),
  stamp_duty_or_transfer_tax numeric(18,2),
  total_cost                numeric(18,2),
  debt_amount               numeric(18,2),
  ltv                       numeric(7,4),   -- %
  interest_rate             numeric(7,4),   -- %
  rent                      numeric(18,2),  -- per annum
  erv                       numeric(18,2),  -- per annum
  noi                       numeric(18,2),  -- net operating income, per annum
  capex                     numeric(18,2),
  exit_yield                numeric(7,4),   -- %
  exit_value                numeric(18,2),
  irr                       numeric(7,4),   -- %
  equity_multiple           numeric(7,4),   -- x
  cash_on_cash              numeric(7,4),   -- %
  yield_on_cost             numeric(7,4),   -- %
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create trigger trg_metrics_updated before update on deal_metrics
  for each row execute function set_updated_at();

-- ============================================================================
-- 3. due_diligence_items
-- ============================================================================
create table due_diligence_items (
  item_id          uuid primary key default gen_random_uuid(),
  deal_id          uuid not null references deals(deal_id) on delete cascade,
  section          dd_section not null,
  item             text not null,          -- item title
  question         text,                    -- the diligence question
  jurisdiction     dd_jurisdiction not null default 'UK',
  priority         priority_level not null default 'medium',
  status           dd_status not null default 'not_started',
  owner            text,
  due_date         date,
  risk_level       risk_level,
  notes            text,
  linked_documents text[] not null default '{}',  -- document ids / file names
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_dd_deal    on due_diligence_items(deal_id);
create index idx_dd_section on due_diligence_items(deal_id, section);
create trigger trg_dd_updated before update on due_diligence_items
  for each row execute function set_updated_at();

-- ============================================================================
-- 4. risks  (Risk Register)
-- ============================================================================
create table risks (
  risk_id       uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references deals(deal_id) on delete cascade,
  risk_title    text not null,
  risk_category risk_category not null default 'other',
  probability   int check (probability between 1 and 5),  -- 1 (rare) .. 5 (almost certain)
  impact        int check (impact between 1 and 5),       -- 1 (minor) .. 5 (severe)
  risk_score    int,                                       -- probability * impact (1..25)
  mitigation    text,
  owner         text,
  status        risk_status not null default 'open',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_risks_deal on risks(deal_id);
create trigger trg_risks_updated before update on risks
  for each row execute function set_updated_at();

-- ============================================================================
-- 5. contacts
-- ============================================================================
create table contacts (
  contact_id uuid primary key default gen_random_uuid(),
  deal_id    uuid references deals(deal_id) on delete cascade,
  name       text not null,
  company    text,
  role       text,
  email      text,
  phone      text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_contacts_deal on contacts(deal_id);
create trigger trg_contacts_updated before update on contacts
  for each row execute function set_updated_at();

-- ============================================================================
-- 6. documents  (metadata; bytes live in Supabase Storage)
-- ============================================================================
create table documents (
  document_id uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references deals(deal_id) on delete cascade,
  file_name   text not null,
  file_type   text,
  category    doc_category not null default 'Other',
  storage_url text,                          -- path within the private bucket
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  summary     text
);
create index idx_documents_deal on documents(deal_id);

-- ============================================================================
-- 7. investment_scores  (1:1 header) + investment_score_categories (1:many)
-- ----------------------------------------------------------------------------
-- The Reiwa score is 11 weighted criteria (1–10 each); category weights live in
-- the application model (src/lib/scoring/model.ts) and sum to 100. The header
-- stores the computed overall (0–100), recommendation and IC summary; each
-- category line stores its 1–10 score, commentary and a risk flag.
-- ============================================================================
create table investment_scores (
  score_id       uuid primary key default gen_random_uuid(),
  deal_id        uuid not null unique references deals(deal_id) on delete cascade,
  overall_score  numeric(5,2) check (overall_score between 0 and 100),
  recommendation recommendation,
  summary        text,
  scored_by      text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_scores_updated before update on investment_scores
  for each row execute function set_updated_at();

create table investment_score_categories (
  id          uuid primary key default gen_random_uuid(),
  score_id    uuid not null references investment_scores(score_id) on delete cascade,
  deal_id     uuid not null references deals(deal_id) on delete cascade,
  category    text not null,           -- ScoreCategoryKey (e.g. location_quality)
  score       numeric(3,1) check (score between 1 and 10),
  commentary  text,
  risk_flag   boolean not null default false,
  unique (score_id, category)
);
create index idx_score_cat_deal on investment_score_categories(deal_id);

-- ============================================================================
-- 8. decision_log
-- ============================================================================
create table decision_log (
  decision_id   uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references deals(deal_id) on delete cascade,
  decision_date date not null default current_date,
  decision_type decision_type not null default 'other',
  decision      text not null,
  rationale     text,
  next_steps    text,
  author        text,
  created_at    timestamptz not null default now()
);
create index idx_decisions_deal on decision_log(deal_id, decision_date desc);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- MVP posture: Reiwa Capital is one small, fully-trusted internal team
-- (founder + analyst). Every authenticated user may read and write all deal
-- data. The service role (server-side) bypasses RLS for webhooks/admin tasks.
--
-- Tightening path (external advisers): introduce a deal_access(deal_id,
-- profile_id, level) table and replace the `using (true)` predicates below
-- with an EXISTS check against it. See docs/04-rls-and-types.md.
-- ============================================================================
alter table deals               enable row level security;
alter table deal_metrics        enable row level security;
alter table due_diligence_items enable row level security;
alter table risks               enable row level security;
alter table contacts            enable row level security;
alter table documents           enable row level security;
alter table investment_scores   enable row level security;
alter table investment_score_categories enable row level security;
alter table decision_log        enable row level security;

-- Full access for any authenticated (Clerk) user.
create policy deals_rw     on deals               for all to authenticated using (true) with check (true);
create policy metrics_rw   on deal_metrics        for all to authenticated using (true) with check (true);
create policy dd_rw        on due_diligence_items for all to authenticated using (true) with check (true);
create policy risks_rw     on risks               for all to authenticated using (true) with check (true);
create policy contacts_rw  on contacts            for all to authenticated using (true) with check (true);
create policy documents_rw on documents           for all to authenticated using (true) with check (true);
create policy scores_rw    on investment_scores   for all to authenticated using (true) with check (true);
create policy score_cat_rw on investment_score_categories for all to authenticated using (true) with check (true);
create policy decisions_rw on decision_log        for all to authenticated using (true) with check (true);
