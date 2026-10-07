# 24 · Deal document system

The document catalogue, stage gates, club-deal investor progression, and document
versioning that take a real estate acquisition from screening to close and into the
hold period. Builds on the opportunity/asset lifecycle (`02`), the DD tracker and IC
decisions (`05`, migration `0008`), the memo composer (`07`), the investor portal
(`12`–`15`), and the prospect-link surface (`20`) — extends each rather than
duplicating it.

> **Status.** Session 2 (schema + catalogue seed) complete. Session 3 (gate
> evaluator, checklist/tracker UI, I1 enforcement) not yet built. Sessions 4–8
> await a real deal run through Sessions 2–3 first.

---

## 1. Why this document exists

An audit of this codebase against the original product brief found that the brief's
assumed starting point — "DD tracker and document vault not yet built" — was stale.
Migration `0008` (Phase 1A) had already shipped `opportunity_documents`,
`opportunity_dd_items`, `opportunity_risks` and `ic_decisions`. This system **extends**
those, rather than building a parallel one. The corollary decisions, several of them
revisions during implementation, are recorded here so a later reader does not have to
reconstruct them from migration comments alone.

## 2. "Deal" = `opportunity`, then `asset`

No new `deal` table. A `deal_document`/`deal_investor` row keys on `opportunity_id`
pre-acquisition; Stage 4 (Hold) catalogue rows describe the same opportunity after it
has converted (`opportunities.stage = 'acquired'`, an `asset` row exists).

## 3. Two independent progressions

`opportunities.stage` (new/screening/underwriting/ic/approved/acquired) is the
pipeline's own progression and is untouched. `opportunities.document_stage`
(0 Screen · 1 Pitch-ready · 2 Soft-circled · 3 Closing · 4 Hold, migration `0034`) is
a second, independent progression owned by the gate engine. Stage 2 "Soft-circled"
has no pipeline equivalent, which is the reason they cannot be merged.

### Invariants (migrations `0041`, `0045`, `0046`)

| # | Rule | Enforced |
|---|---|---|
| I1 | `opportunities.stage → 'acquired'` requires a `stage_transition` row with `to_stage = 4` on record | **Session 3** — see §3.1 |
| I2 | A `stage_transition` clearance into Stage 4 requires an approved `ic_decisions` row, unconditionally (even under override) | `0045` |
| I3 | A forward clearance is refused when `opportunities.status ≠ 'active'`, unconditionally | `0045` |
| I4 | `document_stage` cannot reach 4 before `opportunities.stage = 'acquired'` | `0045` |
| I5 | A backward `document_stage` move is itself an override (CHECK: `to_stage >= from_stage or override`) | `0041` |
| I6 | Only `admin`/`ic_member` may insert an `override = true` row on `stage_transition` or any `gate_override` row | RLS, `0041` |
| I7 | A new `document_version` for a Stage 0–3 catalogue document, after the opportunity has converted, requires a `post_close_amendment` `gate_override` in the **same transaction** | `0046` |

None of I2–I7 re-implements the catalogue-driven gate evaluation Session 3 owns —
each is either an existence check against the clearance record (`stage_transition`/
`gate_override`) or a single hard fact (an IC decision; the deal isn't dead).

### 3.1 — I1 is not yet enforced, and why

`src/lib/data/conversion.ts:139` runs `update opportunities set stage = 'acquired'`
today, as live, tested functionality (`tests/lifecycle.test.ts`, the manual E2E walk
in `10-persistence-gate.md`). Session 2 introduced no code path that ever writes a
qualifying `stage_transition` row, because the evaluator that would legitimately write
one is Session 3 work. Shipping I1's trigger in Session 2 would have broken "Convert
to Asset" for every opportunity in the gap between the two sessions — a breach of the
"don't break existing features" rule. **I1 ships in Session 3**, in the same change
that updates `conversion.ts` to write the clearance it will then require.

## 4. Roles

A fourth `profiles.global_role` value, `ic_member` (migration `0033`), alongside
`reiwa_admin`/`org_user`/`investor_viewer`. `organization_members.role`
(owner/manager/analyst/viewer) is **not** revived — the audit found it stored but
never read by any permission check; capability already lives entirely in
`global_role`, so the new capability (override authority, IC decisions) was added
there rather than creating a second place capability is decided. `app.is_ic_member()`
and `app.can_override_gates()` (`= is_admin() or is_ic_member()`) are the two new
helpers; Session 3 wires the actual override-permission UI/action checks and tests.

`investor` is deliberately **not** a fifth value here. A portal investor is a
structurally separate identity (`investor_contacts`, OTP-only, no `profiles` row) —
see `12`/`14` — and a deal-room permission is always a derived database answer
(entitlement + `deal_investor` status), never a role flag on the internal side.

## 5. The catalogue is data (`doc_type`, migration `0035`)

Every axis the gate engine and generator read — stage, origin, scope, audience, gate
kind/action/condition, jurisdiction, recurrence, governing language — is a column, not
code. Firm-wide, not org-scoped (the catalogue is Reiwa's own policy, like the DD
framework templates). Readable by any authenticated staff member; writable only by
`admin`/`ic_member` (`app.can_override_gates()`), because re-gating a document type is
a policy change — which is also why every change is audited (`doc_type_audit`,
migration `0036`, trigger-written, append-only).

`gate_condition` is read two ways depending on `gate_kind` (migration `0047`,
`app.doc_type_applies()`):

- `gate_kind` = `transition`/`action` → the Session 3 evaluator checks the condition
  before clearing the gate.
- `gate_kind` = `none` → the same column means the document **applies at all**
  (`ringi_pack`, `jp_fx_filing`: `investor_type:corporate`) — never auto-created
  otherwise.

`generation_mode` is a separate axis from `origin`. `origin` says who authors a
document; `generation_mode` says how a Produce document's bytes come to exist in v1:

| `generation_mode` | Meaning | Applies to |
|---|---|---|
| `template_fill` | Server-rendered PDF from a template + deal data | `tenancy_schedule`, `offer_letter`, `jp_pre_contract_disclosure`, `ringi_pack`, `completion_report`, `quarterly_report` |
| `memo_backed` | Rendered from the memo composer, through a dedicated whitelist function — never the catalogue (§6) | `investor_teaser`, `pitch_pack`, `underwriting_summary`, `business_plan`, `screening_memo`, `final_ic_memo` |
| `manual_upload` | A person drafts it outside the system; the file is uploaded as a version | `investor_nda`, `advisory_mandate`, `abort_cost_agreement`, `am_agreement` |
| `none` | Commission/Receive types, plus a handful of Produce types with no v1 generation path yet (`underwriting_model`, `comps_sheet`, `heads_of_terms`, `jp_fx_filing`) | — |

`sanctions_screening` from the original catalogue is seeded as **two** `doc_type`
rows — `sanctions_screening_investor` (scope `investor`) and
`sanctions_screening_vendor` (scope `counterparty`) — because `doc_type.scope` is a
single value and the original entry named both.

## 6. Memo-backing: code is the enforcement, not a table

`memo_doc_profiles` was dropped from the plan. The two boundaries that matter —
anonymisation for the Teaser, the Recommendation/score section never reaching
`underwriting_summary` — are exactly the kind of thing this codebase hard-codes
rather than configures (see `MemoSource`'s whitelist in `src/lib/memo/compose.ts`,
or the Teaser's own audience filter). A descriptive database row next to that code
could drift from it and nobody would notice. This section is that mapping,
documented instead.

Each of the six memo-backed `doc_type` keys gets one dedicated, explicit function in
`src/lib/deal-documents/memo-backing.ts` (Session 6):

| `doc_type` key | Function | Source sections | Rule |
|---|---|---|---|
| `investor_teaser` | `renderInvestorTeaserDoc` | The existing Investor Teaser format, as composed | Runs through a new, explicit **anonymisation** step (strip vendor/broker/address/source identifiers) in code — a catalogue toggle cannot satisfy this |
| `pitch_pack` | `renderPitchPackDoc` | Investor Teaser format + Exit Strategy, named investor | **Not** anonymised — released after NDA, unlike the Teaser |
| `underwriting_summary` | `renderUnderwritingSummaryDoc` | Key Metrics, Financial Analysis, FX Sensitivity only | The function **never receives** Recommendation's data — not filtered out, never passed in, same discipline as the memo's address/photo boundary |
| `business_plan` | `renderBusinessPlanDoc` | The **override** text for Business Plan / Risk & Mitigation only | Never the internal committee-voice composed text (doc `07`'s existing rule); empty with "no data recorded" until a person writes the override |
| `screening_memo` | `renderScreeningMemoDoc` | Internal-fidelity render (audience = Internal in the catalogue) | No anonymisation or audience filtering needed — it never leaves the firm |
| `final_ic_memo` | `renderFinalIcMemoDoc` | The full IC Memo format | Gate condition `requires_ic_decision` — Final **and** an approved `ic_decisions` row (I2 backstops this at the database level too, §3) |

Boundary test (Session 6): `tests/unit/deal-document-memo-backing-boundaries.test.ts`,
same shape as `memo-boundaries.test.ts` — asserts the forbidden sections are
structurally unreachable, not merely unused. Every `document_version` for these six
types stores its own `generated_from_snapshot` and `sha256` — never a live pointer to
the memo; regenerating creates a new version, same rule as everything else.

## 7. Rendering

Headless Chromium → PDF for `template_fill` and `memo_backed` types, hashed, stored.
DOCX is deferred. The four `manual_upload` legal documents are drafted outside the
system and uploaded as a `document_version` (`template_key = null`); versioning,
hashing and immutability-on-final still apply — only authorship is manual.

**Session 6 note, not yet actioned:** the Chromium PDF pipeline must embed Noto Sans
JP directly in its own render context. `next/font`'s loading (§8) is browser-side
only and does not help a headless render process.

## 8. Japanese glyph coverage

Before this system, the only font loaded anywhere was DM Sans (`subsets: ["latin"]`)
— every Japanese render (the memo translation Teaser, doc `22`; the Japanese Language
Summary print view) fell through to whatever CJK font the viewer's OS happened to
have, unverified. `src/app/layout.tsx` now also loads Noto Sans JP
(`subsets: ["latin"]` — next/font/google exposes no separate "japanese" subset for
this font; its CJK coverage isn't subset-gated) as `--font-jp`, and
`globals.css`'s `--font-sans` stack
falls through to it before the generic system stack. This is a browser-rendering fix
only — see §7's note for the separate Session 6 requirement.

## 9. `opportunity_documents` vs `deal_document`

Two tables, enforced apart, not left to convention:

- `deal_document.doc_type_key not null references doc_type(key)` — a catalogue type
  can only ever be recorded as a `deal_document` row; there is nowhere else for it to
  exist.
- A trigger (`app.block_catalogued_category_in_opportunity_documents`, migration
  `0039`) refuses any new `opportunity_documents` row whose free-text `category`
  collides (case-insensitive) with a `doc_type.key` or `name_en`. Existing rows are
  not retroactively validated — the migration instead runs a diagnostic scan and
  `RAISE WARNING`s on any collision found, without failing. None were expected (the
  catalogue is new as of this system) or found.

UI implication for later: "Upload to vault" and "Upload a version of &lt;catalogue
type&gt;" should be two visibly different actions. Not built yet.

## 10. DD tracker ↔ Commission documents

One-directional projection, the same idiom as `app.project_case_to_opportunity`
(migration `0009`). `deal_document.linked_dd_item_id` (at most one per DD item,
migration `0043`) names the Commission document fulfilling a workstream.
`deal_document.status` is authoritative and can only push the linked
`opportunity_dd_items.status` **forward**, as a floor
(`requested/instructed → requested`, `draft/in_review → in_progress`,
`final/signed → reviewed`). Staff keep the ability to layer a diligence judgement on
top (`issue_identified`/`resolved`/`not_applicable`) — the document's arrival cannot
make that call for them — but cannot move a linked item backward below the floor; the
database refuses it and names the linked document instead.

## 11. Introduction register: two populations, two mechanisms

- **Mandated investors**: `deal_investor.first_introduced_at` (migration `0038`),
  computed and protected by `app.set_deal_investor_first_introduced()` — set at
  creation as the earlier of "now" and the originating share's first view (if one is
  attached), and afterwards movable only earlier, only when an earlier-viewed
  `originating_share_id` is attached, never later.
- **Prospects**: `deal_introduction_register` (migration `0044`), a **view** over
  `deal_shares`/`deal_share_views` (migration `0029`) — not a table. Those tables are
  already immutable by construction and doc `20` enforces, with its own boundary
  test, that the prospect surface shares no code path with anything `investor_*`. A
  new table here would have meant either minting a fake `investor_organizations` row
  per prospect, or crossing that boundary. The view exposes `shown_anonymised_teaser`
  / `shown_named_snapshot` (from `deal_shares.teaser_memo_id`/`snapshot_memo_id`) so a
  reader never has to know that distinction lives in column naming on `deal_shares`.
- The two are unioned **only at the reporting layer** (Session 4+), never at the
  schema/FK level. `deal_investor.originating_share_id` (nullable, staff-side FK to
  `deal_shares`) is what lets a prospect who was shown the deal before being formally
  tracked carry their real introduction date forward.

## 12. Known gaps and open questions carried into Session 3+

- **I1** does not exist yet — see §3.1.
- **`heads_of_terms`** has no decided `generation_mode` — seeded as `none`. Catalogue
  described it as "Produce (with lawyer review step)", which doesn't cleanly fit
  `template_fill`/`manual_upload`/`memo_backed`; needs a call before Session 6.
- **"Or advances status"** (auto-create trigger wording, migration `0047`): investor-
  scoped `deal_document` rows are created when the **deal's** `document_stage`
  advances or a `deal_investor` is created, not when the individual investor's own
  status funnel (matched→…→completed) moves. Every investor-scoped `doc_type` in the
  seed catalogue is tagged Stage 1 or 2, the same vocabulary as deal-scoped types, and
  nothing ties a document to a specific funnel status rather than a stage — but if a
  literal status-driven reading was intended, it needs a different design.
- **Hosting for the Session 6 Chromium PDF pipeline** — deferred, per plan, to before
  Session 6, not decided now.
- **`platform_settings` holding test-import metadata is a workaround, not a design
  decision.** `scripts/import-capital-pipeline-test-orgs.ts` needed a staff-only place
  to keep tier/phase/composite/intro-route/trigger/next-action/reputational-flag for
  each imported `investor_organizations` row — `notes` itself is RLS-row-visible to
  that organisation's own investor the moment any `investor_contacts` row is ever
  linked to it (RLS is row-level, not column-level), so the metadata could not stay
  there. `platform_settings` (0051/0052) was reused as the least-bad existing option
  because its own purpose is already "settings with nowhere else to live" and its
  SELECT policy is already staff-only — but it is a flat, global key/value table, not
  an entity-metadata store, and nothing renders these rows in the investor tracker UI.
  If a CRM/targets module is ever built on this pack's broader data model (see
  `imports/targets/CLAUDE_CODE_BRIEF.md`, not otherwise acted on), this metadata should
  move to a dedicated staff-only table — e.g. `investor_organization_metadata` or
  similar, keyed on `investor_org_id` — and the test-import script's reliance on
  `platform_settings` should be retired at the same time.
- **Migration numbers 0033–0035 collided with the product-polish branch** (merged
  via `0053_role_constraint_reconciliation.sql`). Both branches independently added a
  `profiles.global_role` value after migration `0032` — this branch's `0033_ic_member_role.sql`
  (`ic_member`) and the other branch's `0035_staff_role.sql` (`reiwa_staff`) — and each does a
  full `drop constraint` / `add constraint` on `profiles_global_role_check` rather than an
  additive change, so whichever ran last silently dropped the other's role value from the
  allowed set. The migration runner (`runMigrations()`, `src/lib/db/client.ts`) applies files
  in plain alphabetical order and treats each as "already applied" purely by filename string,
  so the two branches' differently-named 0033/0034/0035 files never collided *as filenames* —
  they just silently overwrote each other's SQL effect. This made the outcome
  environment-dependent rather than one fixed bug:
  - **On production** (the other branch's 0033–0035 already applied in an earlier, separate
    run; this branch's 0033–0052 applied afterwards in one run on top): this branch's
    `0033_ic_member_role.sql` ran *after* `0035_staff_role.sql`, so `ic_member`'s constraint
    overwrote `reiwa_staff`'s — **`reiwa_staff` was silently dropped from the allowed values.**
  - **On a fresh database** (every file from both branches present from the start, one single
    alphabetical pass): string sort interleaves the two 0033/0034/0035 pairs
    (`0033_ic_member_role.sql` < `0033_investor_overview.sql`; `0035_doc_type_catalogue.sql` <
    `0035_staff_role.sql`), so `0035_staff_role.sql` is the later of the two constraint-touching
    files — **the opposite role, `ic_member`, is the one silently dropped.**
  Neither environment errors or shows an immediate symptom, because no `profiles` row held the
  dropped value at the time. `0053_role_constraint_reconciliation.sql`, numbered after
  everything either branch defines, unconditionally re-asserts the full union of all five
  `global_role` values; being last by number, it fixes both orderings regardless of which one
  a given environment happened to apply. A survey of every other `create or replace function`,
  `create policy` and trigger in both branches' 0033–0035/0033–0052 found no other collision —
  this constraint was the only shared, non-additively-redefined object.
