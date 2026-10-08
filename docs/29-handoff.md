# 29 · Session-boundary handoff

Written at the end of a session, for whichever session picks this up next —
human or Claude, with no memory of the conversation that built this. Read
CLAUDE.md first; it points here and at the other required reading.

---

## 1. What's built, by session

**docs/24 Sessions 2–3** (`claude/quirky-meitner-k4tokb`, migrations
`0033`–`0053`, excluding the three default-branch files `0033_investor_overview
.sql`/`0034_publication_document_ownership.sql`/`0035_staff_role.sql`): the
document catalogue (`doc_type`), the club-deal investor model
(`deal_investor`, `deal_counterparties`), `deal_document`/`document_version`
with stage gates and gate overrides, the gate evaluator, readiness UI,
investor tracker, document view logging (schema only at that point), DD-item
↔ document linking, the introduction register, auto-created deal documents
per stage/investor.

**Flag governance round**: audited edits to `opportunities.flags`/
`deal_investor.flags`, an admin+reason gate on turning `regulated_disclosure`
off, `platform_settings` reads restricted to an explicit staff allowlist.

**Capital pipeline test-data import**: `scripts/import-capital-pipeline-test
-orgs.ts` / `scripts/remove-capital-pipeline-import.ts` — ~78 test
`investor_organizations` rows, tagged, safely removable. Source data lives in
`imports/` (git-ignored, confidential — see CLAUDE.md).

**`0053_role_constraint_reconciliation.sql`**: fixed a cross-branch migration
collision where this branch's `0033_ic_member_role.sql` and the live
branch's `0035_staff_role.sql` each replaced (not extended)
`profiles.global_role_check`, silently dropping each other's role value
depending on apply order. Full account in docs/24 §12.

**docs/24 Session 4a** (migrations `0054`–`0060`): investor RLS on
`deal_document`/`document_version`. `deal_document_entitlements` — a sibling
to `publication_entitlements`, never a widening of it. `deal_room_enabled`
flag (`platform_settings`), seeded **off**. `underwriting_model` excluded by
key, unconditionally. The `investor_nda`/`investor_teaser` exemption from the
entitlement gate (an investor may read these from the moment they're matched
to the deal, before any entitlement exists — they must be able to read the
NDA to sign it). Governing-language Final/Signed + JA
`translation_status = reviewed` rule. `deal_investor.status` gates on
`nda_signed`/`ioi_received` requiring the named document's real status, or a
logged override. `document_version.is_manual_override` for shipping investor
documents by hand before Session 6's generator exists.
`deal_document_entitlements` auto-syncs from `deal_investor.status`
(`0060`), cumulatively, reusing `app.investor_status_rank` (`0047`).
Full account in docs/24 §13.

**Teaser Session 1** (`feature/teaser-generator`, docs/TEASER-AUDIT.md):
read-only audit of the 物件概要書 (property summary) brief against this
codebase — data contract, what's reusable, what's genuinely missing, a
rendering recommendation. No code, no migration.

## 2. Verified vs unverified — read this before trusting anything above

**Verified, every round**: `npm run typecheck`, `npm run lint`,
`npm run test:unit` (1296 tests, no database), `npm run build`. All clean as
of `0060`.

**NOT verified**: the integration suite (`npm test`, everything under
`tests/` outside `tests/unit/` — `tests/deal-document-investor-access.test.ts`
in particular, which is the actual RLS proof for Session 4a) **has never been
run in any session of this engagement.** `TEST_DATABASE_URL`/`TEST_SUPABASE_*`
have been absent every single time they were checked. docs/28 is the exact
setup runbook. Treat every RLS/entitlement/trigger claim in docs/24 §13 as
"reasoned through and unit-tested at the structural level, not proven against
real Postgres" until this has actually run green.

A full manual walkthrough of the **existing, already-live** investor portal
(publication/entitlement system, pre-Session-4) was driven with Playwright
against a local Postgres + local-auth stand-in and confirmed working —
sign-in, dashboard, document download at the correct entitlement tier,
internal-only documents correctly never appearing. That is the system
investors actually see today; it is unrelated to whether Session 4a's new
RLS is correct.

## 3. Open decisions

**From docs/TEASER-AUDIT.md §8** (teaser project, not yet actioned):
1. Render hosting: standalone render service (recommended) vs. Vercel
   serverless Chromium.
2. The four unconfirmed brand hex values (Warm Beige, Night Black, Sakura
   Pink, and one unnamed accent) — only the brand purple matches an existing
   token.
3. Whether `opportunities.size_sqft`/`size_sqm` has always meant GFA, so new
   NLA columns are genuinely additive.
4. Whether `opportunities.reference` is safe to reuse as the blind code
   name (audit's read: yes, by construction, pending confirmation).
5. Transport access as a short paragraph (reuse `transport_connectivity`) vs.
   a real structured station/line/minutes list.
6. Migration number for the teaser's own schema work: **`0061`**, confirmed
   clear against both branches as of this handoff.

**From Session 4a**: `platform_settings_select` was deliberately **not**
widened to admit `reiwa_staff` — stays exactly as decided unless JD says
otherwise.

## 4. Agreed build order from here

1. **Run the integration suite** (docs/28) — the precondition for trusting
   anything in Session 4a, and for ever setting `deal_room_enabled = true`
   anywhere real.
2. **Apply `0054`–`0060` to production** — JD applies these himself, after
   the suite is green. No other migration should be written or numbered
   below `0061` after this point.
3. **Teaser Sessions 2–4** (`feature/teaser-generator`, docs/TEASER-AUDIT.md
   §8 decisions resolved first): data layer, then template/render, then the
   sample deal. **One renderer serves both `teaser.jp_property_summary.v1`
   and `snapshot.en.v1`** — not two parallel render paths — so the Session 3
   rendering infrastructure (Chromium hosting, font embedding, the template
   registry) is built once and reused, not rebuilt per template.
4. **Session 4b**: watermarking (`pdf-lib`), per-document
   `download_disabled`/`expires_at`.
5. **Session 4c**: staff engagement view, `deal_shares` ↔ `deal_document`
   linkage, EN/JA investor labels, the action-gate override UI.

Each step stops for review before the next starts — per CLAUDE.md's working
rules, this file should be updated at each handoff, not left to drift.
