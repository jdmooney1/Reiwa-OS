# 03 · MVP Screen List

> The screens that make up Reiwa OS, mapped to the routes in
> [`01-architecture.md`](01-architecture.md).

> **Status.** Originally a pre-build screen plan for a ten-module deal file at
> `/deals/[dealId]/*`. That route tree was removed in Phase 0: it was served
> entirely from a mock module and never read the database, so shipping it would
> have meant showing figures no system of record could vouch for.
>
> Section B below is what exists. Section F preserves the screens that were
> designed but never built — the design work is still good and several of the
> models behind it survive in `src/lib` — but nothing in F is a feature today.

---

## Design tokens (applies to every screen)

| Token | Value | Use |
| --- | --- | --- |
| `navy` (base) | deep dark navy | App background, sidebar |
| `surface` | warm white / off-white | Cards, panels, content area |
| `gold` (accent) | muted gold | Active nav, key figures, primary action only |
| `ink` | near-black on warm white / warm white on navy | Body text |
| `muted` | desaturated slate | Secondary text, labels |

Type: one refined sans (e.g. Inter / Söhne-like) with tabular numerals for figures.
Generous spacing, hairline dividers, no drop shadows beyond subtle elevation. One
accent action per view. No charts junk — numbers first, sparing visualisation.

---

## A. Authentication & shell

| # | Screen | Route | Notes |
| --- | --- | --- | --- |
| A1 | Sign in | `/sign-in` | Clerk-hosted/embedded. Minimal navy splash, wordmark. |
| A2 | App shell | `(app)/layout.tsx` | Persistent sidebar + topbar, auth guard, user menu. |

---

## B. Module screens (built)

Every screen below reads from Postgres under RLS. There is no mock path.

### 1 · Opportunity Pipeline — `/pipeline` (default landing)
The command centre, over `opportunities`. Board and table views:
- **Board view** — columns by `stage` (New → Screening → Underwriting → IC →
  Approved → Acquired), cards showing name, market chip, target price, status.
- **Table view** — name, market, asset type, strategy, stage, status, target
  price, NIY, target IRR.

Filters: market, asset type, strategy, stage, status. Primary action:
**New Opportunity**.

### 2 · Opportunity Detail — `/opportunities/[id]`
The pre-acquisition object. Header (name, market, asset type, strategy, stage
badge), stage progression, headline underwriting figures, and the conversion
action that creates the asset. Conversion writes
`investment_cases → transactions → assets` in one transaction and is idempotent.

### 3 · New Opportunity — `/opportunities/new`
Create form (name, city, market, asset type, strategy, currency, target price,
NIY, target IRR). Creates the `property` and the `opportunity`, lands on detail.

### 4 · Portfolio — `/portfolio`
Post-acquisition roll-up across held assets: acquisition cost, current valuation,
equity, debt, LTV, NOI, occupancy, forecast IRR against underwriting, and
concentration by country and currency.

FX is explicit. Rates come from `fx_rates` with their source and date shown on
the screen, and `portfolioAggregate` throws rather than assume a missing rate —
a portfolio figure is either traceable to a stated rate or it is not displayed.

### 5 · Asset File — `/assets/[assetId]`
The post-acquisition canonical object. Sticky header (name, location, lifecycle
stage, key metrics) above two tabs:
- **Overview** — snapshot, three-way comparison (underwriting / approved /
  current forecast), decisions required, highest-priority risks, and a provenance-
  labelled brief distinguishing facts from calculations.
- **Performance** — closed actuals periods against plan, with variance.

### 6 · Investor Portal administration — `/admin/*`
`/admin` overview, `/admin/investors` (organisations, contacts, invitations),
`/admin/publications` (investor-facing views of opportunities, with versions,
documents and entitlements), `/admin/activity` (engagement audit trail).

Publications are **views onto** opportunities, not lifecycle objects. Publishing
never mutates the underlying opportunity.

---

## C. Supporting screens

| # | Screen | Route | Notes |
| --- | --- | --- | --- |
| C1 | Sign in | `/sign-in` | Supabase Auth. Staff only. |
| C2 | Investor access | `/access`, `/access/[token]` | Single-use, time-limited invitation link. Identifies context only — it does not authenticate. |
| C3 | Investor verification | `/portal/verify` | OTP. `shouldCreateUser: false`. |
| C4 | Investor portal | `/portal`, `/portal/opportunities/[id]`, `/portal/saved`, `/portal/compare` | Entitlement-scoped. Documents served only as short-lived signed URLs. |

---

## D. Cross-cutting components (`src/components`)

- **MarketChip**, **StageBadge**, **StatusBadge**, **ScoreBadge**, **SeverityBadge**
- **Money** (currency-aware), **MetricTile**, **ProgressBar**
- **PageHeader**, **AssetHeader**, **TabNav**, **Sidebar**, **Topbar**
- **DataTable** (TanStack wrapper), **EmptyState**, **ConfirmDialog**
- **FileUploader**, **ActivityTimeline**, **RiskMatrix**, **ScoreGauge**

---

## E. Out of scope (noted, not built)

- Investment Memo PDF export engine
- External adviser access & per-opportunity permissions
- Market data / valuation integrations

---

## F. Designed, never built

These were specified as tabs of the removed `/deals/[dealId]` file. **None is a
feature today.** They are kept because the design is sound and, where noted, the
model behind it survives and is ready for a screen to be built against it.

| Screen | Model preserved | Where |
| --- | --- | --- |
| Due Diligence Tracker | ✅ London / Amsterdam checklists, jurisdiction-branched; progress and blocking-item computation | `src/lib/dd/templates.ts`, `src/lib/dd/progress.ts` |
| Investment Score | ✅ 11 weighted criteria summing to 100, recommendation bands; radar and dial components | `src/lib/scoring/model.ts`, `src/components/shared/` |
| Investment Memo | ✅ 17-section IC spine, 4 output formats (IC / teaser / snapshot / Japanese) | `src/lib/memo/sections.ts` |
| Document Vault | ✅ Category taxonomy mapped to DD sections | `src/lib/documents/catalog.ts` |
| Risk Register | ⚠️ Partial — `asset_risks` exists post-acquisition; no pre-acquisition risk table |  |
| Asset Snapshot, Financial Metrics | ❌ No schema | |
| Deal Contacts, Contacts Directory | ❌ No schema. `/contacts` was an empty placeholder and was removed | |
| Settings | ❌ Empty placeholder, removed | |

Two things were **not** preserved, deliberately:

- The **memo prose generator**, which composed paragraphs from a hardcoded
  narrative attached to one mock deal. The section structure is real; the
  generated text was not.
- The **document AI ingest**, whose `generateExtraction()` returned canned
  strings per category and presented them as "auto-extracted" findings. A
  placeholder that produces confident, fabricated diligence output is worse than
  an empty screen.
