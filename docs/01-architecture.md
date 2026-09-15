# 01 · Application Architecture

> Reiwa OS — architecture, folder structure, navigation, auth and storage.

> **Status.** Written as a pre-build proposal; revised in Phase 0 to describe what
> was actually built. Two things in the original are superseded and are corrected
> below: the deal-centric aggregate (the canonical objects are `opportunities` and
> `assets`) and the `/deals/*` route tree (removed — it was never wired to the
> database). One thing is superseded and NOT yet corrected throughout: auth is
> Supabase Auth, not Clerk. Treat remaining Clerk references as historical.

---

## 1. Architectural principles

1. **One object per lifecycle phase.** Before acquisition the root aggregate is the
   `opportunity`; after acquisition it is the `asset`. They are joined by an explicit,
   auditable conversion — `opportunities → investment_cases → transactions → assets` —
   so the moment a deal becomes a holding is a recorded event rather than a status flag.
   Nothing may model the same thing twice: a second "deal" aggregate alongside these
   was removed in Phase 0 precisely because it drifted out of sync with the database.

   `investor_publications` are **views onto** opportunities for an external audience.
   They are not a lifecycle stage and never own deal state.
2. **Server-first.** Use React Server Components and Server Actions for data access.
   The Supabase service role and Clerk session stay on the server; the browser never
   holds privileged keys.
3. **Typed end to end.** Database types are generated from Postgres and shared across
   queries, server actions, and UI. No untyped `any` at module boundaries.
4. **Calm, slow software.** Institutional users value predictability over novelty.
   Few colours, generous whitespace, no animation for its own sake.
5. **Auditable.** Every meaningful mutation (stage change, score change, DD sign-off)
   is recorded in an activity log. This matters for IC governance.

---

## 2. Tech stack & responsibilities

| Layer | Technology | Responsibility |
| --- | --- | --- |
| UI framework | Next.js (App Router) + TypeScript | Routing, RSC, server actions, SSR |
| Styling | Tailwind CSS | Utility styling, design tokens |
| Components | shadcn/ui (Radix primitives) | Accessible base components, themed |
| Auth | Clerk | Identity, sessions, org membership, roles |
| Database | Supabase Postgres | Relational data, RLS, generated types |
| Storage | Supabase Storage | Document Vault (private buckets) |
| Validation | Zod | Form + server-action input validation |
| Data fetching | Server Components + Server Actions | Reads on the server, mutations via actions |
| Tables/forms | TanStack Table, React Hook Form | Pipeline grid, opportunity forms |
| Hosting | Vercel (proposed) | Edge/serverless deployment |

### Clerk ↔ Supabase integration

Clerk is the source of truth for identity. Supabase RLS reads the Clerk user ID from a
verified JWT (Clerk configured as a third-party auth provider / JWT template). Pattern:

- Clerk issues a session JWT whose `sub` is the Clerk user id.
- A `profiles` row mirrors each Clerk user (id = Clerk `sub`), holding `role` and
  display fields. A webhook (`/api/webhooks/clerk`) keeps `profiles` in sync on
  user.created / updated / deleted.
- RLS policies authorise against `auth.jwt() ->> 'sub'` and the profile's `role`.
- Server-side reads use a request-scoped Supabase client carrying the Clerk token.

Roles for MVP: `founder`, `analyst`. (`adviser` reserved for the later external phase.)

---

## 3. Folder structure

```
reiwa-os/
├── docs/                          # Architecture & design (this folder)
├── supabase/
│   ├── schema.sql                 # Proposed schema (enums, tables, RLS, triggers)
│   └── migrations/                # Generated migrations (added during build)
├── public/                        # Static assets, logo, fonts
├── src/
│   ├── app/                       # Next.js App Router
│   │   ├── (marketing)/           # Public sign-in / landing (minimal)
│   │   │   └── sign-in/
│   │   ├── (app)/                 # Authenticated application shell
│   │   │   ├── layout.tsx         # Sidebar + topbar shell, auth guard
│   │   │   ├── pipeline/          # Opportunity pipeline (default landing)
│   │   │   │   └── page.tsx
│   │   │   ├── opportunities/     # Pre-acquisition canonical object
│   │   │   │   ├── new/           # Create opportunity
│   │   │   │   └── [id]/          # Opportunity detail + stage transitions
│   │   │   ├── portfolio/         # Post-acquisition roll-up
│   │   │   ├── assets/
│   │   │   │   └── [assetId]/     # Asset file (Overview · Performance)
│   │   │   └── admin/             # Investor portal administration
│   │   │       ├── investors/     # Investor organisations & contacts
│   │   │       ├── publications/  # Investor-facing views of opportunities
│   │   │       └── activity/      # Investor engagement audit trail
│   │   ├── layout.tsx             # Root layout (ClerkProvider, fonts, theme)
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                    # shadcn/ui primitives (generated)
│   │   ├── layout/                # AppShell, Sidebar, Topbar, PageHeader
│   │   ├── opportunities/         # Pipeline board/table, stage badges
│   │   ├── financials/            # Metric tiles, sensitivity inputs
│   │   ├── due-diligence/         # Checklist, status chips
│   │   ├── risks/                 # Risk matrix, severity badges
│   │   ├── score/                 # Score gauge, weighting editor
│   │   ├── documents/             # Vault list, uploader, category folders
│   │   └── shared/                # Money, Empty states, Confirm dialogs
│   ├── lib/
│   │   ├── supabase/              # server.ts / client.ts factories
│   │   ├── auth/                  # Clerk helpers, role guards, current profile
│   │   ├── validation/            # Zod schemas per module
│   │   ├── finance/               # Yield/IRR/LTV/DSCR calculators (pure fns)
│   │   ├── scoring/               # Investment score model & weights
│   │   ├── format/                # Currency, dates, sqm formatting
│   │   └── constants/             # Markets, asset types, DD templates
│   ├── server/
│   │   ├── actions/               # Server actions (mutations) per module
│   │   └── queries/               # Typed read helpers per module
│   ├── types/
│   │   ├── database.types.ts      # Generated Supabase types
│   │   └── domain.ts              # Hand-written view/composite types
│   └── styles/                    # Tailwind config tokens, theme
├── .env.example
├── components.json                # shadcn/ui config
├── tailwind.config.ts
└── tsconfig.json
```

**Conventions**

- Reads live in `src/server/queries`, mutations in `src/server/actions`. UI never
  touches Supabase directly.
- Finance and scoring are **pure, unit-tested functions** in `src/lib` — no DB or React
  imports — so calculations are deterministic and reviewable.
- Domain enums (markets, asset types, stages, DD categories) are defined once in
  `src/lib/constants` and mirror Postgres enums in `supabase/schema.sql`.

---

## 4. Navigation model

A persistent **primary sidebar**, grouped by lifecycle phase.

### Primary sidebar (global)

```
REIWA OS
─────────────
INVESTMENT
◢ Pipeline          → /pipeline          (default landing; opportunities)
─────────────
ASSET INTELLIGENCE
◢ Portfolio         → /portfolio
  ◦ <asset>         → /assets/[assetId]  (one row per held asset)
─────────────
INVESTMENT PORTAL   (admin only)
◢ Portal Overview   → /admin
◢ Investors         → /admin/investors
◢ Publications      → /admin/publications
◢ Activity          → /admin/activity
```

Minimal, vertical. Active item marked with the accent rule. Markets
(London / Amsterdam) are a *filter* on Pipeline, not separate nav items.

The sidebar is presentation, not the control: the Investment Portal section is
hidden from non-admins, but the authorisation that matters is enforced in RLS
and in each server action, never by omitting a link.

### Asset tabs (`/assets/[assetId]`)

A sticky asset header (name, location, lifecycle stage, key metrics) sits above:

```
Overview · Performance
```

Two tabs, because those are the two things the schema can answer. Eight further
tabs were removed in Phase 0: they rendered a "planned module" card claiming a
data model that has no table, column or row anywhere in the database. Each
returns when the module behind it genuinely exists.

---

## 5. Permissions (MVP)

| Capability | Founder | Analyst |
| --- | --- | --- |
| View all opportunities and assets | ✅ | ✅ |
| Create / edit opportunities, assets, business plans | ✅ | ✅ |
| Manage DD items, risks | ✅ | ✅ |
| Edit score & weighting model | ✅ | ✅ |
| Upload / delete documents | ✅ | ✅ |
| Move an opportunity to *Approved* / IC sign-off | ✅ | ❌ |
| Manage team & settings | ✅ | ❌ |

Enforced in two places: Clerk role checks in server actions, and Postgres RLS as the
backstop. The `adviser` role (read-scoped, per-opportunity) is deferred to a later phase.

---

## 6. Environment variables (`.env.example`)

```
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
CLERK_WEBHOOK_SECRET=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## 7. Suggested build sequence (after this proposal is approved)

1. Scaffold Next.js + Tailwind + shadcn/ui, apply design tokens & theme.
2. Wire Clerk auth + app shell + protected layout.
3. Apply `supabase/schema.sql`, generate types, build query/action layer.
4. **Pipeline** + **Create Opportunity** + **Opportunity Detail** (vertical slice).
5. Asset Snapshot → Financial Metrics (with calculators).
6. Due Diligence → Risk Register → Investment Score.
7. Document Vault (Supabase Storage).
8. Contacts.
9. Investment Memo export (PDF) — later phase.
