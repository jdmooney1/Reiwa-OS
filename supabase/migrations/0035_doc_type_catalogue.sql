-- ============================================================================
-- 0035 — Document type catalogue
-- ----------------------------------------------------------------------------
-- The data-not-code rule (docs/24, originally the product brief's rule 7):
-- adding, renaming or re-gating a document type must never require a code
-- change. This table is the whole of that rule. Everything the gate engine
-- (Session 3) and the generator (later) read about a document type — stage,
-- origin, scope, audience, gate kind/action/condition, jurisdiction, whether
-- it is generated and how — lives here, not in an enum or a switch statement.
--
-- NOT org-scoped. Unlike every tenant table in 0002/0003, this is firm-wide
-- policy (Reiwa Capital's own document catalogue), not per-organisation data —
-- the same posture as the DD framework templates (src/lib/dd/templates.ts),
-- which are also shared rather than per-org. Any authenticated internal staff
-- member may read it (needed to render a checklist regardless of role);
-- editing it is a policy change, restricted to admin/ic_member (0033).
--
-- `generation_mode` is deliberately a fourth axis alongside `origin`, not a
-- duplicate of it. `origin = 'produce'` says WHO authors the document
-- (Reiwa); `generation_mode` says HOW a Produce document's bytes come to
-- exist in v1 — docs/24 §C/§D:
--   'template_fill' — net-new server-rendered PDF from a template + deal data
--   'memo_backed'   — rendered from the existing memo composer, through a
--                     dedicated whitelist function, never the catalogue
--                     (see docs/24-deal-document-memo-backing.md)
--   'manual_upload' — a person drafts it outside the system (the legal
--                     template documents) and uploads the file as a version
--   'none'          — Commission/Receive types: nothing is generated, ever
-- ============================================================================

create table if not exists doc_type (
  key              text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  name_en          text not null,
  name_ja          text,
  name_ja_reviewed boolean not null default false,

  stage            smallint not null check (stage between 0 and 4),
  origin           text not null check (origin in ('produce', 'commission', 'receive')),
  scope            text not null check (scope in ('deal', 'investor', 'counterparty')),
  -- Free-text audience labels (e.g. 'internal', 'investor', 'vendor', 'lender').
  -- Not a DB enum — same reasoning as opportunity_documents.category: the
  -- vocabulary is app-layer convention (src/lib/documents/catalog.ts-style),
  -- and a fixed list here would need a migration for every new audience.
  audience         text[] not null default '{}',

  gate_kind        text not null default 'none' check (gate_kind in ('none', 'transition', 'action')),
  -- Free text, read by the Session 3 evaluator, never compiled. A transition
  -- gate's action is implicit (leaving `stage`); gate_action names an ACTION
  -- gate's blocked action (e.g. 'instruct_stage3_commission').
  gate_action      text,
  -- Free text condition key the evaluator understands: 'geared', 'hedged',
  -- 'jurisdiction:UK', 'jurisdiction:NL', 'investor_type:corporate',
  -- 'regulated_disclosure', 'requires_ic_decision' (final_ic_memo only —
  -- docs/24 §D). Null means unconditional.
  gate_condition   text,

  -- Revised per review answer to docs/24 §12: an investor-scoped type is
  -- auto-created when a deal_investor reaches THIS status (cumulatively —
  -- app.investor_status_rank, 0047 — not only on an exact match, so a
  -- funnel status skipped in practice still creates what it would have),
  -- never by the deal's document_stage. Stage is still meaningful for these
  -- rows — it is which stage's EXIT gate the document blocks, read by the
  -- evaluator (src/lib/deal-gates/evaluate.ts) — just not when the row is
  -- created. Null for deal/counterparty-scoped types, which stay
  -- document_stage-driven.
  investor_status_trigger text check (investor_status_trigger in
    ('matched', 'teaser_sent', 'nda_signed', 'pack_released', 'ioi_received', 'soft_circled', 'committed', 'completed')),

  jurisdiction        text check (jurisdiction in ('UK', 'NL')),
  jurisdiction_labels jsonb,

  recurring        boolean not null default false,
  generation_mode  text not null default 'none'
                     check (generation_mode in ('none', 'template_fill', 'memo_backed', 'manual_upload')),
  template_key     text,
  governing_language text not null default 'EN' check (governing_language in ('EN', 'JA')),

  sort_order       int not null default 0,
  is_active        boolean not null default true,

  created_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- A template-fill type needs a template to fill; the other three modes
  -- never reference one (manual_upload's "template" is a human, memo_backed's
  -- is the memo composer, none has nothing to render).
  constraint doc_type_template_key_mode check (
    (generation_mode = 'template_fill' and template_key is not null) or
    (generation_mode <> 'template_fill' and template_key is null)
  ),
  -- A transition gate implies leaving `stage`; an action gate must name the
  -- action it blocks. 'none' carries neither.
  constraint doc_type_gate_shape check (
    (gate_kind = 'action' and gate_action is not null) or
    (gate_kind <> 'action' and gate_action is null)
  )
);

create index if not exists idx_doc_type_stage on doc_type(stage, sort_order);

comment on table doc_type is
  'The document catalogue (docs/24). Firm-wide, not org-scoped. Adding or re-gating a document type is a data change here, never a code change.';

alter table doc_type enable row level security;

drop policy if exists doc_type_select on doc_type;
create policy doc_type_select on doc_type for select to authenticated
  using (true);

drop policy if exists doc_type_write on doc_type;
create policy doc_type_write on doc_type for all to authenticated
  using (app.can_override_gates()) with check (app.can_override_gates());

revoke all on doc_type from anon, public;
grant select, insert, update, delete on doc_type to authenticated;

-- ROLLBACK:
--   drop table if exists doc_type;
