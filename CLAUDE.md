# CLAUDE.md

Working notes for Reiwa OS. Read this before changing anything.

---

## What this is

Reiwa OS is the internal investment and asset intelligence platform for **Reiwa
Capital**, a Tokyo-based, principal-aligned firm investing Japanese corporate,
family-office and institutional capital into UK and European real estate,
mainly London and Amsterdam.

Reiwa Capital is the firm. Reiwa OS is the system the firm runs on.

It is internal infrastructure for **one firm**. It is not a SaaS product, a
marketplace or a broker network. Do not build multi-tenant onboarding, listing
or investor-matching features. Every table carries `org_id` and row-level
security enforces it, but that is a security boundary, not a product surface.

---

## The one rule

**There is one record.** A deal enters as an `opportunity` and becomes an
`asset` on acquisition. Opportunity Intelligence and Asset Intelligence are two
views of one lifecycle.

The repository previously carried a second, parallel `Deal` model. It was
deleted in the Phase 0 reset. If you find yourself adding a `deal_id`, a
`deals` table or a second stage enum, stop: the change belongs on
`opportunities` or on one of its children.

---

## Data model

### Lifecycle spine

```
properties            physical identity; persists across recurrences
   └─ opportunities   ONE pipeline instance — the record everything hangs off
        ├─ investment_cases   underwriting snapshot; IMMUTABLE once approved
        ├─ transactions       acquisition; IMMUTABLE
        └─ assets             the owned position, created on conversion
             ├─ business_plans        plan_type 'underwriting' is IMMUTABLE
             ├─ performance_periods   actuals, append-only
             ├─ valuations
             ├─ asset_risks
             └─ asset_decisions
```

`src/lib/data/conversion.ts` is the bridge: approved case → transaction → asset
→ underwriting baseline, atomically and idempotently. It references; it never
duplicates.

### The deal file (children of `opportunities`)

| Table | Holds |
| --- | --- |
| `dd_items` | Due diligence workstreams, instantiated from a market framework |
| `deal_contacts` | Agents, vendors, advisers, lenders (`opportunity_id` nullable, for a firm-wide directory later) |
| `deal_documents` | A **register** of what the firm holds. No file, no extraction, until Phase 3 |
| `decision_log` | Every material call, with its rationale |

### Investment Portal (frozen)

Eleven tables (`investor_*`, `publication_*`) serving a curated investor-facing
portal. `publication_versions` are **independent whitelisted snapshots**, not a
live read-through: editing an opportunity cannot reach investor-visible
columns, and provenance lives in an admin-only side table. That is deliberate
and should stay that way.

Frozen for V1: bug fixes only, off the main navigation, reachable at `/admin`.

### Immutability

Approved investment cases, transactions and the underwriting business plan are
enforced immutable by database triggers, so original underwriting can always be
reconstructed. Do not work around them.

### Conventions

- Money `numeric(18,2)`, never floats. Percentages `numeric(7,4)`, stored as
  the percentage (4.25 means 4.25%). Areas `numeric(14,2)`.
- Primary keys `uuid default gen_random_uuid()`.
- Timestamps `timestamptz default now()`.
- Soft delete via `archived_at`, never a hard delete on a deal record.
- Postgres columns are `snake_case`; the TypeScript that maps them is
  `camelCase`. Mapping happens once, at the data layer boundary.
- Numerics come back from `pg` as strings. Coerce with `src/lib/data/coerce.ts`.

---

## Architecture

- **Next.js 14 App Router**, TypeScript, Tailwind. Server Components by
  default; `"use client"` only where there is real interaction.
- **`src/lib/db/client.ts` is the only module that speaks Postgres.** Two modes,
  kept separate:
  - `withSession(session, fn)` opens a transaction, sets
    `role authenticated` and the Supabase claims GUC, so **RLS gates every
    query inside**. All application reads and writes go through it.
  - `adminQuery` uses the privileged connection (BYPASSRLS) and is for sign-in
    support, session assembly, migrations and seeding only.
- Supabase's HTTP APIs live under `src/lib/supabase/` and never share a
  credential with the Postgres client.
- Data layer in `src/lib/data/*`, server actions in `src/app/actions/*`,
  components in `src/components/*`. A component never queries.
- Never take an `org_id` from the client. Resolve it from the parent record
  inside the same RLS-gated transaction (see `orgIdFor` in
  `src/lib/data/deal-file.ts`).
- Security is enforced at the database. Hiding a link is presentation, never
  the control.

---

## AI and extraction (Phase 3 onwards, nothing built yet)

These rules exist before the code does, because they are the point.

1. **Never invent a value.** If a figure is not in the source, the field stays
   blank and is flagged. A confident wrong number is worse than a gap.
2. **Store three things separately**: the raw extraction, the AI suggestion,
   and the human-approved value, with an audit trail. The approved value is the
   only one anything downstream reads.
3. **Every extracted field carries a confidence flag and a source reference**
   (page or cell). Every field is editable.
4. **Prompts live in versioned files under `/prompts`**, never as inline
   strings.
5. **AI output is a draft.** The interface must always say so.
6. **The provider sits behind a thin interface.** Anthropic API, native PDF
   input, structured output validated with zod at the boundary.
7. **Tax output is labelled "indicative — subject to adviser confirmation"**,
   always. Structuring is an assumptions sheet the user fills in, not a
   calculator with rate tables baked in. Japanese depreciation rules for
   overseas property have changed before and will again; encoding them creates
   a liability.

---

## Design

Institutional, restrained, editorial. Oaktree or Blackstone report, not a
startup dashboard. No gradients, no emojis, no gamification. Typography and
spacing carry the weight.

### Palette

| Token | Value | Use |
| --- | --- | --- |
| `plum` | `#271430` | Dark surfaces, emphasis, primary action |
| `plum-50` | `#3D2449` | Hover on plum |
| `surface` | `#FCFAF1` | The page (cream) |
| `surface-card` | `#FFFDF8` | Cards |
| `surface-sunken` | `#F4F0E5` | Wells, table headers |
| `ink` | `#271430` | Body text (plum, not black) |
| `ink-muted` | `#918790` | Labels, secondary copy |
| `ink-faint` | `#BCB5B7` | **Placeholders and decoration only** |
| `line` | `#E4DFD6` | Hairlines on cream |
| `line-dark` | `#3D2449` | Hairlines on plum |

**There is no accent colour.** Plum is the emphasis. Gold is gone; do not
reintroduce it.

The only other colours are four desaturated functional signals, reserved for
verdicts, red flags and status: `verdict-pursue` `#4F6B57`, `verdict-watch`
`#8A7A45`, `verdict-pass` `#7C7176`, `flag` `#8C4A42`. The legacy
`positive` / `caution` / `negative` tokens are aliases of the same values, so
the interface cannot drift into a second signal palette. Nothing decorative is
ever coloured. Do not use Tailwind's default hues (emerald, amber, rose, slate)
or raw `white`.

`ink-faint` is below a readable contrast ratio on cream at small sizes. If text
carries information, it uses `ink-muted`.

### Type

**DM Sans only**, via `next/font`. There is no serif. Display type uses the
`.display` class (tighter tracking), not a second family. Numbers use
`.tabular`.

### Language

- **British English.** Organisation, capitalise, recognise, analyse.
- **Standard hyphens only.** No long dashes in prose, in the interface or in
  commit messages. `—` as a placeholder for an absent value is fine, and is
  what the `format*` helpers return.
- An absent figure renders as `—`, never as `0`. This is tested.

---

## Running it

```bash
npm ci
cp .env.example .env.local        # fill in — see the local stack block at the foot

npm run db:local                  # Supabase in Docker, offline
npm run db:local:status           # prints the keys for .env.local
npm run db:reset -- --yes         # drop, migrate, seed Reiwa's four deals

npm run dev
```

Against a hosted project, set the dashboard values in `.env.local` instead and
skip `db:local`.

### Database

| Command | Does |
| --- | --- |
| `npm run db:migrate` | Apply pending migrations (ledger: `app._migrations`) |
| `npm run db:seed` | Seed Reiwa Capital's four reference deals, if empty |
| `npm run db:seed -- --demo` | Seed the fictional multi-tenant test fixtures instead |
| `npm run db:reset -- --yes` | **Destructive.** Drop, migrate, seed |

Migrations are plain SQL in `supabase/migrations/`, applied in filename order by
our own runner. They are idempotent (`if not exists`, `drop policy if exists`).
Never edit an applied migration; add a new one.

The Supabase CLI's own seeding is disabled in `config.toml`. This repository
owns its schema and fixtures through `db:reset`.

### Fixtures

`npm run db:seed` loads **Reiwa Capital only**: 58 Queen's Gate, 28 Pavilion
Road, Queens Hotel Brighton (passed, price) and Dyke Road Avenue Brighton
(passed, off-strategy).

**Every figure on them is deliberately absent and labelled TBC.** Do not fill
them in with plausible numbers. A unit test enforces this.

The fictional organisations (Meiji, Aoyama, and the four investor firms) exist
only to prove row-level isolation and load only under `--demo`, which is what
the integration suite uses.

---

## Testing

| Command | Runs |
| --- | --- |
| `npm test` | Unit suite: pure logic, no database, no network. Sub-second |
| `npm run test:watch` | Same, in watch mode |
| `npm run test:integration` | Postgres suite: RLS, isolation, lifecycle |
| `npm run test:all` | Both |

Unit tests live **beside the code** (`src/**/*.test.ts`). Anything pure belongs
here: scoring, screens, tax arithmetic, formatting, progress calculations.

Integration tests live in `tests/` and **drop and recreate the schema** of
whatever `DATABASE_URL` points at, seeding the demo fixtures. Point them at the
local stack. Never at a database holding real deal data.

Before pushing: `npm test && npm run typecheck && npm run lint`.

---

## Build order

Phase 0 is done. The rest, in agreed order:

| Phase | Content | State |
| --- | --- | --- |
| 0 | One record, stale artefacts gone, rebrand, real fixtures, test setup | Done |
| 1 | Five Tests scorecard (Market, Income, Asset, Business Plan, Downside) with verdict Pursue / Watch / Pass; entry NIY vs all-in cost of debt screen with a negative-leverage flag and a configurable 6.0% floor, inside Income and Downside | Next |
| 2 | Pass log and Reiwa Intelligence: structured pass reason, revisit trigger (price and/or NIY at which we reconsider), source/introducer, guide price vs our view of value, date screened, outcome if known. Searchable and filterable |  |
| 3 | Document intake and extraction: Supabase Storage, PDF and Excel, field-level confidence, source reference, raw / suggested / approved values, audit trail |  |
| 4 | Japanese structuring overlay: building-to-land split, depreciable basis, GK-TK vs UK Ltd/SPV, share vs asset purchase — all editable assumptions |  |
| 5 | Pipeline polish and IC memo: English narrative plus a bilingual structured term sheet from a fixed EN/JA glossary file |  |

Five Tests definitions live in **one config file**; the methodology is not
final. No machine-drafted Japanese narrative in V1.

The retired 11-criterion score is kept at `src/lib/scoring/model.ts` as
reference only. No screen renders it. Delete it once Five Tests is calibrated.

---

## Ways of working

- Small phases. After each: summary of changes, how to test, open questions.
- One commit per logical step, with a message that says why.
- Push back on anything over-engineered for a one-person firm, and recommend
  the simpler path.
- `docs/05` and `docs/09` describe the DD framework and Asset Intelligence and
  are current. `docs/10`–`docs/16` are a phase-by-phase record of how the
  persistence, portal and access layers were built; they are history, and
  `docs/10` predates the move to Supabase.
