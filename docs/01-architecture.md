# 01 · Application Architecture

> Reiwa OS — proposed architecture, folder structure, navigation, auth and storage.
> This is a design proposal. Nothing here has been implemented yet.

---

## 1. Architectural principles

1. **Deal-centric, not contact-centric.** The `deal` is the root aggregate. Every other
   record (asset, financials, DD items, risks, score, documents) hangs off a deal.
   Contacts are referenced *by* deals, never the other way around.
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
| Tables/forms | TanStack Table, React Hook Form | Pipeline grid, deal forms |
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
│   │   │   ├── pipeline/          # 1. Deal Pipeline (default landing)
│   │   │   │   └── page.tsx
│   │   │   ├── deals/
│   │   │   │   ├── new/           # Create deal flow
│   │   │   │   └── [dealId]/      # 2. Deal Detail (tabbed)
│   │   │   │       ├── layout.tsx # Deal header + tab nav
│   │   │   │       ├── page.tsx           # Overview
│   │   │   │       ├── asset/             # 3. Asset Snapshot
│   │   │   │       ├── financials/        # 4. Financial Metrics
│   │   │   │       ├── due-diligence/     # 5. Due Diligence Tracker
│   │   │   │       ├── risks/             # 6. Risk Register
│   │   │   │       ├── score/             # 7. Investment Score
│   │   │   │       ├── documents/         # 8. Document Vault
│   │   │   │       ├── contacts/          # 9. Deal Contacts
│   │   │   │       └── memo/              # 10. Investment Memo (later)
│   │   │   ├── contacts/          # Global contacts directory
│   │   │   └── settings/          # Profile, team, preferences
│   │   ├── api/
│   │   │   └── webhooks/clerk/    # Clerk → profiles sync
│   │   ├── layout.tsx             # Root layout (ClerkProvider, fonts, theme)
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                    # shadcn/ui primitives (generated)
│   │   ├── layout/                # AppShell, Sidebar, Topbar, PageHeader
│   │   ├── deals/                 # Pipeline grid, deal cards, stage badges
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

Two levels of navigation: a persistent **primary sidebar** (global) and a
**deal-scoped tab bar** (within a deal).

### Primary sidebar (global)

```
REIWA OS
─────────────
◢ Pipeline          → /pipeline        (default landing)
◢ Deals             → /deals           (table/list of all deals)
◢ Contacts          → /contacts
─────────────
◢ Settings          → /settings
[ user menu — Clerk ]
```

Minimal, vertical, dark navy. Active item marked with the muted gold accent rule.
Markets (London / Amsterdam) are a *filter* on Pipeline, not separate nav items.

### Deal-scoped tabs (`/deals/[dealId]/…`)

A sticky deal header (name, address, market, stage, score, key metrics) sits above a
horizontal tab bar:

```
Overview · Asset · Financials · Due Diligence · Risks · Score · Documents · Contacts · Memo
```

This maps 1:1 to the ten core modules and keeps the entire deal file one click away.

---

## 5. Permissions (MVP)

| Capability | Founder | Analyst |
| --- | --- | --- |
| View all deals | ✅ | ✅ |
| Create / edit deals, assets, financials | ✅ | ✅ |
| Manage DD items, risks | ✅ | ✅ |
| Edit score & weighting model | ✅ | ✅ |
| Upload / delete documents | ✅ | ✅ |
| Change deal stage to *Approved* / IC sign-off | ✅ | ❌ |
| Manage team & settings | ✅ | ❌ |

Enforced in two places: Clerk role checks in server actions, and Postgres RLS as the
backstop. The `adviser` role (read-scoped, per-deal) is deferred to the external phase.

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
4. **Pipeline** + **Create Deal** + **Deal Overview** (vertical slice).
5. Asset Snapshot → Financial Metrics (with calculators).
6. Due Diligence → Risk Register → Investment Score.
7. Document Vault (Supabase Storage).
8. Contacts.
9. Investment Memo export (PDF) — later phase.
