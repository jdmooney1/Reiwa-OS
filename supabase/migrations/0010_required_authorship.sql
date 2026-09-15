-- ============================================================================
-- 0010 — Required authorship (Phase 1A)
-- ----------------------------------------------------------------------------
-- Every record in this system exists to answer a question of the form "who
-- decided this, and on what?". A nullable author column answers "nobody", and
-- does so indistinguishably from "we never recorded it" — which is the same
-- failure the immutability work in 0008/0009 exists to prevent. Making an
-- underwriting version immutable, and then allowing it to have been written by
-- no one, protects a record that cannot be attributed.
--
-- So authorship becomes NOT NULL wherever a row cannot honestly exist without
-- one. It stays nullable in exactly three shapes, listed at the bottom, where
-- null means "this has not happened yet" rather than "we do not know who".
--
-- BACKFILL POLICY. Where an author is derivable from a parent record, it is
-- derived. Where it is not, this migration RAISES rather than invent one.
-- Filling an unattributed row with a plausible user would be fabricating
-- exactly the fact the column exists to carry, and would be indistinguishable
-- afterwards from a genuine attribution. A migration that stops with a clear
-- message is recoverable; a database full of invented authors is not.
-- ============================================================================

-- ---- Derive what can be derived ---------------------------------------------
-- An investment case with no author, on an opportunity that has one, was almost
-- certainly written by whoever logged the opportunity: conversion.ts and the
-- seeder both created cases that way. This is a derivation, not a guess.
update investment_cases c
   set created_by = o.created_by
  from opportunities o
 where o.opportunity_id = c.opportunity_id
   and c.created_by is null
   and o.created_by is not null;

-- ---- Refuse to invent the rest ----------------------------------------------
do $$
declare
  offenders text := '';
  n bigint;
  t record;
begin
  for t in
    select * from (values
      ('opportunities',           'created_by'),
      ('investment_cases',        'created_by'),
      ('ic_decisions',            'recorded_by'),
      ('ic_decision_amendments',  'amended_by'),
      ('opportunity_dd_items',    'created_by'),
      ('opportunity_risks',       'created_by'),
      ('opportunity_documents',   'uploaded_by')
    ) as v(tbl, col)
  loop
    execute format('select count(*) from public.%I where %I is null', t.tbl, t.col) into n;
    if n > 0 then
      offenders := offenders || format(E'\n  - %s.%s: %s row(s)', t.tbl, t.col, n);
    end if;
  end loop;

  if offenders <> '' then
    raise exception E'Cannot require authorship: % unattributed row(s) remain.%\n\n%',
      'some', offenders,
      'Set an author on these rows deliberately, from the record of who created them. '
      'This migration will not choose one for you: an invented author is indistinguishable '
      'from a real one the moment it is written.';
  end if;
end $$;

-- ---- Require it -------------------------------------------------------------
alter table opportunities          alter column created_by  set not null;
alter table investment_cases       alter column created_by  set not null;
alter table ic_decisions           alter column recorded_by set not null;
alter table ic_decision_amendments alter column amended_by  set not null;
alter table opportunity_dd_items   alter column created_by  set not null;
alter table opportunity_risks      alter column created_by  set not null;
alter table opportunity_documents  alter column uploaded_by set not null;

comment on column investment_cases.created_by is
  'Required. Who wrote this underwriting version. An immutable record that cannot be attributed protects nothing.';
comment on column ic_decisions.recorded_by is
  'Required. Who recorded this committee decision.';
comment on column ic_decision_amendments.amended_by is
  'Required. Who corrected the minute, alongside the reason they gave.';

-- ============================================================================
-- Where NULL remains permissible, and why
-- ----------------------------------------------------------------------------
-- These are NOT unattributed records. In each case null carries a meaning that
-- a user id would destroy.
--
--   1. EVENT STAMPS THAT HAVE NOT HAPPENED.
--      investment_cases.approved_by  — null until a committee approves it.
--      publication_versions.submitted_by / published_by — same shape.
--      Null here means "not yet approved", which is a fact about the record's
--      lifecycle. Requiring a value would force a placeholder that reads as an
--      approval, which is worse than the gap it closed. `approved_at` moves in
--      lockstep, so the pair is always self-consistent.
--
--   2. ASSIGNMENT, WHICH IS A CHOICE RATHER THAN A FACT.
--      opportunities.owner_user_id, opportunity_dd_items.owner_user_id,
--      opportunity_risks.owner_user_id.
--      An opportunity may genuinely be unassigned, and a diligence workstream
--      is unowned until somebody takes it. Forcing an owner would mean every
--      new framework arrives with 21 lines falsely assigned to whoever applied
--      it. Authorship (created_by) is still required on all three.
--
--   3. PROVENANCE OF SOMETHING THAT DOES NOT EXIST.
--      publication_version_sources.source_investment_case_id and
--      .source_ic_decision_id — null when an opportunity was published before
--      it had been underwritten or been to committee. Null is the truthful
--      answer, and 0009 made it durable: once a value IS captured it cannot be
--      deleted back to null.
--
-- The distinction throughout: a null that says "this has not happened" is a
-- fact. A null that says "somebody did this and we did not record who" is a
-- defect, and there are none of those left in the pre-acquisition record.
-- ============================================================================
