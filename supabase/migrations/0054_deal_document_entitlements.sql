-- ============================================================================
-- 0054 — deal_document_entitlements: a sibling to publication_entitlements,
-- never a widening of it
-- ----------------------------------------------------------------------------
-- Session 4 decision A: the investor portal's existing default-deny shape
-- (publication_entitlements, 0005 — a row grants nothing until it is made
-- visible) is the right idiom for deal_document too, but it is NOT the same
-- table. publication_entitlements keys on (investor_org_id, publication_id)
-- and nothing here adds a second meaning to that key, a second nullable FK
-- pair, or a second code path through it — zero schema change to the
-- existing publication flow, exactly as decided.
--
-- This table keys on (deal_investor_id, deal_document_id) instead — the
-- deal-side identity, not the investor-tenancy one. A deal_document is
-- visible to an investor only once a row here names that exact
-- deal_investor and is flipped is_visible = true. Two documents are
-- deliberately NEVER gated by this table at all — see 0056's exemption
-- rule for investor_nda and investor_teaser (docs/24 Session 4: readable
-- from the moment an investor is matched, independent of any entitlement
-- row, because an investor must be able to read the NDA in order to sign
-- it, and the teaser is pre-NDA marketing collateral by design).
--
-- This is a docs/24 table, not a 0005 investor-portal table, so it follows
-- docs/24's own RLS convention (org_id + app.has_org(), the same shape as
-- deal_document/deal_investor/gate_override/document_view_log) rather than
-- 0005's unrelated app.is_admin()-only convention — the two tables this one
-- sits between use different staff-access models, and this one belongs to
-- the deal_document family, not the investor-portal family.
-- ============================================================================

create table if not exists deal_document_entitlements (
  entitlement_id   uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(org_id) on delete cascade,
  deal_investor_id uuid not null references deal_investor(deal_investor_id) on delete cascade,
  deal_document_id uuid not null references deal_document(deal_document_id) on delete cascade,

  -- Default deny: a row grants nothing until it is made visible — same rule,
  -- same wording, as publication_entitlements.is_visible (0005).
  is_visible       boolean not null default false,

  granted_by       uuid references profiles(user_id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (deal_investor_id, deal_document_id)
);
create index if not exists idx_deal_document_entitlements_document on deal_document_entitlements(deal_document_id);
create index if not exists idx_deal_document_entitlements_investor on deal_document_entitlements(deal_investor_id) where is_visible;

comment on table deal_document_entitlements is
  'Default-deny, per-(deal_investor, deal_document) visibility — the deal_document sibling of publication_entitlements (0005), docs/24 Session 4. investor_nda and investor_teaser are never gated here; see app.investor_may_read_deal_document (0056).';

drop trigger if exists trg_deal_document_entitlements_touch on deal_document_entitlements;
create trigger trg_deal_document_entitlements_touch before update on deal_document_entitlements
  for each row execute function app.touch_updated_at();

-- ---- Scope consistency: the investor and the document must name the same deal ----
-- Mirrors app.validate_deal_document_scope() (0039): a staff mistake pairing
-- investor A's deal_investor row with a document from a different
-- opportunity (or a different org) is refused at the insert, not left to
-- the RLS read side to quietly hide.
create or replace function app.validate_deal_document_entitlement_scope() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    di_opportunity uuid;
    di_org         uuid;
    dd_opportunity uuid;
    dd_org         uuid;
  begin
    select opportunity_id, org_id into di_opportunity, di_org
      from public.deal_investor where deal_investor_id = new.deal_investor_id;
    select opportunity_id, org_id into dd_opportunity, dd_org
      from public.deal_document where deal_document_id = new.deal_document_id;

    if di_opportunity is distinct from dd_opportunity then
      raise exception
        'deal_document_entitlements: deal_investor % and deal_document % belong to different opportunities',
        new.deal_investor_id, new.deal_document_id;
    end if;
    if new.org_id is distinct from di_org or new.org_id is distinct from dd_org then
      raise exception
        'deal_document_entitlements: org_id must match both the named deal_investor and deal_document';
    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_deal_document_entitlements_scope on deal_document_entitlements;
create trigger trg_deal_document_entitlements_scope before insert or update on deal_document_entitlements
  for each row execute function app.validate_deal_document_entitlement_scope();

-- ---- RLS: staff side, docs/24's own convention --------------------------
alter table deal_document_entitlements enable row level security;

drop policy if exists deal_document_entitlements_select on deal_document_entitlements;
create policy deal_document_entitlements_select on deal_document_entitlements for select to authenticated
  using (app.has_org(org_id));
drop policy if exists deal_document_entitlements_insert on deal_document_entitlements;
create policy deal_document_entitlements_insert on deal_document_entitlements for insert to authenticated
  with check (app.has_org(org_id) and app.can_write());
drop policy if exists deal_document_entitlements_update on deal_document_entitlements;
create policy deal_document_entitlements_update on deal_document_entitlements for update to authenticated
  using (app.has_org(org_id) and app.can_write()) with check (app.has_org(org_id) and app.can_write());
drop policy if exists deal_document_entitlements_delete on deal_document_entitlements;
create policy deal_document_entitlements_delete on deal_document_entitlements for delete to authenticated
  using (app.has_org(org_id) and app.can_write());

revoke all on deal_document_entitlements from anon, public;
grant select, insert, update, delete on deal_document_entitlements to authenticated;

-- ROLLBACK:
--   drop trigger if exists trg_deal_document_entitlements_scope on deal_document_entitlements;
--   drop function if exists app.validate_deal_document_entitlement_scope();
--   drop trigger if exists trg_deal_document_entitlements_touch on deal_document_entitlements;
--   drop table if exists deal_document_entitlements;
