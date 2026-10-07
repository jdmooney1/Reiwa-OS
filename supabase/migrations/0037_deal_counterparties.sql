-- ============================================================================
-- 0037 — Deal counterparties
-- ----------------------------------------------------------------------------
-- The smallest table that makes `doc_type.scope = 'counterparty'` real.
-- Nothing in the schema today names a vendor or a lender as a row (opportunities
-- carries `vendor_name` as free text); `sanctions_screening` (vendor) and
-- `lender_reliance_letters`/`financing_docs` (lender) need something a
-- `deal_document` can actually point at.
--
-- Deliberately minimal — not a CRM, same posture as the source/origination
-- columns added in 0008. If a real counterparty directory is ever needed,
-- this is what it replaces.
-- ============================================================================

create table if not exists deal_counterparties (
  counterparty_id uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(org_id) on delete cascade,
  opportunity_id  uuid not null references opportunities(opportunity_id) on delete cascade,
  name            text not null,
  role            text not null default 'other' check (role in ('vendor', 'lender', 'other')),
  created_by      uuid references profiles(user_id),
  created_at      timestamptz not null default now()
);
create index if not exists idx_deal_counterparties_opportunity on deal_counterparties(opportunity_id);

alter table deal_counterparties enable row level security;

drop policy if exists deal_counterparties_select on deal_counterparties;
create policy deal_counterparties_select on deal_counterparties for select to authenticated
  using (app.has_org(org_id));
drop policy if exists deal_counterparties_insert on deal_counterparties;
create policy deal_counterparties_insert on deal_counterparties for insert to authenticated
  with check (app.has_org(org_id) and app.can_write());
drop policy if exists deal_counterparties_update on deal_counterparties;
create policy deal_counterparties_update on deal_counterparties for update to authenticated
  using (app.has_org(org_id) and app.can_write()) with check (app.has_org(org_id) and app.can_write());
drop policy if exists deal_counterparties_delete on deal_counterparties;
create policy deal_counterparties_delete on deal_counterparties for delete to authenticated
  using (app.has_org(org_id) and app.can_write());

revoke all on deal_counterparties from anon, public;
grant select, insert, update, delete on deal_counterparties to authenticated;

-- ROLLBACK:
--   drop table if exists deal_counterparties;
