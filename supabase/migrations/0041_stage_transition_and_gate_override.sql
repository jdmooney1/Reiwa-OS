-- ============================================================================
-- 0041 — stage_transition and gate_override: the clearance record
-- ----------------------------------------------------------------------------
-- Per the approved revision to docs/24 §A (I1): the Session 3 TypeScript
-- evaluator is the SINGLE source of gate logic. Nothing in this schema
-- re-derives whether a set of transition/action gates is satisfied — that
-- would duplicate the catalogue-driven evaluation Session 3 owns.
--
-- What this schema DOES do: once the evaluator decides a document_stage
-- transition is legitimate — gates genuinely satisfied, or an authorised
-- override — it writes a `stage_transition` row. That row is the clearance
-- record. 0045's invariants, and anything else that needs to know "was Stage
-- N properly left", check for this row's EXISTENCE. They never re-check the
-- gates themselves.
--
-- A `stage_transition` row may be written for a transition BEFORE
-- `opportunities.document_stage` is actually updated to match (0045's I1
-- needs exactly this ordering: clearance to reach Stage 4 can be granted
-- before conversion happens, and the column only moves to 4 afterwards,
-- once an asset exists — see 0045).
--
-- `gate_override` is the parallel log for ACTION gates (a specific action
-- allowed despite an unmet gate — e.g. instructing a Stage 3 Commission
-- document before abort_cost_agreement is signed) and for the post-close
-- amendment guard (0046). Same posture: a row here is a logged fact, not a
-- re-derivation.
-- ============================================================================

create table if not exists stage_transition (
  transition_id  uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(org_id) on delete cascade,
  opportunity_id uuid not null references opportunities(opportunity_id) on delete cascade,
  from_stage     smallint not null check (from_stage between 0 and 4),
  to_stage       smallint not null check (to_stage between 0 and 4),
  override       boolean not null default false,
  override_reason text,
  at             timestamptz not null default now(),
  recorded_by    uuid references profiles(user_id),

  constraint stage_transition_override_reason check (
    not override or (override_reason is not null and length(btrim(override_reason)) > 0)
  ),
  -- I5: a backward move is itself an override, full stop.
  constraint stage_transition_backward_requires_override check (
    to_stage >= from_stage or override = true
  )
);
create index if not exists idx_stage_transition_opportunity on stage_transition(opportunity_id, at desc);
create index if not exists idx_stage_transition_to_stage on stage_transition(opportunity_id, to_stage);

comment on table stage_transition is
  'The clearance record for a document_stage transition (docs/24). Written by the Session 3 evaluator after it has decided — by satisfied gates or a logged override — that a transition is legitimate. Nothing here re-derives that decision; 0045 only checks that a row exists.';

create table if not exists gate_override (
  override_id        uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(org_id) on delete cascade,
  opportunity_id      uuid not null references opportunities(opportunity_id) on delete cascade,
  deal_investor_id    uuid references deal_investor(deal_investor_id) on delete cascade,
  -- The doc_type whose gate is being overridden, or null for a non-doc-type
  -- action (e.g. the 0046 post-close amendment guard, keyed on an action
  -- string rather than a specific gate document).
  gate_doc_type_key   text references doc_type(key),
  action              text not null,
  reason              text not null check (length(btrim(reason)) > 0),
  recorded_by         uuid references profiles(user_id),
  at                  timestamptz not null default now()
);
create index if not exists idx_gate_override_opportunity on gate_override(opportunity_id, at desc);

comment on table gate_override is
  'Append-only log of action-gate overrides (docs/24) and the 0046 post-close amendment guard. Every row IS an override — there is no non-override row in this table.';

-- ---- RLS ----------------------------------------------------------------
-- I6: only admin/ic_member may record an override=true row. A non-override
-- stage_transition row (the evaluator confirming gates were genuinely
-- satisfied) is an ordinary write-capable action, not a privileged one.
alter table stage_transition enable row level security;
alter table gate_override enable row level security;

drop policy if exists stage_transition_select on stage_transition;
create policy stage_transition_select on stage_transition for select to authenticated
  using (app.has_org(org_id));
drop policy if exists stage_transition_insert on stage_transition;
create policy stage_transition_insert on stage_transition for insert to authenticated
  with check (
    app.has_org(org_id) and app.can_write()
    and (override = false or app.can_override_gates())
  );
-- No update/delete policy for any role: a transition record is a minute, not
-- a draft — same posture as ic_decisions (0008).

drop policy if exists gate_override_select on gate_override;
create policy gate_override_select on gate_override for select to authenticated
  using (app.has_org(org_id));
drop policy if exists gate_override_insert on gate_override;
create policy gate_override_insert on gate_override for insert to authenticated
  with check (app.has_org(org_id) and app.can_override_gates());
-- No update/delete policy for any role.

revoke all on stage_transition, gate_override from anon, public;
grant select, insert on stage_transition to authenticated;
grant select, insert on gate_override to authenticated;

-- ROLLBACK:
--   drop table if exists gate_override;
--   drop table if exists stage_transition;
