-- ============================================================================
-- 0007 — The deal file: due diligence, contacts, documents, decision log
-- ----------------------------------------------------------------------------
-- Phase 0 of the reset. These four tables previously existed only as an
-- in-memory mock keyed to a parallel `Deal` model. They are now children of the
-- one shared record — `opportunities` — which is what carries a deal from
-- Sourced through to Acquired and, via `assets`, beyond.
--
-- There is no `deal_id` anywhere in this schema and there must never be one.
-- Opportunity Intelligence and Asset Intelligence are two views of one
-- lifecycle, not two records.
--
-- Deliberately NOT here:
--   * A deal-level risk register. Pre-acquisition red flags belong to the Five
--     Tests scorecard (Phase 1); post-acquisition risks are `asset_risks`.
--   * Any document extraction, confidence or provenance column. Document
--     intake is Phase 3 and arrives with its own audit trail; until then
--     `deal_documents` is a register of what we hold, nothing more.
-- ============================================================================

-- ---- Due diligence ---------------------------------------------------------
-- One row per standing workstream, instantiated from a market framework
-- (src/lib/dd/templates.ts). `section` is free text on purpose: the frameworks
-- differ by market and will change. The canonical section list lives in
-- TypeScript, where it can be revised without a migration.
create table if not exists dd_items (
  item_id        uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(org_id) on delete cascade,
  opportunity_id uuid not null references opportunities(opportunity_id) on delete cascade,
  section        text not null,
  item           text not null,
  question       text,
  jurisdiction   text not null default 'UK'
                   check (jurisdiction in ('UK', 'Netherlands', 'Japan', 'Cross-border')),
  priority       text not null default 'medium'
                   check (priority in ('low', 'medium', 'high', 'critical')),
  status         text not null default 'not_started'
                   check (status in ('not_started', 'requested', 'in_progress', 'received',
                                     'reviewed', 'issue_identified', 'resolved', 'not_applicable')),
  risk_level     text check (risk_level in ('low', 'medium', 'high')),
  owner          text,
  due_date       date,
  notes          text,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_dd_items_opp on dd_items(opportunity_id, sort_order);

drop trigger if exists trg_dd_items_touch on dd_items;
create trigger trg_dd_items_touch before update on dd_items
  for each row execute function app.touch_updated_at();

-- ---- Contacts --------------------------------------------------------------
-- `opportunity_id` is nullable so the same table becomes the firm-wide
-- directory of brokers, vendors, advisers and lenders without a migration.
create table if not exists deal_contacts (
  contact_id     uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(org_id) on delete cascade,
  opportunity_id uuid references opportunities(opportunity_id) on delete cascade,
  name           text not null,
  company        text,
  role           text,
  email          text,
  phone          text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_deal_contacts_opp on deal_contacts(opportunity_id);

drop trigger if exists trg_deal_contacts_touch on deal_contacts;
create trigger trg_deal_contacts_touch before update on deal_contacts
  for each row execute function app.touch_updated_at();

-- ---- Documents (register only — no storage or extraction until Phase 3) ----
-- `storage_path` stays null until Supabase Storage is wired in. A row here
-- asserts only that a document exists and what kind it is.
create table if not exists deal_documents (
  document_id    uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(org_id) on delete cascade,
  opportunity_id uuid not null references opportunities(opportunity_id) on delete cascade,
  file_name      text not null,
  file_type      text,
  category       text not null default 'Other',
  storage_path   text,
  notes          text,
  uploaded_by    uuid references profiles(user_id),
  uploaded_at    timestamptz not null default now()
);
create index if not exists idx_deal_documents_opp on deal_documents(opportunity_id, uploaded_at desc);

-- ---- Decision log ----------------------------------------------------------
-- Append-only by convention rather than by trigger: a decision can be corrected
-- while it is being written up, but the firm's record of why it acted is the
-- point of the table. Nothing deletes from here in normal use.
create table if not exists decision_log (
  decision_id    uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(org_id) on delete cascade,
  opportunity_id uuid not null references opportunities(opportunity_id) on delete cascade,
  decision_date  date not null default current_date,
  decision_type  text not null default 'other'
                   check (decision_type in ('screening', 'investment_committee', 'bid',
                                            'exclusivity', 'legal', 'completion', 'abort', 'other')),
  decision       text not null,
  rationale      text,
  next_steps     text,
  author         text,
  created_by     uuid references profiles(user_id),
  created_at     timestamptz not null default now()
);
create index if not exists idx_decision_log_opp on decision_log(opportunity_id, decision_date desc);

-- ---- RLS -------------------------------------------------------------------
-- Same posture as every org-scoped table: read requires membership, write
-- requires membership plus write scope. Supabase's default grants to `anon` are
-- taken back explicitly rather than assumed absent.
do $$
declare t text;
begin
  foreach t in array array['dd_items','deal_contacts','deal_documents','decision_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, public', t);
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
