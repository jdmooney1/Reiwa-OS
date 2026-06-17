-- ============================================================================
-- Reiwa OS — Proposed Postgres schema (Supabase)
-- ----------------------------------------------------------------------------
-- PROPOSAL ONLY. Review before applying. This file is the concrete companion to
-- docs/02-data-model.md. It assumes Clerk is configured as a third-party JWT
-- auth provider, so auth.jwt() ->> 'sub' resolves to the Clerk user id.
--
-- Conventions:
--   * Money: numeric(18,2). Percentages: numeric(7,4). No floats for money.
--   * Timestamps: timestamptz, default now().
--   * Soft delete on deals via archived_at.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
create type user_role     as enum ('founder', 'analyst', 'adviser');
create type market         as enum ('london', 'amsterdam');
create type currency       as enum ('GBP', 'EUR');
create type asset_class    as enum ('office', 'residential', 'retail', 'industrial',
                                    'logistics', 'mixed_use', 'hotel', 'student_housing',
                                    'healthcare', 'land', 'other');
create type tenure         as enum ('freehold', 'leasehold', 'other');
create type deal_stage     as enum ('sourced', 'screening', 'underwriting',
                                    'due_diligence', 'ic_review', 'approved',
                                    'closed', 'rejected');
create type deal_status    as enum ('active', 'on_hold', 'dead', 'completed');
create type dd_category    as enum ('legal', 'financial', 'technical', 'commercial',
                                    'tax', 'esg');
create type dd_status      as enum ('not_started', 'in_progress', 'complete',
                                    'flagged', 'na');
create type risk_category  as enum ('market', 'tenant', 'structural', 'legal',
                                    'financial', 'regulatory', 'esg', 'fx');
create type risk_status    as enum ('open', 'mitigated', 'accepted', 'closed');
create type risk_band      as enum ('low', 'medium', 'high', 'critical');
create type doc_category   as enum ('legal', 'financial', 'technical', 'marketing',
                                    'valuation', 'correspondence', 'other');
create type contact_type   as enum ('broker', 'vendor', 'lawyer', 'lender', 'valuer',
                                    'investor', 'adviser', 'other');
create type recommendation as enum ('pursue', 'hold', 'pass');
create type memo_status     as enum ('draft', 'final');

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------
-- Clerk user id from the verified JWT.
create or replace function current_profile_id() returns text
  language sql stable as $$ select auth.jwt() ->> 'sub' $$;

-- True if the current user is an internal Reiwa team member.
create or replace function is_internal() returns boolean
  language sql stable as $$
    select exists (
      select 1 from profiles p
      where p.id = current_profile_id()
        and p.role in ('founder', 'analyst')
    )
  $$;

-- updated_at trigger
create or replace function set_updated_at() returns trigger
  language plpgsql as $$
  begin new.updated_at = now(); return new; end $$;

-- ----------------------------------------------------------------------------
-- profiles  (mirror of Clerk users)
-- ----------------------------------------------------------------------------
create table profiles (
  id          text primary key,              -- Clerk user id (sub)
  email       text not null,
  full_name   text,
  role        user_role not null default 'analyst',
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- deals  (root aggregate — Deal Pipeline + Deal Detail)
-- ----------------------------------------------------------------------------
create table deals (
  id            uuid primary key default gen_random_uuid(),
  reference     text unique not null,          -- e.g. RC-LON-0042
  name          text not null,
  market        market not null,
  asset_class   asset_class not null default 'other',
  stage         deal_stage not null default 'sourced',
  status        deal_status not null default 'active',
  currency      currency not null default 'GBP',
  target_price  numeric(18,2),
  owner_id      text references profiles(id),
  source        text,
  sourced_at    date default current_date,
  summary       text,
  archived_at   timestamptz,
  created_by    text references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_deals_stage   on deals(stage) where archived_at is null;
create index idx_deals_market  on deals(market) where archived_at is null;
create index idx_deals_owner    on deals(owner_id);
create trigger trg_deals_updated before update on deals
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- assets  (Asset Snapshot, 1:1)
-- ----------------------------------------------------------------------------
create table assets (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid not null unique references deals(id) on delete cascade,
  address_line    text,
  city            text,
  postcode        text,
  country         text,
  latitude        numeric(9,6),
  longitude       numeric(9,6),
  tenure          tenure,
  total_area_sqm  numeric(12,2),
  nia_sqm         numeric(12,2),               -- net internal area
  gia_sqm         numeric(12,2),               -- gross internal area
  year_built      int,
  units_count     int,
  occupancy_pct   numeric(5,2),
  walt_years      numeric(6,2),                -- weighted avg lease term
  epc_rating      text,
  condition_notes text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_assets_updated before update on assets
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- deal_financials  (Financial Metrics, 1:1) — inputs + persisted derived values
-- ----------------------------------------------------------------------------
create table deal_financials (
  id                    uuid primary key default gen_random_uuid(),
  deal_id               uuid not null unique references deals(id) on delete cascade,
  -- inputs
  purchase_price        numeric(18,2),
  acquisition_costs     numeric(18,2),
  gross_dev_value       numeric(18,2),
  net_operating_income  numeric(18,2),
  gross_rental_income   numeric(18,2),
  equity_invested       numeric(18,2),
  debt_amount           numeric(18,2),
  interest_rate_pct     numeric(7,4),
  hold_period_years     numeric(5,2),
  exit_yield_pct        numeric(7,4),
  -- derived (computed in src/lib/finance, persisted on save)
  net_initial_yield_pct numeric(7,4),
  gross_yield_pct       numeric(7,4),
  ltv_pct               numeric(7,4),
  dscr                  numeric(7,4),
  levered_irr_pct       numeric(7,4),
  unlevered_irr_pct     numeric(7,4),
  equity_multiple       numeric(7,4),
  cash_on_cash_pct      numeric(7,4),
  price_per_sqm         numeric(18,2),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_financials_updated before update on deal_financials
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- dd_items  (Due Diligence Tracker, 1:many)
-- ----------------------------------------------------------------------------
create table dd_items (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references deals(id) on delete cascade,
  category     dd_category not null,
  title        text not null,
  description  text,
  status       dd_status not null default 'not_started',
  assignee_id  text references profiles(id),
  due_date     date,
  completed_at timestamptz,
  notes        text,
  sort_order   int default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_dd_deal on dd_items(deal_id);
create trigger trg_dd_updated before update on dd_items
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- risks  (Risk Register, 1:many)
-- ----------------------------------------------------------------------------
create table risks (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references deals(id) on delete cascade,
  category    risk_category not null,
  title       text not null,
  description text,
  likelihood  int check (likelihood between 1 and 5),
  impact      int check (impact between 1 and 5),
  severity    risk_band,                        -- derived band, stored
  mitigation  text,
  owner_id    text references profiles(id),
  status      risk_status not null default 'open',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_risks_deal on risks(deal_id);
create trigger trg_risks_updated before update on risks
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- investment_scores  (Investment Score, 1:1)
-- ----------------------------------------------------------------------------
create table investment_scores (
  id                  uuid primary key default gen_random_uuid(),
  deal_id             uuid not null unique references deals(id) on delete cascade,
  location_score      int check (location_score between 0 and 100),
  asset_quality_score int check (asset_quality_score between 0 and 100),
  cashflow_score      int check (cashflow_score between 0 and 100),
  risk_score          int check (risk_score between 0 and 100),
  return_score        int check (return_score between 0 and 100),
  esg_score           int check (esg_score between 0 and 100),
  weights             jsonb not null default '{}'::jsonb,  -- weighting model used
  total_score         int check (total_score between 0 and 100),
  recommendation      recommendation,
  rationale           text,
  scored_by           text references profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_scores_updated before update on investment_scores
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- documents  (Document Vault, 1:many) — metadata; bytes live in Supabase Storage
-- ----------------------------------------------------------------------------
create table documents (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid not null references deals(id) on delete cascade,
  category     doc_category not null default 'other',
  file_name    text not null,
  storage_path text not null,                   -- path within the private bucket
  bucket       text not null default 'deal-documents',
  mime_type    text,
  size_bytes   bigint,
  version      int not null default 1,
  uploaded_by  text references profiles(id),
  uploaded_at  timestamptz not null default now()
);
create index idx_documents_deal on documents(deal_id);

-- ----------------------------------------------------------------------------
-- contacts  (shared directory) + deal_contacts (many:many)
-- ----------------------------------------------------------------------------
create table contacts (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  company     text,
  role_title  text,
  type        contact_type not null default 'other',
  email       text,
  phone       text,
  notes       text,
  created_by  text references profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_contacts_updated before update on contacts
  for each row execute function set_updated_at();

create table deal_contacts (
  deal_id      uuid not null references deals(id) on delete cascade,
  contact_id   uuid not null references contacts(id) on delete cascade,
  relationship text,
  primary key (deal_id, contact_id)
);

-- ----------------------------------------------------------------------------
-- deal_activity  (Audit log, 1:many)
-- ----------------------------------------------------------------------------
create table deal_activity (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references deals(id) on delete cascade,
  actor_id   text references profiles(id),
  action     text not null,                     -- created, stage_changed, score_updated, ...
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_activity_deal on deal_activity(deal_id, created_at desc);

-- ----------------------------------------------------------------------------
-- memos  (Investment Memo, later phase)
-- ----------------------------------------------------------------------------
create table memos (
  id                 uuid primary key default gen_random_uuid(),
  deal_id            uuid not null references deals(id) on delete cascade,
  title              text not null,
  content            jsonb not null default '{}'::jsonb,
  version            int not null default 1,
  status             memo_status not null default 'draft',
  generated_pdf_path text,
  created_by         text references profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_memos_updated before update on memos
  for each row execute function set_updated_at();

-- ============================================================================
-- Row Level Security (MVP: internal team has full access)
-- ----------------------------------------------------------------------------
-- The external `adviser` phase will introduce a deal_access table and tighten
-- these policies to per-deal grants. For MVP, founder + analyst share all deals.
-- ============================================================================
alter table profiles          enable row level security;
alter table deals             enable row level security;
alter table assets            enable row level security;
alter table deal_financials   enable row level security;
alter table dd_items          enable row level security;
alter table risks             enable row level security;
alter table investment_scores enable row level security;
alter table documents         enable row level security;
alter table contacts          enable row level security;
alter table deal_contacts     enable row level security;
alter table deal_activity     enable row level security;
alter table memos             enable row level security;

-- profiles: a user can read all internal profiles, and update only their own.
create policy profiles_select on profiles for select using (is_internal());
create policy profiles_update_self on profiles for update
  using (id = current_profile_id());

-- Internal full access on every deal-scoped table.
create policy deals_all             on deals             for all using (is_internal()) with check (is_internal());
create policy assets_all            on assets            for all using (is_internal()) with check (is_internal());
create policy financials_all        on deal_financials   for all using (is_internal()) with check (is_internal());
create policy dd_items_all          on dd_items          for all using (is_internal()) with check (is_internal());
create policy risks_all             on risks             for all using (is_internal()) with check (is_internal());
create policy scores_all            on investment_scores for all using (is_internal()) with check (is_internal());
create policy documents_all         on documents         for all using (is_internal()) with check (is_internal());
create policy contacts_all          on contacts          for all using (is_internal()) with check (is_internal());
create policy deal_contacts_all     on deal_contacts     for all using (is_internal()) with check (is_internal());
create policy deal_activity_all     on deal_activity     for all using (is_internal()) with check (is_internal());
create policy memos_all             on memos             for all using (is_internal()) with check (is_internal());

-- NOTE: The `approved` stage transition (IC sign-off) is restricted to `founder`
-- in the server action layer. A DB-level backstop can be added with a BEFORE
-- UPDATE trigger checking the actor's role if stricter governance is required.
