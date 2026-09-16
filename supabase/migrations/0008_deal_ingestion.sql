-- ============================================================================
-- 0008 — Deal Inbox: ingestion staging
-- ----------------------------------------------------------------------------
-- Nothing here writes to `opportunities`. An incoming item is parsed, scored
-- and matched in staging, and becomes an opportunity only when a human promotes
-- it. That is the whole point of the review queue (docs/17 §C.3).
--
-- Two properties of this schema are load-bearing:
--
--   * ingestion_items.raw_payload holds the source row VERBATIM, every column
--     including the ones no mapping recognised. "Never silently discard an
--     unrecognised column" is a storage guarantee here, not a UI promise.
--
--   * ingestion_batches.channel is the seam for the future deals@ address. A
--     webhook writes exactly the rows a drag-and-drop upload writes, so adding
--     inbound email later changes nothing downstream.
--
-- Security: org-scoped RLS per 0002, no investor policy of any kind, and
-- anon/PUBLIC privileges revoked. Ingestion data is the most commercially
-- sensitive material in the system (broker commentary, sourcing, pricing
-- history) and is internal-only by construction.
-- ============================================================================

-- ---- Batches ---------------------------------------------------------------
create table if not exists ingestion_batches (
  batch_id     uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(org_id) on delete cascade,

  -- The seam for inbound email. 'upload' today; 'email_inbound' when deals@
  -- lands, writing these same rows.
  channel      text not null default 'upload'
                 check (channel in ('upload', 'email_inbound', 'manual', 'api')),
  kind         text not null default 'spreadsheet'
                 check (kind in ('spreadsheet', 'documents', 'emails', 'mixed', 'manual')),

  label        text,
  status       text not null default 'received'
                 check (status in ('received', 'parsing', 'ready_for_review',
                                   'partly_promoted', 'completed', 'failed')),

  -- Import-wide assumptions. Recorded because they are assumptions: a row that
  -- states its own currency always wins over the default.
  default_currency  text,
  default_country   text,
  default_area_unit text check (default_area_unit in ('sqft', 'sqm')),

  -- The confirmed header mapping for this batch, as {header: field_key|null}.
  -- Kept on the batch so a promotion months later can still explain which
  -- column a value came from.
  column_mappings jsonb not null default '{}'::jsonb,
  mapping_template_id uuid,

  source_file_name text,
  source_storage_path text,
  content_hash text,

  file_count     int not null default 0,
  item_count     int not null default 0,
  promoted_count int not null default 0,
  rejected_count int not null default 0,

  error        text,
  received_at  timestamptz not null default now(),
  completed_at timestamptz,
  created_by   uuid references profiles(user_id)
);

create index if not exists idx_ingestion_batches_org
  on ingestion_batches(org_id, received_at desc);
create index if not exists idx_ingestion_batches_status
  on ingestion_batches(org_id, status);

-- ---- Items -----------------------------------------------------------------
create table if not exists ingestion_items (
  item_id   uuid primary key default gen_random_uuid(),
  org_id    uuid not null references organizations(org_id) on delete cascade,
  batch_id  uuid not null references ingestion_batches(batch_id) on delete cascade,

  item_kind text not null default 'spreadsheet_row'
              check (item_kind in ('spreadsheet_row', 'document', 'email', 'manual')),
  -- Row number within the sheet, or attachment order within an email.
  sequence  int not null default 0,

  -- THE ORIGINAL. Every column under its original header, including those no
  -- mapping recognised. This is never rewritten after insert.
  raw_payload jsonb not null,

  -- The candidate interpretation: {field_key: {value, confidence, notes,
  -- excerpt, source_header}}. Replaced wholesale when an item is re-extracted.
  extracted   jsonb not null default '{}'::jsonb,

  extraction_status text not null default 'pending'
                      check (extraction_status in ('pending', 'extracting', 'extracted',
                                                   'failed', 'skipped')),
  review_status     text not null default 'new'
                      check (review_status in ('new', 'needs_review', 'approved',
                                               'merged', 'rejected', 'passed')),

  confidence_overall numeric(4,3),
  -- Important fields the source does not supply. Reported, never invented.
  missing_fields     text[] not null default '{}',
  issues             jsonb not null default '[]'::jsonb,

  -- Denormalised for the inbox table, so listing 500 items is one query.
  display_name  text,
  display_location text,
  identity_key  text,

  -- Set on promotion, or when an item is attached to an existing record.
  matched_property_id    uuid references properties(property_id) on delete set null,
  matched_opportunity_id uuid references opportunities(opportunity_id) on delete set null,
  promoted_at   timestamptz,
  promoted_by   uuid references profiles(user_id),
  reviewed_at   timestamptz,
  reviewed_by   uuid references profiles(user_id),
  review_note   text,

  -- Populated by later phases; the tables arrive with them.
  source_document_id uuid,
  source_email_id    uuid,

  created_at timestamptz not null default now(),
  unique (batch_id, item_kind, sequence)
);

create index if not exists idx_ingestion_items_batch
  on ingestion_items(batch_id, sequence);
create index if not exists idx_ingestion_items_review
  on ingestion_items(org_id, review_status, created_at desc);
create index if not exists idx_ingestion_items_identity
  on ingestion_items(org_id, identity_key) where identity_key is not null;

-- The raw payload is the audit record of what arrived. Amending it would make
-- every provenance claim downstream unverifiable, so it is frozen at insert.
create or replace function app.guard_ingestion_raw() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    if new.raw_payload is distinct from old.raw_payload then
      raise exception 'ingestion_items.raw_payload is immutable (item %)', old.item_id;
    end if;
    return new;
  end
  $fn$;
drop trigger if exists trg_ingestion_raw_immutable on ingestion_items;
create trigger trg_ingestion_raw_immutable before update on ingestion_items
  for each row execute function app.guard_ingestion_raw();

-- ---- Match candidates ------------------------------------------------------
-- What the matcher thought, kept so a promotion can be explained after the
-- fact: "we attached this to 16 Conduit Street at 92%, on these signals".
create table if not exists match_candidates (
  candidate_id uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(org_id) on delete cascade,
  item_id      uuid not null references ingestion_items(item_id) on delete cascade,

  property_id    uuid references properties(property_id) on delete cascade,
  opportunity_id uuid references opportunities(opportunity_id) on delete cascade,

  score    numeric(5,4) not null,
  band     text not null check (band in ('exact', 'strong', 'possible', 'weak')),
  signals  jsonb not null default '{}'::jsonb,
  reasons  text[] not null default '{}',

  decision text not null default 'pending'
             check (decision in ('pending', 'attached', 'new_opportunity', 'dismissed')),
  decided_by uuid references profiles(user_id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),

  -- A candidate names a property or an opportunity; a row that names neither is
  -- meaningless.
  constraint match_candidates_target_check
    check (property_id is not null or opportunity_id is not null)
);

create index if not exists idx_match_candidates_item
  on match_candidates(item_id, score desc);
create index if not exists idx_match_candidates_property
  on match_candidates(property_id);

-- ---- Saved mapping templates -----------------------------------------------
create table if not exists import_mapping_templates (
  template_id uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(org_id) on delete cascade,
  name        text not null,
  source_hint text,

  -- Order-insensitive digest of the header row, so the same broker's next
  -- export offers this template automatically.
  header_signature text not null,
  mappings jsonb not null default '{}'::jsonb,
  defaults jsonb not null default '{}'::jsonb,

  use_count    int not null default 0,
  last_used_at timestamptz,
  created_by   uuid references profiles(user_id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, name)
);

create index if not exists idx_mapping_templates_signature
  on import_mapping_templates(org_id, header_signature);

do $$ begin
  if not exists (select 1 from pg_constraint
                  where conname = 'ingestion_batches_mapping_template_fkey') then
    alter table ingestion_batches
      add constraint ingestion_batches_mapping_template_fkey
      foreign key (mapping_template_id)
      references import_mapping_templates(template_id) on delete set null;
  end if;
end $$;

-- ---- updated_at ------------------------------------------------------------
drop trigger if exists trg_mapping_templates_touch on import_mapping_templates;
create trigger trg_mapping_templates_touch before update on import_mapping_templates
  for each row execute function app.touch_updated_at();

-- ---- RLS -------------------------------------------------------------------
-- The 0002 loop. No investor policy is written for any of these tables, so an
-- investor's SELECT matches no permissive policy and returns nothing — the same
-- structural denial 0005 relies on, rather than a policy that happens to
-- exclude them.
do $$
declare t text;
begin
  foreach t in array array['ingestion_batches', 'ingestion_items',
                           'match_candidates', 'import_mapping_templates'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select to authenticated using (app.has_org(org_id))', t, t);
    execute format('drop policy if exists %I_insert on %I', t, t);
    execute format('create policy %I_insert on %I for insert to authenticated with check (app.has_org(org_id) and app.can_write())', t, t);
    execute format('drop policy if exists %I_update on %I', t, t);
    execute format('create policy %I_update on %I for update to authenticated using (app.has_org(org_id) and app.can_write()) with check (app.has_org(org_id) and app.can_write())', t, t);
    execute format('drop policy if exists %I_delete on %I', t, t);
    execute format('create policy %I_delete on %I for delete to authenticated using (app.has_org(org_id) and app.can_write())', t, t);
    execute format('revoke all on %I from anon, public', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;

-- The trigger function is deliberately NOT granted to `authenticated`:
-- PostgreSQL checks EXECUTE on a trigger function at CREATE TRIGGER time, not
-- when it fires. This keeps the enumerated EXECUTE matrix from 0005 unchanged.
