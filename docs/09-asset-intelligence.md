# 09 · Asset Intelligence

The post-acquisition operating layer of Reiwa OS. It answers five questions for an
investor — what we underwrote, what is happening now, what changed, what needs attention,
and what it means for returns — by turning fragmented asset-management information into
structured investment intelligence. It is **not** a property-management database or a file
repository.

## Lifecycle & the persistent asset

```
Opportunity → Underwriting → Transaction → Asset Intelligence → Exit
```

A single **`asset_id`** persists across the lifecycle. The acquisition underwriting is the
existing `deals` record; the asset references it via `assets.source_deal_id`, so the system
continuously compares **Original Underwriting vs Current Forecast vs Actual** without
duplicating the property. The comparison reads across `business_plans` (immutable
baseline + latest forecast) and `performance_periods` (actuals) — history is never
overwritten.

## Multi-tenant architecture

```
Organisation (Meiji Shipping) → Portfolio (UK / Netherlands) → Asset → …
```

`organizations` / `organization_members` / `portfolios` are the tenant root. Every
asset-scoped table denormalises `org_id`; **org-scoped RLS** (`user_orgs()` helper) means
an organisation sees only its own assets. Built into the new tables from day one.

## Schema (supabase/asset-intelligence.sql — additive)

`organizations`, `organization_members`, `portfolios`, `assets`, `business_plans`
(versioned/immutable), `performance_periods` (append-only), `tenants`, `leases`,
`capex_items`, `development_projects`, `milestones`, `valuations`, `loans`, `asset_risks`,
`asset_decisions`, `advisers`, `asset_actions`, `asset_events`, `reporting_periods`. Two
non-destructive `ALTER`s add nullable `deals.asset_id` and `documents.asset_id`. Nothing in
`schema.sql` is rewritten.

**History preservation.** `business_plans` carry `(plan_type, version)` and no update path;
`performance_periods` are immutable once `closed`. We can reconstruct what management
believed at any prior reporting date.

## Navigation & routes

Sidebar section **Asset Intelligence** → `/portfolio` and `/assets/[assetId]`. The asset
page uses the existing tab-shell pattern: Overview · Performance · Leasing · CapEx /
Development · Valuation · Financing · Risks · Decisions · Advisers & Actions · Reporting.

## Reuse vs create

- **Reused:** design tokens, `Card`/`Badge`/`Tabs`/`Select`/`MetricTile`/`PageHeader`/
  `Sidebar`, `format.ts`, tone system, tab-shell, the AI-provenance discipline.
- **Created:** `src/lib/asset-intelligence/*` (types, metrics/variance, AI provenance,
  labels, demo data), shared `VarianceValue`, portfolio dashboard + asset overview
  components, the asset tab shell.

## AI intelligence layer (provenance-first)

`ai.ts` answers four structured questions — **what changed / why it matters / what needs
attention / what's next** — and every statement is tagged with provenance: **fact ·
calculation · forecast · assumption · commentary**. Phase 1 emits only facts and
calculations derived deterministically from structured data; model-authored *commentary*
(Phase 4) plugs into the same interface. AI inference is never presented as source data.

Intelligence hierarchy (not reversed): **Portfolio** (where to focus) → **Asset
Intelligence** (why) → **structured data** (evidence) → **documents** (source) → **AI**
(interpretation).

## Technical debt noted

- **Deal↔asset unification:** deals are currently standalone property records; the FK
  (`deals.asset_id`) links them now, with full unification deferred to avoid rewriting
  shipped modules.
- **Multi-tenancy retrofit:** existing deal tables have no `org_id`; new asset tables are
  org-scoped now, deal tables to be backfilled later.
- **Blended-currency portfolio:** totals use a clearly-labelled **demo FX** rate
  (`DEMO_FX_TO_GBP`) to a GBP reporting currency — replace with a live rate source.

## Demonstration data (clearly flagged, `is_demo = true`)

- **16 Conduit Street, Mayfair** — operating mixed-use; links to its underwriting deal;
  three-way comparison shows office-vacancy-driven NOI/IRR drift vs underwriting, a
  required leasing-incentive decision, and lease-event timeline.
- **Herengracht 472, Amsterdam** — value-add / redevelopment; budget-vs-forecast overrun,
  heritage-constrained programme with milestones, and a required revised-budget decision.

Figures are realistic illustrations, not real transactions.

## Phased plan

- **Phase 1 (done):** navigation · asset/org/portfolio model · Asset Overview · Portfolio
  Dashboard.
- **Phase 2:** underwriting-vs-current-vs-actual detail · leasing · CapEx · valuation ·
  financing.
- **Phase 3:** development programme · risks · decisions · actions · advisers.
- **Phase 4:** reporting · AI management commentary · document intelligence.
