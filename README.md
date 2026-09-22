# Reiwa OS

**The internal investment and asset intelligence platform for Reiwa Capital.**

Reiwa Capital is a Tokyo-based, principal-aligned firm investing Japanese
corporate, family-office and institutional capital into UK and European real
estate, mainly London and Amsterdam.

Reiwa Capital is the firm. Reiwa OS is the system the firm runs on.

One record carries a deal from first sight to exit: screening, due diligence,
investment committee, acquisition, and then the operating life of the asset.
It is internal infrastructure for one firm, not a SaaS product, a marketplace
or a broker network.

---

## Status

Phase 0 complete. The system runs on Supabase with row-level security, and
holds one deal record that spans the whole lifecycle.

**Working today**

- **Pipeline** — opportunities across six stages, with outcomes and archiving
- **Deal file** — due diligence tracker on the Reiwa London and Amsterdam
  frameworks, contacts, a document register and a decision log
- **Conversion** — approved case to transaction to asset, atomic and immutable,
  so original underwriting can always be reconstructed
- **Asset Intelligence** — portfolio and per-asset view: underwriting versus
  forecast versus actual, performance periods, valuations, risks, decisions
- **Investment Portal** — a curated investor-facing surface with versioned
  publications, entitlements and one-time-code access. Complete, and **frozen
  for V1**: bug fixes only, off the main navigation, reachable at `/admin`

**Not built yet** — document upload and extraction, the Five Tests scorecard,
the Japanese structuring overlay, the pass log and the IC memo. See the build
order in [`CLAUDE.md`](CLAUDE.md).

There is no AI in the system today. The previous simulated extraction and memo
generation were removed in the Phase 0 reset: they produced prose that read
like findings but was derived from nothing.

---

## Quick start

```bash
npm ci
cp .env.example .env.local        # see the local stack block at the foot of the file

npm run db:local                  # Supabase in Docker, works offline
npm run db:local:status           # prints the keys to paste into .env.local
npm run db:reset -- --yes         # drop, migrate, seed

npm run dev
```

Seeding creates Reiwa Capital and the firm's four reference deals — 58 Queen's
Gate, 28 Pavilion Road, Queens Hotel Brighton and Dyke Road Avenue Brighton.
**Every figure on them is deliberately absent and marked TBC.** Reiwa OS never
shows a number the firm did not enter.

| Command | Does |
| --- | --- |
| `npm test` | Unit tests: pure logic, no database. Sub-second |
| `npm run test:integration` | Postgres tests: RLS, isolation, lifecycle |
| `npm run typecheck` / `npm run lint` | Types and lint |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed -- --demo` | Load the fictional multi-tenant test fixtures |

---

## Stack

- **Next.js 14** (App Router) and TypeScript
- **Supabase** — Postgres with row-level security, Supabase Auth, Storage
- **Tailwind CSS** on the Reiwa Capital brand tokens
- **Vitest** — unit and integration suites

Security is enforced at the database. `src/lib/db/client.ts` is the only module
that speaks Postgres, and every application query runs inside an RLS-gated
transaction.

---

## Design

Deep plum `#271430` on warm cream `#FCFAF1`, the two brand greys, set in DM
Sans. Plum is the emphasis colour; there is no accent. Colour appears only on
verdicts, red flags and status, in four desaturated functional tones.

Institutional, restrained, editorial. British English throughout.

---

## Documentation

[`CLAUDE.md`](CLAUDE.md) is the working reference: data model, conventions,
design tokens, how to run and test, and the agreed build order. Read it first.

`docs/05` and `docs/09` describe the due diligence framework and Asset
Intelligence. `docs/10`–`docs/16` are a phase-by-phase record of how the
persistence, portal and access layers were built.
