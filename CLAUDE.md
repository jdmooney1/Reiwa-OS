# CLAUDE.md

Project guidance for any Claude Code session working in this repository.

## Current state & working rules

**Branches.** There is no `main`. The live/deployed branch is
`claude/reiwa-os-phase-1b-product-polish`. The working branch for the deal
document system is `claude/quirky-meitner-k4tokb`. The teaser/property-summary
work is on `feature/teaser-generator`, branched from
`claude/quirky-meitner-k4tokb`.

**Production database state.** Migrations `0001`–`0053` are applied to
production (project `lbmtlcdjjgfotzqpxswk`). Migrations `0054`–`0060`
(docs/24 Session 4a — investor visibility of `deal_document`/
`document_version`, and the entitlement sync) are committed to
`claude/quirky-meitner-k4tokb` but **NOT yet applied to production.**
`deal_room_enabled` (`platform_settings`) must stay **OFF** until the
integration suite has actually been run against a real database — see
docs/29.

**Rules, standing across every session:**
- **Never run anything against the production database.** No migration, no
  seed, no script, however small or "obviously safe." JD applies migrations
  himself, on his own machine, after reviewing them.
- Commit and push freely to working/feature branches. **Never push to the
  live branch.** Open a pull request only when explicitly asked — most
  rounds end with a push and a stop, not a PR.
- **Plan or audit before building.** A build round follows a reviewed plan;
  it does not start from a verbal brief alone. Stop and report at the end of
  each session/round — don't chain unapproved work into the next phase.
- **Check both branches for migration-number collisions before writing any
  migration.** `claude/reiwa-os-phase-1b-product-polish` and
  `claude/quirky-meitner-k4tokb` have collided on migration numbers before
  (0033–0035, reconciled by `0053` — see docs/24 §12). Fetch both, check the
  highest number on each, before picking the next one.
- **Never rename an applied migration.** The migration ledger
  (`app._migrations`) matches by exact filename; renaming a file that is
  already applied anywhere makes the runner treat it as new and re-run it.
- `imports/` is git-ignored and holds confidential source data (capital
  pipeline / investor targets). Never commit it, never treat it as sanitised
  test data, never reference its contents outside the one import script it
  was provided for.

## Required reading, in order

1. **docs/24-deal-document-system.md** — the deal document system itself:
   schema, gates, investor visibility, every session's decisions and why.
2. **docs/28-test-supabase-project-setup.md** — how to stand up the
   disposable `TEST_*` Supabase project the integration suite needs. Nothing
   in this repo's integration suite (`tests/**/*.test.ts` outside
   `tests/unit/`) can run without it.
3. **docs/29-handoff.md** — the session-boundary handoff: what's built, what
   is and isn't verified, open decisions, and the agreed build order from
   here.
4. **docs/TEASER-AUDIT.md** — the 物件概要書 (property summary) teaser
   project's Session 1 audit: data contract, reuse, gaps, rendering
   recommendation. Read before touching `feature/teaser-generator`.
