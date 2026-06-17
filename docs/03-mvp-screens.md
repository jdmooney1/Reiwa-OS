# 03 · MVP Screen List

> The screens that make up the Reiwa OS MVP, mapped to the ten core modules and the
> routes in [`01-architecture.md`](01-architecture.md).

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

## B. Module screens (MVP)

### 1 · Deal Pipeline — `/pipeline` (default landing)
The command centre. Two views toggled in the header:
- **Board view** — columns by `deal_stage` (Sourced → … → Closed), draggable cards
  showing reference, name, market chip, target price, score badge, owner avatar.
- **Table view** — dense TanStack Table: reference, name, market, asset class, stage,
  target price, score, IRR, owner, updated. Sortable, filterable.

Filters: market (London / Amsterdam), asset class, stage, owner, status. Header shows
portfolio summary tiles (active deals, total target value by currency, deals in DD,
average score). Primary action: **New Deal**.

### 2 · Deal Detail — `/deals/[dealId]`
Sticky **deal header** across all deal tabs: name + reference, address, market chip,
stage selector, status, investment score badge, and 3–4 headline metrics (target price,
NIY, levered IRR, LTV). Below it, the tab bar. The default tab is **Overview**:
- Investment thesis / summary
- Snapshot of key metrics, score, and DD/risk completion progress
- Recent **activity timeline** (from `deal_activity`)

### 3 · Asset Snapshot — `/deals/[dealId]/asset`
Structured property facts in a clean two-column read/edit layout: address & map pin,
tenure, areas (GIA/NIA/sqm), units, occupancy, WALT, year built, EPC, condition notes.
Inline edit with Zod-validated server action.

### 4 · Financial Metrics — `/deals/[dealId]/financials`
Split layout: **Inputs** panel (purchase price, costs, NOI, rents, equity, debt, rate,
hold period, exit yield) on the left; **Derived metrics** tiles on the right (NIY, gross
yield, LTV, DSCR, levered/unlevered IRR, equity multiple, cash-on-cash, price/sqm).
Metrics recompute live via `src/lib/finance` and persist on save. Currency-aware
formatting (GBP/EUR).

### 5 · Due Diligence Tracker — `/deals/[dealId]/due-diligence`
Checklist grouped by `dd_category` (Legal, Financial, Technical, Commercial, Tax, ESG).
Each row: title, status chip (Not started / In progress / Complete / Flagged / N/A),
assignee, due date. Category progress bars; "flagged" items surfaced at the top.
Seed-from-template action when a deal enters DD.

### 6 · Risk Register — `/deals/[dealId]/risks`
Two parts: a **5×5 risk matrix** (likelihood × impact) with dots per risk, and a
**risk table** (category, title, likelihood, impact, severity band, status, owner,
mitigation). Severity band colour-coded (low → critical) but restrained.

### 7 · Investment Score — `/deals/[dealId]/score`
A **score gauge** (0–100) with recommendation (Pursue / Hold / Pass), pillar breakdown
(Location, Asset Quality, Cashflow, Risk, Return, ESG) shown as labelled bars, an
editable **weighting model**, and a rationale text block. Saving records the weights so
the score is reproducible.

### 8 · Document Vault — `/deals/[dealId]/documents`
Files grouped by `doc_category` (Legal, Financial, Technical, Valuation, Marketing,
Correspondence, Other). Drag-and-drop uploader to a private Supabase Storage bucket;
list shows file name, category, size, version, uploader, date. Download via short-lived
signed URLs. Versioning preserved.

### 9 · Deal Contacts — `/deals/[dealId]/contacts`
People attached to this deal via `deal_contacts`, grouped by relationship (selling
agent, vendor, lawyer, lender, valuer…). Add existing contact or create new. Each card:
name, company, role, type chip, email/phone.

### 9b · Contacts Directory — `/contacts`
Global searchable list of all `contacts` with type filter. Detail drawer shows linked
deals. Feeds the per-deal contacts screen.

### 10 · Investment Memo — `/deals/[dealId]/memo` *(later phase)*
Assembles asset, financials, DD summary, risks, and score into a structured,
print/PDF-ready investment memo for the committee. Included in nav as "Memo (coming
soon)" in MVP; export engine built in a later phase.

---

## C. Supporting screens

| # | Screen | Route | Notes |
| --- | --- | --- | --- |
| C1 | New Deal | `/deals/new` | Minimal create form (name, market, asset class, currency, source). Creates deal + empty asset/financials, lands on Overview. |
| C2 | Settings | `/settings` | Profile (via Clerk), team members & roles (founder only), preferences. |

---

## D. Cross-cutting components (`src/components`)

- **MarketChip**, **StageBadge**, **StatusBadge**, **ScoreBadge**, **SeverityBadge**
- **Money** (currency-aware), **MetricTile**, **ProgressBar**
- **PageHeader**, **DealHeader**, **TabNav**, **Sidebar**, **Topbar**
- **DataTable** (TanStack wrapper), **EmptyState**, **ConfirmDialog**
- **FileUploader**, **ActivityTimeline**, **RiskMatrix**, **ScoreGauge**

---

## E. Out of scope for MVP (noted, not built)

- Investment Memo PDF export engine (later phase)
- External adviser access & per-deal permissions
- Email/notification system
- Market data / valuation integrations
- Portfolio-level analytics across multiple assets per deal
