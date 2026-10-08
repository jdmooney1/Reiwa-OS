-- ============================================================================
-- 0043 — DD tracker ↔ Commission document: one-directional projection
-- ----------------------------------------------------------------------------
-- Same idiom as app.project_case_to_opportunity() (0009): one authoritative
-- record projects onto a simpler status field, so there is never a second,
-- independently-writable copy of the same fact.
--
-- `deal_document.status` is authoritative for a linked DD item. It can only
-- push the item's status FORWARD, as a floor — staff keep the ability to
-- layer a diligence judgement on top (issue_identified / resolved /
-- not_applicable), which the document's arrival cannot make for them, but
-- they cannot move a linked item BACKWARD below what the document implies.
--
-- At most one Commission document may link to a given DD item (partial
-- unique index below) — a workstream is fulfilled by one specific document,
-- not several competing ones.
-- ============================================================================

-- A plain unique constraint would also forbid two rows both having NULL
-- (unlinked) — not what's wanted. A partial index is exactly "unique among
-- the linked ones", which is the actual rule.
create unique index if not exists deal_document_single_dd_link
  on deal_document(linked_dd_item_id) where linked_dd_item_id is not null;

create or replace function app.dd_status_rank(status text) returns int
  language sql immutable
  set search_path = ''
  as $$
    select case status
      when 'not_started'      then 0
      when 'requested'        then 1
      when 'in_progress'      then 2
      when 'received'         then 3
      when 'reviewed'         then 4
      when 'not_applicable'   then 5
      when 'issue_identified' then 5
      when 'resolved'         then 6
      else 0
    end
  $$;

comment on function app.dd_status_rank is
  'Ordering for opportunity_dd_items.status so a linked deal_document can only move it forward. Terminal judgement calls (issue_identified/resolved/not_applicable) rank above reviewed so the projection never overwrites a judgement a document''s mere arrival did not make.';

-- EXECUTE grants below, for this and deal_document_status_floor: both are
-- called from WITHIN the trigger function bodies further down, not only as
-- triggers themselves. Postgres checks a trigger function's own EXECUTE
-- privilege at CREATE TRIGGER time (the privileged migration role), but a
-- PLAIN function called from inside that trigger body is an ordinary call,
-- checked against whichever role is actually executing — `authenticated`,
-- for a trigger firing under withSession(). Migration 0008's closing section
-- means a new function in `app` is born with no PUBLIC or anon execute by
-- default, and critically no `authenticated` execute either (`authenticated`
-- only ever had it via PUBLIC) — so without an explicit grant here, the
-- projection trigger below would fail for every ordinary signed-in writer.
revoke execute on function app.dd_status_rank(text) from public, anon;
grant execute on function app.dd_status_rank(text) to authenticated;

create or replace function app.deal_document_status_floor(doc_status text) returns text
  language sql immutable
  set search_path = ''
  as $$
    select case doc_status
      when 'requested'  then 'requested'
      when 'instructed' then 'requested'
      when 'draft'      then 'in_progress'
      when 'in_review'  then 'in_progress'
      when 'final'      then 'reviewed'
      when 'signed'     then 'reviewed'
      else null -- not_started, superseded: no floor implied
    end
  $$;

revoke execute on function app.deal_document_status_floor(text) from public, anon;
grant execute on function app.deal_document_status_floor(text) to authenticated;

-- ---- Projection: deal_document.status -> opportunity_dd_items.status floor --
create or replace function app.project_deal_document_to_dd_item() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    floor_status text;
  begin
    if new.linked_dd_item_id is null then
      return new;
    end if;
    floor_status := app.deal_document_status_floor(new.status);
    if floor_status is null then
      return new;
    end if;
    update public.opportunity_dd_items
       set status = floor_status
     where dd_item_id = new.linked_dd_item_id
       and app.dd_status_rank(status) < app.dd_status_rank(floor_status);
    return new;
  end
  $fn$;

drop trigger if exists trg_deal_document_project_dd on deal_document;
create trigger trg_deal_document_project_dd after insert or update on deal_document
  for each row execute function app.project_deal_document_to_dd_item();

-- ---- Guard: a linked DD item cannot be edited below the document's floor --
create or replace function app.guard_linked_dd_item_status() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    linked_status text;
    floor_status  text;
  begin
    if new.status is distinct from old.status then
      select dd.status into linked_status
        from public.deal_document dd
       where dd.linked_dd_item_id = old.dd_item_id
       limit 1;

      if linked_status is not null then
        floor_status := app.deal_document_status_floor(linked_status);
        if floor_status is not null and app.dd_status_rank(new.status) < app.dd_status_rank(floor_status) then
          raise exception
            'opportunity_dd_items % is linked to a deal_document at status "%" (floor "%") — update the document instead of setting this item backward',
            old.dd_item_id, linked_status, floor_status;
        end if;
      end if;
    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_dditems_guard_linked_status on opportunity_dd_items;
create trigger trg_dditems_guard_linked_status before update on opportunity_dd_items
  for each row execute function app.guard_linked_dd_item_status();

-- ROLLBACK:
--   drop trigger if exists trg_dditems_guard_linked_status on opportunity_dd_items;
--   drop function if exists app.guard_linked_dd_item_status();
--   drop trigger if exists trg_deal_document_project_dd on deal_document;
--   drop function if exists app.project_deal_document_to_dd_item();
--   drop function if exists app.deal_document_status_floor(text);
--   drop function if exists app.dd_status_rank(text);
--   drop index if exists deal_document_single_dd_link;
