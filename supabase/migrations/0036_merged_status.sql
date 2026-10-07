-- ============================================================================
-- 0036 - An opportunity can be merged into another
-- ----------------------------------------------------------------------------
-- THE GAP. Two opportunity records for one building (the deal-seed loader created
-- "Emerald Theatre, Covent Garden" beside the 30 September "Emerald Theater") need
-- one of them to stop being a deal without being a LOSS. The status vocabulary had
-- no such word: rejected, withdrawn and lost all mean something happened to the
-- deal, and they feed outcome reporting. Reusing "withdrawn" would have counted a
-- data-entry duplicate as a withdrawn deal.
--
-- THE CHANGE.
--   * status gains 'merged'.
--   * merged_into_opportunity_id says WHICH record survived. A status with no pointer
--     is a label; with one it is a statement that can be queried, shown and checked.
--   * A CHECK ties the two together in both directions: a merged row must name its
--     survivor, and nothing else may carry a pointer. A merged row cannot be
--     reactivated by flipping the status alone, because the pointer would then be
--     orphaned and the constraint refuses it.
--   * ON DELETE RESTRICT: a survivor cannot be deleted while records point at it.
--
-- WHAT THIS MIGRATION DOES NOT DO. It changes no row. No opportunity is merged by it;
-- the merge of one specific pair is a separate, reviewed, one-off script
-- (supabase/one-off/, docs/28). Nothing here reads or writes data.
--
-- NO POLICY, GRANT OR VIEW CHANGE. The new column sits on `opportunities`, whose
-- row policies are by organisation. It is not named by investor_feed or by any
-- boundary function, and investors cannot read the table.
-- ============================================================================

-- 1. The pointer. Nullable; only a merged row has one.
alter table public.opportunities
  add column if not exists merged_into_opportunity_id uuid
    references public.opportunities(opportunity_id) on delete restrict;

comment on column public.opportunities.merged_into_opportunity_id is
  'Set only when status = ''merged'': the opportunity this one was folded into because both described the same '
  'building. The surviving record keeps the history; this one is kept for the audit trail and hidden from the pipeline.';

-- 2. The vocabulary. The constraint came from CREATE TABLE (0002), where it is unnamed
--    and therefore called opportunities_status_check.
alter table public.opportunities drop constraint if exists opportunities_status_check;
alter table public.opportunities
  add constraint opportunities_status_check
  check (status in ('active', 'rejected', 'withdrawn', 'lost', 'converted', 'merged'));

-- 3. Status and pointer move together, and a record cannot be merged into itself.
alter table public.opportunities drop constraint if exists opportunities_merged_pointer;
alter table public.opportunities
  add constraint opportunities_merged_pointer
  check (
    (status = 'merged') = (merged_into_opportunity_id is not null)
    and merged_into_opportunity_id is distinct from opportunity_id
  );

-- 4. Belt and braces: exactly one constraint speaks for the status vocabulary, and it
--    knows the new word. A leftover constraint from an earlier definition would
--    silently keep refusing 'merged'.
do $$
declare n int;
begin
  select count(*) into n
    from pg_constraint
   where conrelid = 'public.opportunities'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%''withdrawn''%';
  if n <> 1 then
    raise exception '0036: expected exactly one status constraint on opportunities, found %', n;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.opportunities'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%''merged''%' and conname = 'opportunities_status_check') then
    raise exception '0036: opportunities_status_check does not admit merged';
  end if;
end $$;
