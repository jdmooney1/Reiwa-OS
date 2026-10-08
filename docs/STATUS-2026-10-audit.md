# Platform status audit - 2026-10-08

Read-only. No code changes, no migrations, no merges, no writes to any hosted database. The only change on this branch
(`claude/platform-status-audit`, created from the tip of `claude/quirky-meitner-k4tokb`, `3a62934`) is this file.

**How each statement was established** (tags used throughout):
- **[GH]** GitHub API, read-only (deployments, PRs, default branch).
- **[git]** local git history and diffs of the fetched remote branches.
- **[PG]** executed against a throwaway local PostgreSQL 16 built from this branch's 63 migrations, with a local
  stand-in for Supabase Auth. Not the repo's `TEST_*` Supabase project and not any hosted database.
- **[static]** read from code or SQL; not executed.
- **[agent]** produced by a read-only reading agent and spot-checked by me where marked.

**What I could NOT do:** reach any hosted database (see Phase 0). Everything about production state that is not on GitHub is
therefore unverified here and is labelled as such.

---

## Phase 0 - Ground truth on what is deployed (read this first)

### Conclusion

**The handoff's "live" is not (a) and cannot be shown to be (b). It is, today, closest to (c) with a (b)-shaped claim inside it:
the deal document system is NOT serving traffic, and the claim that its migrations are applied to production is a relayed
statement that nothing in the repo or from this sandbox can confirm.** Specifically:

1. **Code serving traffic does not include the deal document system. [GH]** Quirky (`claude/quirky-meitner-k4tokb`, PR #31) is
   an OPEN, unmerged PR (16 commits, 78 files, +7,999/-91; GitHub says mergeable and clean). It has only ever had
   *Preview* deployments. Polish's history contains nothing past `0035_staff_role.sql`.
2. **"Polish is the production branch" stopped being demonstrable on 6 October. [GH]** GitHub's default branch is polish and
   every PR to date targets it. Twelve *Production* deployments exist, all of them commits that are ancestors of polish, the
   last one being `60451e4` ("Merge pull request #28", created 2026-10-06 07:54 UTC; its status was updated again at 09:40 and 11:27). After
   that, polish received PR #29, PR #30 and about 25 further commits up to `d25d024`. **Every one of them produced a
   Preview deployment only. No Production deployment has been created since 07:54 UTC on 6 October.** Either the Vercel
   production branch was changed, production auto-deploy was paused, or promotion became manual. That is not
   determinable from the repo or GitHub; it needs the Vercel dashboard (Project -> Settings -> Git -> Production Branch, and
   the Deployments list filtered to Production).
3. **So what production *code* is, at best:** polish at `60451e4`. That predates `0032` (deal-seed schema), `0033`
   (investor overview), `0034` (publication document ownership), `0035` (staff role) and the investor-wording/FX change.
   The latest Production deployment's code knows migrations up to `0031`.
4. **The claim "migrations 0001-0053 are applied to production" (CLAUDE.md) is unverified. [static]** `db:whoami` confirms
   `.env.local` points at Supabase project `lbmtlcdjjgfotzqpxswk`, but I could not read the migration ledger: TCP 5432 and
   6543 to the pooler time out from this sandbox, and the REST API returns `401 Invalid API key` for the key in
   `.env.local`. CLAUDE.md itself forbids sessions from touching production, so the statement can only have come to the
   authors second-hand (docs/24 section 12 describes the production apply order in detail, which reads as relayed from JD).
5. **If that claim IS true, the database is ahead of the deployed code, and that has consequences today** (section "If the
   database really is at 0053", below).

So of your three options: it is not (a). It may be (b), but I cannot confirm it, and the inconsistency you spotted is real:
the handoff states a deployed branch and an applied-migration set that cannot both describe one coherent production.

### Exactly what `npm run db:whoami` prints

As run in this session's shell (the shell has a stray `DATABASE_URL` containing the literal `[project-ref]` placeholder, which
shadows `.env.local` because dotenv does not override existing variables):

```
DATABASE_URL (password never shown):
  host:     aws-0-ap-northeast-1.pooler.supabase.com
  port:     6543
  database: postgres
  project ref (from the username): (none - a direct, non-pooler connection carries no ref)

NEXT_PUBLIC_SUPABASE_URL project ref: lbmtlcdjjgfotzqpxswk

Could not determine one or both project refs from the configured URLs - check .env.local by eye before proceeding.
```

With the shell variable unset so `.env.local` is read (`env -u DATABASE_URL npm run db:whoami`):

```
DATABASE_URL (password never shown):
  host:     aws-0-ap-northeast-1.pooler.supabase.com
  port:     6543
  database: postgres
  project ref (from the username): lbmtlcdjjgfotzqpxswk

NEXT_PUBLIC_SUPABASE_URL project ref: lbmtlcdjjgfotzqpxswk

Consistent: both point at project "lbmtlcdjjgfotzqpxswk".
```

`whoami-db.ts` opens no connection, so this tells you which project `.env.local` names, not what is in it.

### The migration ledger: not obtained

The ledger is `app._migrations (name text primary key, applied_at timestamptz)`, written by `runMigrations()`
(`src/lib/db/client.ts`), matched by exact filename. I attempted a read-only `begin read only; select ...` and it failed at
connect (`timeout expired`). **Please run this on your machine against `lbmtlcdjjgfotzqpxswk`** (read-only; nothing here writes):

```sql
select name, applied_at from app._migrations order by name;

-- what the schema itself says, independent of the ledger
select to_regclass('public.deal_document')               is not null as has_deal_document,
       to_regclass('public.deal_document_entitlements')  is not null as has_session_4a,
       to_regclass('public.deal_introduction_register')  is not null as has_intro_view,
       to_regclass('public.platform_settings')           is not null as has_platform_settings,
       (select value from platform_settings where key = 'deal_room_enabled') as deal_room_enabled,
       (select count(*) from doc_type)                   as doc_types_seeded,
       (select count(*) from pg_policies where tablename = 'investor_organizations') as inv_org_policies;
```

Things the ledger will settle: whether `0033_ic_member_role`/`0034_opportunity_document_stage`/... (quirky's names) AND
`0033_investor_overview`/`0034_publication_document_ownership`/`0035_staff_role` (polish's names) are both present; whether
`0036_merged_status` (Emerald) is there (the merge of `b5c09009` into `0f4d3e03` implies it is, on whichever database you ran
it against); and whether `0037_pipeline_saved_views`, `0038_investor_org_no_self_read` or `0050_investor_mandates` (my unmerged
PRs) were ever applied.

### If the database really is at 0053 (b) - the code/DB skew

Two things follow directly from the repo, whichever way the Vercel question resolves:

- **"Convert to Asset" is broken for every opportunity created after `0050`.** Deployed polish writes
  `update opportunities set stage = 'acquired'` with no `stage_transition` clearance (polish `conversion.ts:139`). Migration
  `0048`/`0050` installs a trigger that refuses that unless `legacy_exempt` is true. `0050` set `legacy_exempt = true` only for
  rows that existed when it ran and defaults new rows to false. [static]
- **`0044_deal_introduction_register_view` leaks prospect names and emails to any signed-in session, investors included**
  (Phase 4, finding S1, reproduced on Postgres). If 0044 is applied, this is live in the database now, independent of what
  code is deployed.
- Also, **`investor_organizations` still has the own-row policy that exposes `notes` and `linked_internal_organization_id`
  to the investor it describes** (my PR #33 fixes it; unmerged and unapplied anywhere I can see).

---

## Phase 1 - Branch inventory

58 remote branches. Columns: last commit, author, date, subject; ahead/behind relative to polish (`d25d024`) and to quirky
(`3a62934`) in the form `+ahead/-behind`; what it does; state. Textual merge-ability was tested with `git merge-tree`
against both polish and quirky. [git]

Summary: **44 of the 58 are already merged into polish (history only, including polish itself); 8 are live, unmerged work;
6 are stale or archival (do not merge).** Quirky already contains polish's tip, so PR #31 is a clean forward merge.

| Branch | Last commit | Author | Date | Subject | vs polish (ahead/behind) | vs quirky (ahead/behind) | What it does | State |
|---|---|---|---|---|---|---|---|---|
| `claude/deal-seed-matcher-fixes` | `ac8dea8` | Claude | 2026-10-08 | Boundary test: find the INSERT's returning clause, not the UPDATE's | +2/-0 | +2/-16 | Deal-seed loader: closed history never written to; spelling/naming variants collide. No PR. 2 commits. | Clean. Not yet cleared to run the loader. |
| `claude/investor-contact-errors-and-delete` | `95b1f0f` | Claude | 2026-10-08 | Investor orgs: guarded delete, danger-zone panel, Never used tag | +2/-0 | +2/-16 | PR #34: duplicate-email contact errors inline; guarded delete of never-used investor orgs. | Open PR. Clean. |
| `claude/investor-mandates` | `199c2d5` | Claude | 2026-10-08 | Mandate tests: use the fixture email domain so the seeded-accounts cou | +2/-0 | +2/-16 | PR #35: staff-only investor mandates table (0050) and rule-based matching. | Open PR. Clean textually; migration number 0050 COLLIDES with quirky's 0050. |
| `claude/investor-org-column-leak` | `91bec31` | Claude | 2026-10-08 | Investor orgs: drop the investor own-row policy that leaked notes and  | +1/-0 | +1/-16 | PR #33: drop investors' own-row policy on investor_organizations (0038), fixing a notes/internal-id column leak. | Open PR. Clean. Security fix: not yet merged. |
| `claude/quirky-meitner-k4tokb` | `3a62934` | Claude | 2026-10-08 | Add CLAUDE.md and docs/29 handoff for session continuity | +16/-0 | +0/-0 | Deal document system: catalogue, club-deal investor model, gates, readiness/tracker UI, flag governance, capital-pipeline test import, Session 4a investor RLS (0033-0060), CLAUDE.md and handoff. PR #31 (open). | Open PR, GitHub reports mergeable/clean. Contains all of polish. NOT merged. |
| `feature/teaser-generator` | `4455847` | Claude | 2026-10-08 | Teaser Session 1: read-only audit of the data contract, reuse and gaps | +16/-0 | +1/-1 | Quirky tip (to 0060) plus ONE commit: docs/TEASER-AUDIT.md (Teaser Session 1, read-only). | Doc only. Behind quirky by 1 commit (CLAUDE.md + handoff). |
| `claude/emerald-duplicate-merge-proposal` | `9892cd6` | Claude | 2026-10-07 | Merged status (0036) and a reviewed, dry-run-by-default merge script f | +1/-0 | +1/-16 | 0036_merged_status (status 'merged' + pointer) and the reviewed one-off merge script for the Emerald duplicate. No PR. | Mergeable alone; textual conflict with pipeline-table-improvements in opportunity-pipeline.tsx. Migration applied on reiwa-dev per JD (merge executed). |
| `claude/pipeline-table-improvements` | `d26d499` | Claude | 2026-10-07 | Pipeline: remove a sold, withdrawn, lost or passed deal (archive, rest | +3/-0 | +3/-16 | PR #32: price/yield filters, sortable columns, saved views (0037), triage mode, remove/restore a deal. | Open PR. Conflicts with Emerald in opportunity-pipeline.tsx. |
| `feature/pipeline-import` | `ae6ac56` | JD Mooney | 2026-09-30 | Pipeline import: load Reiwa Capital deal pipeline into opportunities | +1/-123 | +1/-139 | Single commit: load the Reiwa Capital deal pipeline into opportunities (JD, 30 Sep). | STALE/superseded (polish has the deal-load branches); conflicts with polish in 1 file. |
| `claude/reiwa-os-audit-jdsfca` | `d36998a` | Claude | 2026-09-22 | Phase 0: cast the status parameter explicitly in the fixture insert | +5/-123 | +5/-139 | Phase 0 audit: collapse Deal into Opportunity, retheme, seed, docs rewrite (5 commits, 22 Sep). | STALE/superseded by Phase 0/1 work on polish; 75 conflicting files. |
| `claude/reiwa-deal-ingestion-n8ut39` | `70ca250` | JD Mooney | 2026-09-16 | Property timeline on the opportunity record, and Phase 1 record in doc | +8/-123 | +8/-139 | Deal Inbox ingestion: staging, mapping, review queue, property timeline (8 commits, JD, 16 Sep). | STALE/superseded (identity + deal-load landed on polish); 16 conflicting files. |
| `recovery/pre-p6-local-worktree` | `c830f28` | jdmooney1 | 2026-09-07 | Recovery: preserve pre-P6 local working tree | +1/-123 | +1/-139 | Preserved pre-P6 local working tree (1 commit, 7 Sep). | Snapshot only. Keep or delete; do not merge. |
| `archive/p0-cloud-bbc4116` | `bbc4116` | Claude | 2026-09-02 | P0: Supabase-native data/auth model (RLS via auth.uid), pg driver seam | +1/-131 | +1/-147 | P0: Supabase-native data/auth model (archived). | Archive. Do not merge. |
| `claude/jolly-sagan-e0fc3y` | `a454000` | Claude | 2026-09-02 | P0: convert backend to Supabase-native (PostgreSQL + Supabase Auth) | +1/-131 | +1/-147 | P0: convert backend to Supabase-native (2 Sep). | STALE/superseded by archive/p0 and later work. |
| `claude/investor-overview-publish-confirm` | `7760d23` | Claude | 2026-10-07 | Investor Overview is its own field; publishing goes through a review s | +0/-16 | +0/-32 | Investor Overview is its own field; publishing goes through a review screen | Merged into polish (history only) |
| `claude/investor-wording-and-fx` | `620209d` | Claude | 2026-10-07 | docs: correct the portfolio dashboard FX note | +0/-1 | +0/-17 | docs: correct the portfolio dashboard FX note | Merged into polish (history only) |
| `claude/publication-document-ownership` | `b780e1a` | Claude | 2026-10-07 | Each publication document owns its file: copy-on-draft, unique path, r | +0/-14 | +0/-30 | Each publication document owns its file: copy-on-draft, unique path, repair script | Merged into polish (history only) |
| `claude/publication-preview-matches-portal` | `5ac893f` | Claude | 2026-10-07 | The admin preview shows the figures the investor sees | +0/-12 | +0/-28 | The admin preview shows the figures the investor sees | Merged into polish (history only) |
| `claude/refresh-from-source-keeps-draft` | `7c087b7` | Claude | 2026-10-07 | Refresh from source keeps what a person wrote | +0/-12 | +0/-28 | Refresh from source keeps what a person wrote | Merged into polish (history only) |
| `claude/reiwa-os-phase-1b-product-polish` | `d25d024` | Claude | 2026-10-07 | Merge claude/investor-wording-and-fx into polish: standard figures lin | +0/-0 | +0/-16 | The GitHub default branch and the target of every PR. Last Vercel Production deploy was an older commit (see Phase 0). | Reference branch (tip d25d024) |
| `claude/staff-role-boundary` | `057de9e` | Claude | 2026-10-07 | Revoke PUBLIC and anon execute on app.is_staff() | +0/-6 | +0/-22 | Revoke PUBLIC and anon execute on app.is_staff() | Merged into polish (history only) |
| `claude/deal-seed-schema` | `869eabb` | Claude | 2026-10-06 | Deal seed: schema for broker-IM facts, and a one-off loader that lands | +0/-18 | +0/-34 | PR #30: Deal seed: schema for broker-IM facts, and a one-off loader that lands structured deals as | Merged into polish (history only) |
| `claude/fix-memos-test-ordering` | `18fb047` | Claude | 2026-10-06 | memos test: order the whitelist query so it picks the same opportunity | +0/-20 | +0/-36 | PR #29: memos test: order the whitelist query so it picks the same opportunity on every database | Merged into polish (history only) |
| `claude/memo-ai-review` | `46b3ab5` | JD Mooney | 2026-10-06 | Memo review: an optional pre-finalisation check that writes nothing an | +0/-27 | +0/-43 | PR #27: Pre-finalisation AI review: advisory flags on a draft memo, logged per run | Merged into polish (history only) |
| `claude/memo-ja-translation` | `1fb4e44` | Claude | 2026-10-06 | Japanese translation of the Investor Teaser: a model drafts, a person  | +0/-22 | +0/-38 | PR #28: Japanese translation of the Investor Teaser: a model drafts, a person accepts each section | Merged into polish (history only) |
| `claude/prospect-deal-share` | `47850f0` | Claude | 2026-10-06 | Prospect page: remove the on-screen compliance disclaimer | +0/-29 | +0/-45 | PR #25: Prospect page: remove the on-screen compliance disclaimer | Merged into polish (history only) |
| `claude/test-helper-windows-paths` | `2946558` | JD Mooney | 2026-10-06 | Tests: make the source-reading boundary tests actually read their file | +0/-27 | +0/-43 | PR #26: Test helpers: read and path logic that works on Windows | Merged into polish (history only) |
| `claude/asset-snapshot-phase1` | `5adda7c` | Claude | 2026-10-05 | Merge polish (with #20, FX rate lock) into asset-snapshot-phase1 | +0/-38 | +0/-54 | PR #21: Asset Snapshot, phase 1: the one-page data sheet from real fields | Merged into polish (history only) |
| `claude/asset-snapshot-phase2` | `624c83f` | Claude | 2026-10-05 | Merge polish (with #20 and #21) into asset-snapshot-phase2 | +0/-35 | +0/-51 | PR #22: Asset Snapshot, phase 2: land / building value and the depreciation basis (stacked on #21) | Merged into polish (history only) |
| `claude/fx-auto-pull-rate-lock` | `b181693` | Claude | 2026-10-05 | FX: daily ECB auto-pull, and lock the rate at IC approval | +0/-41 | +0/-57 | PR #20: FX: daily ECB auto-pull, and lock the rate at IC approval | Merged into polish (history only) |
| `claude/fx-rates-admin` | `9beb614` | Claude | 2026-10-05 | Merge polish into fx-rates-admin | +0/-43 | +0/-59 | PR #19: FX rates: admin-maintained with required source and 30-day staleness flag (stacked on #17) | Merged into polish (history only) |
| `claude/investment-score` | `2a7bfbc` | Claude | 2026-10-05 | Merge polish into investment-score | +0/-46 | +0/-62 | PR #18: Investment Score: persistence, Score tab, memo Recommendation (stacked on #17) | Merged into polish (history only) |
| `claude/memo-generator-teaser` | `3cd88c2` | Claude | 2026-10-05 | Merge polish into memo-generator-teaser | +0/-49 | +0/-65 | PR #17: Investment memo generator, phase 1 (Investor Teaser first) | Merged into polish (history only) |
| `claude/snapshot-photo-freeze-map` | `eb19021` | Claude | 2026-10-05 | Asset Snapshot: freeze the pictures at finalisation, and add a map by  | +0/-33 | +0/-49 | PR #23: Asset Snapshot: freeze the pictures at finalisation, and add a map by upload | Merged into polish (history only) |
| `claude/asset-photos-phase1` | `ce55d50` | Claude | 2026-10-01 | Photos: drop the standard tier, visibility is internal or diligence on | +0/-70 | +0/-86 | PR #12: Asset photos, Phase 1: staff-only headline and gallery | Merged into polish (history only) |
| `claude/dd-row-affordance` | `0e87ee7` | Claude | 2026-10-01 | Diligence: make the DD row visibly clickable | +0/-71 | +0/-87 | PR #10: Diligence: make the DD row visibly clickable | Merged into polish (history only) |
| `claude/photo-fit-dragdrop` | `b6a9087` | Claude | 2026-10-01 | Photos: show the headline uncropped; drag-and-drop for photo and docum | +0/-64 | +0/-80 | PR #15: Photos: headline shown uncropped; drag-and-drop for photo and document uploads | Merged into polish (history only) |
| `claude/photos-investor-read` | `73ab622` | Claude | 2026-10-01 | privileges test: name the SECURITY DEFINER functions (incl. the three  | +0/-59 | +0/-75 | PR #14: Photos Phase 2, Part B: diligence-tier photographs for investors | Merged into polish (history only) |
| `claude/photos-reencode-thumbs` | `2a6663f` | Claude | 2026-10-01 | Photos: re-encode every upload on the server, add thumbnails | +0/-64 | +0/-80 | PR #13: Photos Phase 2, Part A: server-side re-encode and thumbnails | Merged into polish (history only) |
| `claude/privilege-guard-functions` | `49065e0` | Claude | 2026-10-01 | Merge polish into claude/privilege-guard-functions | +0/-54 | +0/-70 | PR #16: Privileges: withdraw EXECUTE from the two trigger guard functions | Merged into polish (history only) |
| `claude/underwriting-auto-calc` | `cd40c92` | Claude | 2026-10-01 | Underwriting: fill derived fields when empty, warn when figures disagr | +0/-71 | +0/-87 | PR #11: Underwriting: auto-calc derived fields and reconciliation warnings | Merged into polish (history only) |
| `claude/pipeline-triage-filters` | `7ea1ca1` | Claude | 2026-09-30 | Pipeline: expose triage status and filter the view | +0/-85 | +0/-101 | Pipeline: expose triage status and filter the view | Merged into polish (history only) |
| `claude/reiwa-investor-location` | `253bdfb` | Claude | 2026-09-30 | Investor portal: show the location pin to diligence-tier entitlements  | +0/-80 | +0/-96 | PR #9: Phase C2: investor map, diligence tier only (stacked on Phase C1) | Merged into polish (history only) |
| `claude/reiwa-property-geocoding` | `d08f3ca` | Claude | 2026-09-30 | Geocoding: geocoded data expires after 30 days | +0/-84 | +0/-100 | PR #6: Phase A: geocode properties (migration 0016, db:geocode-properties) | Merged into polish (history only) |
| `claude/reiwa-property-map` | `ac443fa` | Claude | 2026-09-30 | Workspace map: do not show a geocode older than 30 days | +0/-81 | +0/-97 | PR #7: Phase C1: internal workspace map (stacked on Phase A) | Merged into polish (history only) |
| `claude/reiwa-property-photos` | `7eda06e` | Claude | 2026-09-30 | Street View: remember the panorama, fetch the picture live, never stor | +0/-80 | +0/-96 | PR #8: Phase B: Street View photo via live proxy, pano_id only (stacked on Phase C1) | Merged into polish (history only) |
| `claude/reiwa-deal-load` | `1443b69` | JD Mooney | 2026-09-28 | Phase B: load the 132-deal pipeline, untriaged | +0/-91 | +0/-107 | PR #4: Phase B: load the 132-deal pipeline, untriaged | Merged into polish (history only); its PR (#3/#4/#5) is still OPEN against a stacked base |
| `claude/reiwa-gmail-threads` | `c183107` | JD Mooney | 2026-09-28 | Phase C: link broker email threads to opportunities, many-to-many | +0/-90 | +0/-106 | PR #5: Phase C: link broker email threads to opportunities, many-to-many | Merged into polish (history only); its PR (#3/#4/#5) is still OPEN against a stacked base |
| `claude/reiwa-property-identity-normalisation` | `39cda74` | JD Mooney | 2026-09-28 | Property identity: read St as Saint, accept a trailing house number, d | +0/-92 | +0/-108 | PR #3: Property identity: read St as Saint, accept a trailing house number, drop postcode from th | Merged into polish (history only); its PR (#3/#4/#5) is still OPEN against a stacked base |
| `claude/reiwa-os-phase-1b-hardening-audit` | `2658489` | Claude | 2026-09-16 | A refusal you can act on stays on the screen | +0/-95 | +0/-111 | A refusal you can act on stays on the screen | Merged into polish (history only) |
| `claude/reiwa-property-identity` | `8c96713` | JD Mooney | 2026-09-16 | Property identity: one building, one record, one history | +0/-93 | +0/-109 | PR #2: Phase A: property identity and the D1 duplicate-property fix | Merged into polish (history only) |
| `claude/reiwa-os-phase-0-demolition` | `3478974` | Claude | 2026-09-15 | Docs: align Reiwa OS with canonical lifecycle | +0/-105 | +0/-121 | Docs: align Reiwa OS with canonical lifecycle | Merged into polish (history only) |
| `claude/reiwa-os-phase-1a-opportunity-foundation` | `32e77b6` | Claude | 2026-09-15 | Require authorship; log the publication-provenance finding | +0/-102 | +0/-118 | Require authorship; log the publication-provenance finding | Merged into polish (history only) |
| `claude/reiwa-os-phase-1b-opportunity-workspace` | `38b58cf` | Claude | 2026-09-15 | Close the operator half of the destructive-reset gap | +0/-97 | +0/-113 | Close the operator half of the destructive-reset gap | Merged into polish (history only) |
| `claude/p6-launch-hardening` | `319a2b5` | Claude | 2026-09-10 | Admin: add secure investor invitation email workflow | +0/-107 | +0/-123 | Admin: add secure investor invitation email workflow | Merged into polish (history only) |
| `claude/reiwa-os-architecture-2m1vc9` | `2f0b55e` | jdmooney1 | 2026-09-06 | P5: investor engagement & commercial intelligence | +0/-123 | +0/-139 | P5: investor engagement & commercial intelligence | Merged into polish (history only) |
| `claude/relaxed-goodall-ib6020` | `fdedcc2` | Claude | 2026-09-03 | P3: investor access & authentication | +0/-126 | +0/-142 | PR #1: Add P2: Investment Portal admin surface for publication workflow | Merged into polish (history only) |
| `backup/pglite-gate-1da88a8` | `1da88a8` | Claude | 2026-08-27 | Persistence gate: live DB, auth, RLS, opportunity→asset lifecycle | +0/-131 | +0/-147 | Persistence gate: live DB, auth, RLS, opportunity→asset lifecycle | Merged into polish (history only) |


### File-level overlap between currently-unmerged branches

Method: each branch's changed files against its merge-base with polish; teaser counted only for what it adds over quirky. [git]
Pairwise `git merge-tree` of all seven non-teaser active branches against each other: **one textual conflict.**

| File | Touched by | Conflict risk |
|---|---|---|
| `src/components/opportunities/opportunity-pipeline.tsx` | Emerald, PR #32 | **Real textual conflict** (progress line vs the new table/sort/triage/removal code). Resolve by merging one first; the Emerald side is small. |
| `src/lib/data/opportunities.ts`, `src/lib/data/opportunity-types.ts`, `src/lib/workspace/labels.ts` | quirky, Emerald | Merge cleanly (git), but **semantically** both extend the opportunity status/flags model: Emerald adds the `merged` status and a pointer column; quirky adds `legacy_exempt`, `document_stage`, flags and invariant triggers (I3 refuses forward clearance on any status other than `active`). Neither touches the other's constraint (checked), but both need a combined test run. |
| `src/components/workspace/workspace-header.tsx` | quirky, PR #32 | Clean merge; PR #32 adds the Remove control, quirky adds readiness/investor badges. Low. |
| `src/app/(app)/admin/investors/[investorOrgId]/page.tsx` | PR #34, PR #35 | Clean merge (adjacent hunks). Low. |
| `tests/investor-rls.test.ts` | quirky, PR #33 | Clean merge; PR #33 replaces a test that quirky's list also edits. Low, but run both after merging. |
| `tests/unit/deal-seed-boundaries.test.ts` | PR #32, deal-seed-matcher-fixes | Clean merge (different hunks). Low. |
| `CLAUDE.md`, `docs/29-handoff.md` | quirky, teaser | Teaser lacks quirky's last commit. Trivial. |

### The migration-number collisions (partly my doing)

Same numeric prefix, different filenames, across branches. The runner keys on the full filename, so duplicates *apply*,
but ordering is alphabetical and the repo's own rule is to avoid this (docs/24 section 12 records the last incident).

| Prefix | Quirky | Another branch |
|---|---|---|
| 0033 / 0034 / 0035 | `ic_member_role` / `opportunity_document_stage` / `doc_type_catalogue` | polish: `investor_overview` / `publication_document_ownership` / `staff_role` (reconciled by `0053`) |
| 0036 | `doc_type_audit` | Emerald: `merged_status` |
| 0037 | `deal_counterparties` | PR #32: `pipeline_saved_views` |
| 0038 | `deal_investor` | PR #33: `investor_org_no_self_read` |
| **0050** | `opportunity_legacy_exempt` | PR #35: `investor_mandates` (I chose 0050 after seeing quirky only to 0049; it has since grown to 0060) |

None of the colliding SQL touches the same objects, except that **every one of these is a new risk** under CLAUDE.md's "never
rename an applied migration" rule: any of mine that was already applied (Emerald's `0036`, at least, was applied somewhere
because the merge ran) cannot be renumbered. Documentation numbers collide the same way (`docs/24-*` twice, `docs/28-*`,
`docs/29-*` on quirky and on my branches). CLAUDE.md's statement "no other migration should be numbered below 0061" cannot
be honoured as written.

Also: **PRs #3, #4, #5 are still open** against stacked base branches whose content is already in polish (cleanup only).
**There is no CI: the repository has 0 GitHub Actions workflows; the only status check on any commit is Vercel's build.** [GH]

---

## Phase 2 - The handoff's "what is built", claim by claim

Verdicts: CONFIRMED, PARTIALLY TRUE, NOT TRUE. Evidence is `file:line` on the quirky tip. Rows marked "[agent+me]" were read by
a reading agent and then spot-checked by me; rows marked "[PG]" were executed.

### 2.1 Claims in docs/29 section 1

| # | Claim | Verdict | What is actually there |
|---|---|---|---|
| 1 | Document catalogue `doc_type`, audited, admin/IC-writable | **PARTIALLY TRUE** | Table, audit trigger and write policy exist (`0035:31-112`, `0036:39-79`). **No migration inserts any doc type.** The 42-row catalogue is loaded only by `npm run db:seed-doc-types` (`src/lib/db/seed-doc-types.ts:204`); a fresh `db:migrate` yields an empty catalogue, and with an empty catalogue every 0047 auto-create trigger creates nothing. [PG: 42 created after the script]. Also **readable by every authenticated session including investors** (`using (true)`, `0035:106-108`), contrary to docs/24 section 5 ("staff"). The audit table is the same. Not mentioned in CLAUDE.md or docs/29; only docs/28:75. |
| 2 | Club-deal model: `deal_investor`, `deal_counterparties` | **CONFIRMED (counterparties schema-only)** | `deal_investor` with nine funnel statuses, status log, first-introduced protections (`0038`). `deal_counterparties` (`0037`) exists but **nothing in `src/` reads or writes it** and no UI. `originating_share_id` is accepted by the data function but never passed by the action. |
| 3 | `deal_document`/`document_version` with stage gates and overrides; invariants I1-I7 | **PARTIALLY TRUE** | I1 (`0048`, `0050`), I2-I4 (`0045`), I5-I6 (`0041`), I7 (`0046`) are all real triggers/CHECKs/RLS. Gaps: I1 has a **`legacy_exempt` exemption for every pre-0050 opportunity** (the handoff does not say so); I4 is BEFORE UPDATE only (an INSERT with `document_stage = 4` is unchecked); **nothing in the application ever sets `document_version.locked_at`**, so the "immutable once final" guard (`0040:252-272`) never engages and docs/24 section 7's "immutability-on-final" is inert; no code in `src/` inserts a `document_version` at all. docs/24 sections 3, 3.1 and 12 still say I1 "is not yet enforced" - stale. |
| 4 | "The gate evaluator" | **PARTIALLY TRUE** | Pure functions in `src/lib/deal-gates/evaluate.ts`; `evaluateStageExit` is wired to stage transitions, the readiness summary and Convert to Asset. **`evaluateActionGate` and `checkActionGate` have no caller**, and `convertToAssetAction` has no UI caller (the override-reason conversion path is unreachable from the UI). See 2.2 for drift against the database. |
| 5 | Readiness UI and investor tracker | **CONFIRMED** | Routed pages under `.../readiness` and `.../investors`, linked from the workspace nav (`workspace-nav.tsx:60-64`), reading real data. No UI exists for: uploading/creating a document version, setting `linked_dd_item_id`, editing flags, `originating_share_id`, or rendering the introduction register or counterparties. |
| 6 | Document view logging "(schema only at that point)" | **PARTIALLY TRUE (stale)** | One writer now exists (`recordDealDocumentViewed`, `secure-delivery.ts:223-239`, `action='download'` only, errors swallowed). No portal UI lists deal-document versions, and nothing creates `document_version` rows, so in practice no row is writable today. |
| 7 | DD-item <-> document linking | **PARTIALLY TRUE** | Trigger and unique index are real (`0043`). No UI (`grep linked_dd_item src` finds nothing). |
| 8 | Introduction register | **PARTIALLY TRUE, and unsafe** | `first_introduced_at` protections are real (`0038`). The prospect view (`0044`) **leaks** (finding S1, reproduced). The only test queries it as admin. |
| 9 | Auto-created deal documents per stage/investor "(0047 and the 0050 legacy exemption)" | **PARTIALLY TRUE** | Triggers are real (`0047`, merged-flags version in `0051`). **`0050` has nothing to do with auto-creation** (it is the I1 exemption). Rows are created only on a `document_stage` change or an investor insert/status change: **no backfill for existing opportunities and nothing re-evaluates when a flag changes** (see D1). docs/24 section 12's "not when the investor's own status funnel moves" contradicts the code. |
| 10 | Flag governance: audited flag edits, admin+reason gate on turning `regulated_disclosure` off, `platform_settings` staff allowlist | **CONFIRMED, with dead code** | Audit tables/triggers and the gate are real (`0052`). `updateOpportunityFlags` and `updateDealInvestorFlags` **have no callers**: there is no way to edit flags from the app. The allowlist is `reiwa_admin, org_user, ic_member, investor_viewer` - **`reiwa_staff` is excluded**, so a `reiwa_staff` session reads no platform settings and the gate logic treats `regulated_disclosure` as off (finding D5). |
| 11 | Capital pipeline test import, ~78 rows, tagged, removable | **PARTIALLY TRUE** | Both scripts exist, dry-run by default, `--write` to commit, per-row removal checks five FK tables. But: **no guard against running on a non-test database** (only `requireEnv()`; it writes to whatever `DATABASE_URL` is); import is not transactional and `lower(name)` is unique, so a clash with a real investor org aborts mid-run; "~78" is only a comment; and CLAUDE.md itself says the source data is real confidential material, so "test data" is a label, not a property. No unit test covers either script. I did not open `imports/`. |
| 12 | `0053` role-constraint reconciliation | **CONFIRMED** | Re-asserts all five roles (`0053:21-24`); `GlobalRole` type has all five. Cosmetic: the sidebar role label map lacks `ic_member`. |
| 13 | Session 4a (0054-0060) components | **CONFIRMED** | Entitlements sibling table, flag seeded off, `underwriting_model` excluded by key (`0056:37`), NDA/teaser exemption (`0056:63-71`), Final/Signed + reviewed-JA rule (`0056:101-111`), 0058 gates, 0059 manual override, 0060 cumulative sync reusing `investor_status_rank` - all present. Caveats: 0058 is BEFORE UPDATE only (an INSERT with `status='nda_signed'` bypasses it); the 0058 override path cannot be satisfied by the app (D8). |
| 14 | Teaser Session 1 audit | **CONFIRMED** | See Phase 3. |

### 2.2 Does the TypeScript gate logic match what the database enforces?

**Mostly the vocabulary matches; enforcement has drifted in both directions.** [agent, spot-checked: D2, D7 (from live test
errors) and D10 confirmed by me; the rest are static reads.] Enumerations match exactly: `deal_document.status` (9),
`deal_investor.status` (9), gate kind/scope/stage, flag precedence (platform < deal < investor), conditions
`geared`/`hedged`/`jurisdiction:X`/`investor_type:X`/`regulated_disclosure`.

| # | Drift | Direction | Effect |
|---|---|---|---|
| D1 | Applicability is evaluated live in TS but rows are created only at stage/status change | TS stricter | A deal that later becomes `geared`/`hedged`/UK, or a platform `regulated_disclosure` switch-on, shows a blocking document that has **no row to clear**; only an override can move the stage. Legacy opportunities have no auto-created rows at all (no backfill), so e.g. Stage 0 can report `screening_memo` blocking with nothing to mark Final. (the last is inferred; the `workspace.test` fixture shows `readinessOpen: 1` for a brand-new opportunity [PG]). |
| D2 | `requires_ic_decision` is a no-op in TS `conditionHolds` and in `doc_type_applies`; Convert to Asset evaluates only Stage 3 gates | DB stricter | A non-exempt deal at `approved` with no IC decision and all docs Final passes the TS check and writes the clearance; the DB's I2 then raises a raw error, even under override. `convertToAsset` is not wrapped, so the user sees the raw message. |
| D3 | I3 (forward move needs `status = 'active'`) has no TS check; an `org_user` typing an override reason is not stopped in TS | DB stricter | Misleading generic message ("check your role") or the error boundary. `run-action` maps only SQLSTATE P0001; RLS refusals are 42501 (inferred). |
| D4 | `sanctions_screening_vendor` is a counterparty-scoped Stage 2 transition gate | catalogue only | No code creates counterparty rows or evaluates counterparty scope: it gates nothing. |
| D5 | `reiwa_staff` cannot read `platform_settings`, so `regulated_disclosure` reads as off in both the TS evaluator and `doc_type_applies` | both | A staff user can see no `jp_pre_contract_disclosure` blocker and advance a stage that admins cannot. |
| D6 | Stage-2/3 TS rules use `final or signed`; 0058 demands exactly `signed` for the NDA and exactly `final` for the IOI | DB stricter | Mark the NDA `final` (accepted by the TS action gate) then move the investor to `nda_signed`: the database raises. Confirmed in practice by the failing tests below. `updateDealInvestorStatus` is a bare UPDATE with no pre-check and no `ruleMessage`. |
| D7 | Action-gate override is recorded in a separate transaction; `0046` and `0058` require the override in the **same** transaction as the guarded write | design gap | The pre-logged override can never authorise the write. Latent (no UI yet); it will bite when 4c's override UI is built. |
| D8 | Stage 4 is unreachable: `convertToAsset` writes the clearance but never sets `document_stage = 4`, and `transitionDocumentStage` refuses 4 | both | Stage 4 documents are never created; comments claim otherwise. [confirmed: the only writer of `document_stage` is `deal-gates.ts:147`] |
| D9 | `readinessSummary` counts gate types without applying `conditionHolds`; declined investors count in the action-gate branch; DB casts flags to boolean so the string "true" passes in SQL but not in TS | minor | Over-optimistic "N of M" counts; edge-case inconsistencies. |

### 2.3 Session 4a: is `deal_room_enabled` genuinely off, and does it gate everything?

**Yes on both counts, with one qualification.** [static for the full code-path survey; PG for behaviour]
- Seeded `false` (`0055:21-23`); [PG] the fresh database has `deal_room_enabled = false`. The only writers anywhere are that seed
  and the integration test's own helper (test database only). No application code, script or UI sets it true.
- The only reader is `app.deal_room_enabled()`: SECURITY DEFINER, empty `search_path`, **fails closed**
  (`coalesce(value = 'true'::jsonb, false)`). [PG] With the flag set to the JSON *string* `"true"`, or the row deleted, an
  investor with a valid entitlement sees 0 rows; with the flag off, 0 rows; with it on, only the matched investor's rows (a
  second, unmatched investor saw 0).
- Every investor-reachable deal-document surface consults it, through the shared function (`deal_document` select,
  `document_version` select via nesting, the view-log insert policy, the portal download route via RLS). I found no
  `adminQuery`/privileged-connection read of those tables on any investor path. The 0060 entitlement sync is safe with
  respect to the flag (rows are inert while it is off).
- **Qualification:** `platform_settings` writes are open to any `reiwa_admin` and **leave no audit trail** (the 0052 governance
  covers only `regulated_disclosure`), so turning the room on is currently a silent, unlogged act. Also the flag is the *only*
  thing between the findings in Phase 4 (S2, S3) and exposure; it is a sound kill switch, not a substitute for fixing them.
- Production: per CLAUDE.md `0054-0060` are not applied there, so no investor deal-document access exists in production
  (unverified, see Phase 0).

### 2.4 Test results on `claude/quirky-meitner-k4tokb`

**Environment:** this sandbox has no `TEST_DATABASE_URL`/`TEST_SUPABASE_*`, so the repo's own integration harness refuses to run
(by design, `tests/global-setup.ts`). I ran the integration files through my own vitest configuration against a **throwaway local
PostgreSQL 16 with a local auth stand-in**, built fresh from this branch's 63 migrations plus the base seed. This is real
Postgres (real RLS, triggers, constraints) but not real Supabase: no Storage, no PostgREST, a shimmed `auth` schema and role
set, and `pg_trgm` installed in `public`. Failures that are artefacts of that are labelled.

| Check | Result |
|---|---|
| Migrations from empty | **All 63 apply cleanly**, 0033-0060 included |
| `tsc --noEmit` | clean |
| `next lint` | no warnings or errors |
| `next build` | compiles successfully |
| Unit suite (`vitest.unit.config.mts`) | **63 files, 1296 tests: 1296 passed, 0 failed, 0 skipped** (matches the handoff's number) |
| Integration, one run of the whole suite | **44 files, 836 tests: 812 passed, 24 failed, 0 skipped** (11 files with failures) |
| Integration, the 6 suspicious files re-run alone on a fresh database each | see below |

Of the 24 failures:

| File | Fails (full run / alone) | Cause | Pre-existing or expected green? |
|---|---|---|---|
| `deal-document-foundation` | 7 + a file-level error / 7 + 1 | Six Session 3 tests move an investor to `ioi_received` without the IOI being Final, which 0058 (Session 4a) now refuses; one sets `document_stage` 0 -> 3 straight after inserting stepwise clearances, which 0045 refuses; and `afterAll` deletes opportunities that have an Approved case, which is immutable. | **Should be green; not pre-existing.** Never run before, and Session 4a broke Session 3's own tests. Test bugs, not (necessarily) product bugs. |
| `deal-document-investor-access` | 2 / 2 | The two 0060 sync tests set `nda_signed` directly; 0058 refuses without a signed NDA. **23 of 25 pass, including every RLS and flag test.** | **Should be green.** Net effect: the 0060 cumulative-sync behaviour has no passing automated proof (I exercised it by hand: nda_signed granted 3 entitlements [PG]). |
| `privileges` | 5 / 5 | 4 are new: the privilege-matrix test has not been updated for the ~37 new functions ("no unreviewed function exists"), and **24 new trigger/guard functions in `app` hold EXECUTE for PUBLIC/anon** (the same hardening PR #16 did for the earlier two). Not callable as RPC (`app` is not an exposed schema; trigger functions cannot be called directly), but it is exactly what the repo's own test exists to catch. The 5th is the `pg_trgm`-in-`public` artefact. | 4 new, should be green; 1 pre-existing/environmental |
| `investor-rls` | 3 / 1 | Alone: the same 24-function PUBLIC-execute list. In the full run two more failed only because earlier files left `deal_investor` links behind (see below). | 1 real; 2 order-dependence |
| `staff-role`, `admin-access` | 1 each / **0** | Pass alone, fail in the full run: leftover `deal_investor` links make `reiwa_staff` (via `0049`) legitimately see 15 investor organisations. | **Order-dependent tests.** Also a design contradiction, finding S5. |
| `workspace`, `connection-resilience`, `property-identity`, `staff-directory`, `lifecycle` | 1 each | `workspace`: the expected `counts` object is stale (keys `ddOverdue`, `investors`, `readinessOpen` added). `connection-resilience`: needs the `TEST_*` environment. `property-identity`, `staff-directory`: known local-shim artefacts. `lifecycle` "same file per asset": the known flaky test. | **Pre-existing** (the same set fails on polish) |

Honest bottom line: of 24, **6 are pre-existing/environmental, 14 are real defects in tests or hygiene (not demonstrated
product defects), and 4 are order effects** (they pass when the file runs alone). None of the *RLS behaviour* tests for Session 4a failed. But
"the integration suite has never been run" is true, and when it is run, **the suite is red: the branch cannot be called
verified.** There is also no CI to run it (0 workflows).

## Phase 3 - Teaser / snapshot feature

`feature/teaser-generator` (`4455847`, 2026-10-08 02:23 UTC) is quirky at `30ee7ff` (Session 4a + `0060`) plus **one commit: `docs/TEASER-AUDIT.md`.**
Nothing else has moved. It has no PR. It is one commit behind quirky: it lacks `CLAUDE.md` and `docs/29-handoff.md` (added to quirky
afterwards), while quirky's `CLAUDE.md` names `docs/TEASER-AUDIT.md` as required reading although that file is **not on
quirky**. Merge teaser into quirky, or move the audit file, before the reading list works. [git]

**The audit's factual claims hold up.** I re-checked them: there is no PDF/Chromium dependency (Playwright is a devDependency
only; nothing in `src/` renders server-side) - confirmed; `memo` format `"teaser"` is an audience filter with no anonymisation
(`sections.ts:57,77`; `compose.ts` has no redaction step) - confirmed; no completion-year, NLA, land-area, zoning, WOZ,
rateable-value or tenant-count column exists anywhere in the migrations - confirmed; `units.ts` has `sqmToTsubo`/`areaFrom`
(`SQM_PER_TSUBO = 3.30578`), `fx.ts` has `convertViaGbp` - confirmed; the brand-colour table is accurate (surface is `#F3EFE7`,
ink `#271430`; none of `#FCFAF1`, `#110A1A`, `#F5CAE0`, `#E89BBF` appears in `src/` or `tailwind.config.ts`).

### The six open questions

| # | Question | Answer |
|---|---|---|
| 1 | Render hosting: standalone service vs Vercel serverless Chromium | **Needs JD (infrastructure/cost, and who operates a second deployable).** Engineering facts: the repo has no render dependency today; the audit's recommendation (separate always-on render service, embedded fonts) is sound for dense CJK PDFs; Vercel serverless is feasible only for light output. It also gates the whole Session 6 generator, not just the teaser. |
| 2 | The four unconfirmed brand hex values | **Needs JD / the brand guide.** I verified only that they are absent from the app. Nothing in the repo can settle which are real. |
| 3 | Has `opportunities.size_sqft/size_sqm` always meant GFA? | **Needs JD (data semantics).** Nothing in code defines it: the loader reads a field called `size_sq_ft` from broker IMs, which quote GIA, NIA or GFA inconsistently, and no column or comment says which. Engineering cannot infer it; sampling the real records and the source IMs can. |
| 4 | Is `opportunities.reference` safe as the blind code name? | **Engineering answer: NO, for every loader-created deal.** `seedReference()` builds it from the building name (`src/lib/ingestion/deal-seed.ts:90-93`: `SEED-` + upper-cased slug of the name, e.g. `SEED-EMERALD-THEATRE-COVENT-GARDEN`). The audit's premise ("reference strings carry no address/building-name component today") is true only for hand-entered references. A blind teaser needs its own opaque code (a new column or generated id). The named Asset Snapshot already prints `Ref <reference>` (`asset-snapshot.tsx`), which is fine for a named document and would be a leak on a blind one. |
| 5 | Transport as a paragraph vs a structured station/line/minutes list | **Needs JD (product).** The brief's table implies structured; the schema has one text column. Cost difference is small (one JSON column plus an editor); the choice is about how much editing effort per deal you want to impose. |
| 6 | Migration number `0061` | **Engineering: still free** (highest on any remote branch is `0060`; none of my branches uses `0061`). Caveat: the audit's premise that polish "tops out at 0035" is stale: unmerged PRs now add `0036`-`0038` and `0050` on the polish line (see the collision table), so "0061" is clear but "nothing below 0061" cannot be enforced. |

---

## Phase 4 - Security pass on investor-facing data

Method: (1) catalog scan of the migrated database; (2) the same fixtures as the Session 4a integration tests, written as SQL, with
the investor identity presented exactly as the application does (`set role authenticated` + a JWT claim containing only the
Supabase user id); (3) for every table and view in `public`, a loop that counts rows readable by an investor session with the
room on and fixtures present; (4) reading the policies. All executed on the local Postgres, flag toggled on only inside that
throwaway database. [PG]

**Baseline facts.** All 60 `public` tables have RLS enabled. No table grants anything to `anon` or `PUBLIC`. There are two views:
`investor_feed` (`security_invoker = true`, correct) and `deal_introduction_register` (not; see S1). Two policies are `using (true)`:
`doc_type_select` and `doc_type_audit_select` (S7).

**Everything an investor session can read at least one row of** (flag on, fixtures present): `deal_document`, `document_version`,
`deal_introduction_register`, `doc_type`, `doc_type_audit`, `investor_organizations`, `investor_contacts`, `investor_saved`,
`investor_feed`, `investor_publications`, `publication_versions`, `publication_documents`, `publication_entitlements`. Writes: own
`investor_saved`, `investor_activity_events`, `investor_requests`, and (0057) own `document_view_log`.

### Findings, most serious first

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| **S1** | **HIGH** (live in the database if `0044` is applied) | **`deal_introduction_register` leaks every prospect's name and email to any signed-in session.** The view has no `security_invoker`, so it runs as its owner (`postgres`, bypasses RLS) while the base tables `deal_shares`/`deal_share_views` are admin-only; the 0044 header wrongly says views expand against the invoker's RLS. Granted `select` to `authenticated`, so it reaches investors and any internal user, across organisations. The only test queries it as admin. | [PG] With one prospect share inserted: an investor session read `ZZ Prospect Name / zz.prospect@example.invalid` from the view while `select count(*) from deal_shares` returned 0 for the same session; an `investor_viewer` with no organisation read it too. Exploitable by a direct SQL/PostgREST caller; whether PostgREST exposes `public` here is not determinable (Supabase does by default; docs/11 describes PostgREST enforcing the same policies). |
| **S2** | **HIGH once `deal_room_enabled` is on**; none while off | **Column leak on `deal_document` and `document_version`: the same class of bug found on `investor_organizations`.** The investor policies are row-level and the grants are table-wide, so an investor who may read a row reads every column. | [PG] With the room on, the matched investor read, from `deal_document`: `notes` ("SECRET-INTERNAL-NOTE-TEASER"), `fee_estimate` (12345), `provider`, and non-null `owner_user_id`, `org_id`, `opportunity_id`, `created_by`; from `document_version`: `file_url` (storage path) and **`generated_from_snapshot` (returned `{"vendor": "SECRET-VENDOR-NAME", "price": "SECRET-PRICE"}`)**. That last column is designed to hold the source data a teaser was generated from, so once Session 6 generates documents it will hold exactly what the blind teaser exists to hide. Also violates 0005's own invariant (no internal Reiwa OS identifier on an investor-readable row). Flag off: 0 rows [PG]. A different investor not matched to the deal: 0 rows [PG]. |
| **S3** | **MEDIUM, live today** (polish-level, unmerged fix) | **`investor_organizations` still exposes `notes` and `linked_internal_organization_id` to the investor it describes.** Also eight internal staff-profile-id columns sit on investor-readable rows: `investor_publications.created_by`, `publication_versions.created_by/published_by/submitted_by`, `publication_documents.created_by`, `publication_entitlements.granted_by`, `investor_requests.handled_by`. | [PG] the investor session reads 1 `investor_organizations` row on this tree; fix is PR #33 (unmerged, unapplied anywhere I can see). The profile-id columns are listed in PR #33's description; they need a view-based read path, not a policy. |
| **S4** | MEDIUM | **The `0060` trigger silently re-grants revoked entitlements.** It fires on every insert/update of `deal_investor` and upserts `is_visible = true`, so hiding a document from an investor is undone by any later edit of that investor's row. | [PG] After `nda_signed`, 3 entitlements were granted; one was hidden; an unrelated edit (`investor_type`) left `hidden = 0`. |
| **S5** | MEDIUM, a design contradiction | **`reiwa_staff` can read `investor_organizations` (whole row) for investor orgs linked via `deal_investor` to organisations they belong to (`0049`).** docs/26 and `staff-role.test.ts` say staff see nothing in investor tables; `0049` says otherwise. Tests only pass when no `deal_investor` link exists, which is why they fail in a full run. | [PG] `staff-role`: `investor_organizations: expected 'ok:0', got 'ok:15'` once links exist; passes alone. Needs a decision, then one of the two to change. |
| **S6** | LOW-MEDIUM, decision | **A `declined` investor can still read the NDA and teaser**; the exemption has no status check (by design) and the entitlement branch does not check the document belongs to that investor. | [PG] after setting `declined`, the investor still read `investor_nda` and `investor_teaser`. Cross-investor entitlement is blocked only by the scope trigger. |
| **S7** | LOW | `doc_type` and `doc_type_audit` are `using (true)`: any authenticated session, investors included, reads the catalogue (policy-relevant gating logic) and its audit history (staff identities in `changed_by` once edits happen). The 0035 header says staff-only. | [PG] investor read 42 and 42 rows. |
| **S8** | LOW | 24 new trigger/guard functions in the `app` schema (`0036`-`0060`) keep PUBLIC/anon EXECUTE. Not callable as RPC (`app` is not exposed; trigger functions cannot be called directly), but it fails the repo's own privilege tests and reverses PR #16's hardening. | [PG] list reproduced; four `privileges.test` cases and one `investor-rls` case fail on it. |
| **S9** | LOW | No audit trail on `platform_settings`: `deal_room_enabled` can be flipped by any `reiwa_admin` with no log, reason or `updated_by`. | [static] 0051/0052 cover only `regulated_disclosure` flag edits. |
| **S10** | LOW | Historical versions: `investor_may_read_document_version` checks document status and governing/reviewed flags but not that the version is current or locked; nothing ever sets `locked_at`, so earlier governing drafts of a Final document stay readable. | [static] |
| **S11** | LOW | Delivery edge cases: view-log insert errors are swallowed (`secure-delivery.ts:234`); signed URLs outlive a flag-off by up to their TTL (60 s). | [static] |
| S12 | INFO | Not determinable from here: whether PostgREST exposes `public` on the production project (it makes S1-S3 directly reachable); Storage bucket policies for `file_url` objects; whether any live row has `deal_document.visibility = 'investor_visible'` (the column is ignored by every policy). | needs the dashboard / a production read |

**What held up:** the flag gating (above); the NDA is scoped to the investor's own `deal_investor` row; investor B reads nothing of
investor A's; `underwriting_model` is excluded by key; all policies fail closed on a missing flag row; identity comes from
`auth.uid()` only; the existing publication/entitlement portal behaves as documented on this tree.

---

## Phase 5 - What stands between today and turning `deal_room_enabled` on

Effort is working time for one engineer, rough. "E" engineering-only, "J" needs JD, "X" needs outside parties.

### Sequencing (the order matters)

1. **J: establish production truth** (ledger SQL above; Vercel production branch and why Production deploys stopped on 6 Oct).
2. **E+J, immediately and independent of everything else:** close **S1** and merge **PR #33** (**S3**). If `0044` is applied to
   production, S1 is exposed now. These are the only findings I would not wait on.
3. **E: reconcile the branches** (merge order, migration numbering, one combined test run).
4. **E+X: get the integration suite genuinely green on a real `TEST_*` Supabase project** (this is the handoff's own precondition).
5. **E: fix S2, S4, S5/S6 decisions, drift items D1/D2/D6, the doc-type seeding runbook.**
6. **J: apply `0054`-`0060` to production** only after 3-5, then run the production runbook, and only then consider the flag.
7. **X: counsel and an independent RLS review before any real investor sees a deal room.**

### E - engineering only

| # | Item | Effort |
|---|---|---|
| E1 | S1: `security_invoker = true` (or revoke) on `deal_introduction_register`, with a test that runs as non-admin sessions | 0.5 day |
| E2 | S2/S3: stop exposing internal columns on investor-readable rows (an investor read path through column-restricted views or definer functions; the base tables no longer readable by investor sessions; replace the profile-id columns' exposure). One design, applied to `deal_document`, `document_version`, the publication tables, and merging PR #33 | 3-4 days incl. tests |
| E3 | S4: the 0060 trigger acts only on `INSERT` or a real `status` change, and never re-grants a row staff hid | 0.5 day |
| E4 | Repair the suite: foundation (7 + cleanup), investor-access (2, use a signed NDA or an override), privilege matrix (classify ~37 functions) and `revoke execute ... from public, anon` on the 24 functions, stale `workspace` counts, and make the files order-independent | 2 days |
| E5 | Gate drift: D1 (re-evaluate/create rows when flags change, backfill legacy), D2 (IC-decision rule in TS and wrap Convert to Asset), D3 (map 42501), D6 (pre-check status sets in `updateDealInvestorStatus`), D5 (staff and `platform_settings`), D7 (a same-transaction override design before 4c), D8 (Stage 4) | 4-5 days |
| E6 | Go-live runbook as code: seed `doc_type` (not done by migrations), backfill/legacy decision for existing opportunities, audit trigger on `platform_settings` (S9), flag-flip procedure | 1 day |
| E7 | Branch hygiene: merge PR #31, resolve the Emerald x PR #32 conflict, renumber my unapplied migrations (`0037`, `0038`, `0050`) without renaming any applied one, close PRs #3-#5, delete stale branches, add CI (even one workflow running typecheck, lint, unit) | 1-2 days |
| E8 | Session 4b/4c scope that real investors will expect: watermarking, expiry/download-disable, staff engagement view, override UI (the flag can be on without them, but delivery is a plain signed URL until 4b) | 2 + 3 weeks (already planned) |

### J - needs JD's input or a decision

| # | What is needed | Effort |
|---|---|---|
| J1 | Run the ledger SQL; confirm which Supabase project/database is "production" vs "reiwa-dev", and Vercel's Production Branch setting and why auto-deploy stopped | 30 min |
| J2 | S5: should `reiwa_staff` see investor orgs linked through `deal_investor`? (0049 says yes, docs/26 says no) | decision |
| J3 | S6: should a declined investor keep NDA/teaser access? | decision |
| J4 | Do existing (pre-0050) opportunities get auto-created documents and enter the readiness regime, or stay `legacy_exempt` forever? | decision |
| J5 | The open business items in docs/24: `heads_of_terms` generation mode; whether Stage 4 means anything yet; the six teaser questions (hosting, hex values, GFA/NLA semantics, transport structure) | decisions |
| J6 | The capital-pipeline import: the data is real and confidential. Decide whether it is ever run against a shared database, and add a non-test-DB refusal first | decision |
| J7 | Who may flip `deal_room_enabled`, and what approval it needs | decision |

### X - needs external parties

| # | What | Effort |
|---|---|---|
| X1 | A disposable `TEST_*` Supabase project per docs/28, to run the suite as the repo intends (real Auth/Storage/PostgREST); this is also where S1-S3's PostgREST reachability can be proven | 2-3 hours of JD's time |
| X2 | Counsel review of the NDA, IOI, pre-contract disclosure and any investor-facing document before it can be released; the Japanese regulated-disclosure rules behind `jp_pre_contract_disclosure`; data-protection position on prospect and investor PII | weeks, external |
| X3 | An e-signature provider (the schema has `esign_provider`/`esign_envelope_id`; nothing is integrated) | vendor choice, 1-2 weeks to integrate |
| X4 | PDF render hosting (Chromium) and map-tile licensing for the teaser/generator | infra decision plus 1-2 weeks |
| X5 | An independent security review of the investor boundary before real investors are onboarded to a deal room | external, 1-2 weeks |

**Honest estimate to a defensible "on":** roughly 3-4 weeks of engineering (E1-E7) running in parallel with the external items,
the longest pole being counsel (X2) and the test project (X1), not code.

---

## Things I could not establish

- The production migration ledger, the current value of `deal_room_enabled` anywhere, the Vercel production branch setting, and
  whether PostgREST exposes `public` in production (Phase 0, Phase 4 S12).
- Whether any real investor or prospect data has already been readable through S1/S3 (needs production logs).
- Real-Supabase behaviour (Storage, PostgREST, real Auth); my integration runs are on real Postgres with a local stand-in.
- The contents of `imports/` (git-ignored; deliberately not opened).

## Reproducing this

- Branch table: `git branch -r`, `git rev-list --left-right --count`, `git merge-tree --write-tree`.
- Deployments: `gh api repos/jdmooney1/Reiwa-OS/deployments` and `.../deployments/<id>/statuses` (read-only).
- Probes: the SQL used for S1, S2, S4, S6, S7 and the "every readable table" loop is short and uses only the Session 4a fixtures;
  say so if you want it committed as a script.
