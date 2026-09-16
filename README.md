# Reiwa OS

**Private real estate deal intelligence platform for Reiwa Capital.**

Reiwa OS turns every UK and European property opportunity into a structured digital
deal file — from sourcing and screening through underwriting, due diligence, risk
assessment, scoring, and investment-committee memo. It is built for Reiwa Capital's
internal team (Founder, Analyst) and, later, vetted external advisers, with Japanese
investor–grade rigour and presentation.

This is **not** a generic CRM or dashboard. It is a deal screening, underwriting,
due diligence, and investment memo system.

---

## Status

🟡 **Phase 0 — Architecture & data model proposal.**

This commit contains design documentation only. No application code has been built
yet. See the documents below before any implementation begins.

| Document | Purpose |
| --- | --- |
| [`docs/01-architecture.md`](docs/01-architecture.md) | Tech stack, folder structure, navigation, auth, storage |
| [`docs/02-data-model.md`](docs/02-data-model.md) | Domain model, entity relationships, schema rationale |
| [`docs/03-mvp-screens.md`](docs/03-mvp-screens.md) | MVP screen list, layouts, component inventory |
| [`docs/10-persistence-gate.md`](docs/10-persistence-gate.md) | Property-centric lifecycle model, immutability rules |
| [`docs/11-supabase-p0.md`](docs/11-supabase-p0.md) | P0: Supabase runtime, Supabase Auth, RLS claims seam |
| [`docs/12-investor-portal-p1.md`](docs/12-investor-portal-p1.md) | P1: Investment Portal data foundation, publication boundary, investor RLS |
| [`docs/18-launch-hardening-p6.md`](docs/18-launch-hardening-p6.md) | P6: secure document delivery, privilege hardening, invitation hand-off, connection resilience, accessibility |
| [`docs/17-operations-runbook.md`](docs/17-operations-runbook.md) | **Running it in production:** environment, Supabase/SMTP/storage config, deployment, provisioning the first investor, emergency access removal, rollback, monitoring |
| [`supabase/schema.sql`](supabase/schema.sql) | Concrete proposed Postgres schema (enums, tables, RLS) |

---

## Tech stack

- **Framework:** Next.js (App Router) + TypeScript
- **Styling:** Tailwind CSS + shadcn/ui
- **Auth:** Supabase Auth (email + password; staff accounts)
- **Database:** Supabase (Postgres + Row Level Security)
- **File storage:** Supabase Storage (Document Vault)
- **Hosting (proposed):** Vercel

## Design language

Premium institutional finance. Minimal, calm, confident. Dark navy base, warm white
surfaces, a single muted gold accent. Not startup SaaS, not playful, not a generic
dashboard. Typography and spacing carry the weight; colour is used sparingly.

## Initial scope

- **Markets:** London, Amsterdam
- **Currencies:** GBP, EUR
- **Users:** Founder, Analyst (external advisers added in a later phase)

## Running the checks

Non-destructive, no database required:

```bash
npm run typecheck
npm run lint
npm run build
npm run test:unit
```

The integration and end-to-end suites need a **separate, disposable Supabase
project**, and they refuse to run without one. `npm test` drops every application
table on every run — and the suites also create and delete Auth users, and
create, upload to and delete from a Storage bucket.

Both halves are configured, and neither falls back to the application's values:

| Normal application | Automated tests |
|---|---|
| `DATABASE_URL` | `TEST_DATABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_URL` | `TEST_SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `TEST_SUPABASE_PUBLISHABLE_KEY` |
| `SUPABASE_SECRET_KEY` | `TEST_SUPABASE_SECRET_KEY` |

All four test variables must name the same project, and the gate refuses if they
disagree or if any of them names the application's project.

```bash
ALLOW_TEST_DATABASE_RESET=true npm test   # drops and reseeds the test project
npm run test:e2e                          # reads/writes only; never resets
npm run db:storage:test                   # bucket on the test project, by hand
```

**Automated tests must never provision Auth users or Storage resources in
`reiwa-dev`.** `npm run db:storage` remains the operator command and still
targets `NEXT_PUBLIC_SUPABASE_URL`.

`npm run db:reset -- --yes` is gated the same way: `--yes` alone is not enough,
and the target must carry `app.destructive_reset_allowed = 'true'`.

Read [docs/19-test-database-safety.md](docs/19-test-database-safety.md) before
the first run. Never point the test variables at `reiwa-dev`, staging or
production, and never mark `reiwa-dev` destroyable while it backs a live-facing
deployment.

Manual production smoke tooling lives in
[`scripts/manual-production-smoke/`](scripts/manual-production-smoke/README.md).
It is never part of `npm run test:e2e`, has no default target, and requires an
explicit opt-in.
