-- ============================================================================
-- 0039 — deal_document: the catalogue-driven document record
-- ----------------------------------------------------------------------------
-- NOT a replacement for `opportunity_documents` (0008). That table keeps
-- serving ad-hoc, uncatalogued uploads — a stray file with no doc_type, no
-- gate, no version history. `deal_document` exists only for rows that name a
-- catalogue entry: it is the gated, versioned, stage-aware record docs/24
-- describes. Two tables, two purposes, enforced apart (§2 below) rather than
-- left to convention.
--
-- `doc_type_key not null references doc_type(key)` is what makes "a
-- catalogue type may only live in deal_document" true by construction — there
-- is no other table a catalogue type could be recorded against.
--
-- Scope enforcement (which of deal_investor_id/counterparty_id must be set)
-- needs doc_type.scope, which lives in another table, so a plain CHECK can't
-- express it — hence the trigger below rather than a constraint.
-- ============================================================================

create table if not exists deal_document (
  deal_document_id uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(org_id) on delete cascade,
  opportunity_id   uuid not null references opportunities(opportunity_id) on delete cascade,
  deal_investor_id uuid references deal_investor(deal_investor_id) on delete cascade,
  counterparty_id  uuid references deal_counterparties(counterparty_id) on delete cascade,
  doc_type_key     text not null references doc_type(key),

  -- 'not_applicable' added per review answer to docs/24 §12: a declined
  -- investor's still-open documents are marked not_applicable (app.
  -- mark_declined_investor_docs_not_applicable, 0047) — never deleted, so
  -- the record of what was never pursued survives the decline.
  status       text not null default 'not_started'
                 check (status in ('not_started', 'requested', 'instructed', 'draft',
                                    'in_review', 'final', 'signed', 'superseded', 'not_applicable')),
  owner_user_id uuid references profiles(user_id),
  due_date      date,

  -- Commission fields.
  provider      text,
  fee_estimate  numeric(18,2),
  requested_at  timestamptz,
  instructed_at timestamptz,
  received_at   timestamptz,

  -- FK added in 0040 once document_version exists (chicken/egg: a version
  -- belongs to a document, and the document names its current version).
  current_version_id uuid,

  visibility text not null default 'internal' check (visibility in ('internal', 'investor_visible')),

  signed_at        timestamptz,
  esign_provider   text,
  esign_envelope_id text,

  -- Set when a Commission document fulfils a specific DD workstream — see
  -- 0043 for the one-directional status projection this enables.
  linked_dd_item_id uuid references opportunity_dd_items(dd_item_id) on delete set null,

  notes      text,
  created_by uuid references profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per (opportunity, doc_type, target). The sentinel nil UUID treats
-- "no investor"/"no counterparty" uniformly so a deal-scoped type still gets
-- exactly one row per opportunity.
create unique index if not exists deal_document_one_per_target
  on deal_document(
    opportunity_id, doc_type_key,
    coalesce(deal_investor_id,  '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(counterparty_id,   '00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists idx_deal_document_opportunity on deal_document(opportunity_id);
create index if not exists idx_deal_document_investor on deal_document(deal_investor_id) where deal_investor_id is not null;
create index if not exists idx_deal_document_dd_item on deal_document(linked_dd_item_id) where linked_dd_item_id is not null;

drop trigger if exists trg_deal_document_touch on deal_document;
create trigger trg_deal_document_touch before update on deal_document
  for each row execute function app.touch_updated_at();

-- ---- Scope enforcement -------------------------------------------------------
create or replace function app.validate_deal_document_scope() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    expected_scope text;
  begin
    select scope into expected_scope from public.doc_type where key = new.doc_type_key;

    if expected_scope = 'investor' and new.deal_investor_id is null then
      raise exception 'deal_document for doc_type % requires deal_investor_id (scope = investor)', new.doc_type_key;
    end if;
    if expected_scope = 'counterparty' and new.counterparty_id is null then
      raise exception 'deal_document for doc_type % requires counterparty_id (scope = counterparty)', new.doc_type_key;
    end if;
    if expected_scope = 'deal' and (new.deal_investor_id is not null or new.counterparty_id is not null) then
      raise exception 'deal_document for doc_type % is deal-scoped and may not name an investor or counterparty', new.doc_type_key;
    end if;
    if expected_scope <> 'investor' and new.deal_investor_id is not null then
      raise exception 'deal_document for doc_type % (scope %) may not name deal_investor_id', new.doc_type_key, expected_scope;
    end if;
    if expected_scope <> 'counterparty' and new.counterparty_id is not null then
      raise exception 'deal_document for doc_type % (scope %) may not name counterparty_id', new.doc_type_key, expected_scope;
    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_deal_document_scope on deal_document;
create trigger trg_deal_document_scope before insert or update on deal_document
  for each row execute function app.validate_deal_document_scope();

-- ============================================================================
-- §2 — opportunity_documents vs deal_document: the enforced separation
-- ----------------------------------------------------------------------------
-- Diagnostic first: report any EXISTING opportunity_documents row whose
-- free-text category already collides with a catalogue key or name, without
-- failing this migration. The catalogue is new as of 0035, so this is
-- expected to find nothing in practice — it is here so a collision is
-- surfaced rather than silently left for the trigger below to mask.
-- ============================================================================
do $$
declare
  collision_count bigint;
  sample text;
begin
  select count(*), string_agg(document_id::text, ', ' order by created_at desc)
    into collision_count, sample
  from (
    select document_id, created_at from opportunity_documents od
    where exists (
      select 1 from doc_type dt
       where lower(dt.key) = lower(od.category) or lower(dt.name_en) = lower(od.category)
    )
    limit 20
  ) collisions;

  if collision_count > 0 then
    raise warning
      'opportunity_documents: % existing row(s) have a category colliding with a doc_type catalogue entry (sample document_ids: %). These are NOT catalogue documents and this migration does not change them — review and re-upload as deal_document rows if they should be. Collision checks apply only to new writes from now on.',
      collision_count, sample;
  end if;
end $$;

create or replace function app.block_catalogued_category_in_opportunity_documents() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    if exists (
      select 1 from public.doc_type dt
       where lower(dt.key) = lower(new.category) or lower(dt.name_en) = lower(new.category)
    ) then
      raise exception
        'opportunity_documents.category "%" matches a doc_type catalogue entry — upload this as a deal_document instead (doc_type_key references the catalogue; opportunity_documents is for uncatalogued files only)',
        new.category;
    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_oppdocs_block_catalogued_category on opportunity_documents;
create trigger trg_oppdocs_block_catalogued_category before insert or update on opportunity_documents
  for each row execute function app.block_catalogued_category_in_opportunity_documents();

-- ---- RLS ----------------------------------------------------------------
alter table deal_document enable row level security;

drop policy if exists deal_document_select on deal_document;
create policy deal_document_select on deal_document for select to authenticated
  using (app.has_org(org_id));
drop policy if exists deal_document_insert on deal_document;
create policy deal_document_insert on deal_document for insert to authenticated
  with check (app.has_org(org_id) and app.can_write());
drop policy if exists deal_document_update on deal_document;
create policy deal_document_update on deal_document for update to authenticated
  using (app.has_org(org_id) and app.can_write()) with check (app.has_org(org_id) and app.can_write());
drop policy if exists deal_document_delete on deal_document;
create policy deal_document_delete on deal_document for delete to authenticated
  using (app.has_org(org_id) and app.can_write());

revoke all on deal_document from anon, public;
grant select, insert, update, delete on deal_document to authenticated;

-- ROLLBACK:
--   drop trigger if exists trg_oppdocs_block_catalogued_category on opportunity_documents;
--   drop function if exists app.block_catalogued_category_in_opportunity_documents();
--   drop trigger if exists trg_deal_document_scope on deal_document;
--   drop function if exists app.validate_deal_document_scope();
--   drop trigger if exists trg_deal_document_touch on deal_document;
--   drop table if exists deal_document;
