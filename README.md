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
