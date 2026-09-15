# 02 · Data Model

> The domain model of Reiwa OS. The concrete DDL lives in
> [`../supabase/migrations/`](../supabase/migrations/); this document explains the
> reasoning and the relationships.

> **Status.** Rewritten in Phase 0. This document previously described a
> `deals`-rooted aggregate with `deal_financials`, `dd_items`, `risks`,
> `investment_scores`, `documents`, `contacts`, `deal_contacts`, `deal_activity`
> and `memos`. **None of those tables was ever created.** They existed only as
> TypeScript shapes fed by `src/lib/mock-data.ts`, which is why a whole screen
> could look persistent while writing nothing. The model below is the one in the
> migrations.

---

## 1. Aggregate overview

There is **one object per lifecycle phase**, and an explicit, immutable record of
the moment one becomes the other.

```
organizations ── organization_members ── profiles (Supabase Auth users)
      │
      ├── portfolios
      └── properties            the persistent physical identity
              │
              ▼
        opportunities           PRE-ACQUISITION canonical object
              │                 (pipeline: stage + status)
              ▼
        investment_cases        underwriting snapshot; IMMUTABLE once approved
              │
              ▼
        transactions            the acquisition; IMMUTABLE always
              │
              ▼
           assets               POST-ACQUISITION canonical object
              │
              ├── business_plans        underwriting / approved / current_forecast
              ├── performance_periods   actuals, append-only once closed
              ├── valuations
              ├── asset_risks
              └── asset_decisions
```

Investor-facing publication is a **separate, read-only projection**, not a
lifecycle stage:

```
opportunities ◀── publication_sources (admin-only mapping)
                        │
                  investor_publications ── publication_versions
                                                  ├── publication_documents
                                                  └── publication_entitlements → investor_organizations
```

Design choices:

- **A property is not an opportunity.** `properties` holds the physical identity,
  which persists; an opportunity is one pipeline attempt at it. The same building
  can come round twice without duplicating its facts or losing the first attempt.
- **The approved case and the transaction are immutable**, enforced by
  `BEFORE UPDATE OR DELETE` triggers (`app.block_if_approved_case`,
  `app.block_transaction_change`) — not by convention. Original underwriting can
  always be reconstructed, which is the whole basis of the variance reporting.
- **The underwriting business plan is immutable** too
  (`app.block_underwriting_plan`), so the baseline a forecast is measured against
  cannot drift.
- **Money is `numeric(18,2)`**, never float. Percentages are `numeric(7,4)`.
  Currency is held per opportunity and per asset.
- **Constraints are `check` on `text`, not Postgres enums.** Stage and status
  vocabularies change as a business matures; a `check` constraint is altered in a
  migration without the enum-dependency dance.
- **`org_id` is denormalised onto every tenant-scoped table** so one RLS predicate
  (`app.has_org(org_id)`) applies uniformly and is indexable.

---

## 2. Entities

### Identity & tenancy (`0001_identity.sql`)

| Table | Purpose |
| --- | --- |
| `organizations` | Tenant root. `org_id`, `name`, `type`. |
| `profiles` | One row per Supabase Auth user. `user_id` FK to `auth.users`, `email`, `name`, `global_role` (`reiwa_admin` \| `org_user` \| `investor_viewer`). |
| `organization_members` | `(org_id, user_id)` with `role` (`owner` \| `manager` \| `analyst` \| `viewer`). A `reiwa_admin` needs no membership row — `app.is_admin()` short-circuits. |

### Pipeline (`0002_pipeline.sql`)

**`portfolios`** — `org_id`, `name`, `country`, `currency`. Groups held assets.

**`properties`** — the neutral physical identity: `name`, `address`, `city`,
`country`, `market`, `asset_type`, `latitude`, `longitude`.

**`opportunities`** — the pre-acquisition canonical object.

| Field | Notes |
| --- | --- |
| `opportunity_id` | uuid pk |
| `org_id`, `property_id` | tenant + physical identity |
| `reference`, `name`, `market`, `submarket` | |
| `asset_type`, `strategy` | |
| `stage` | `new` \| `screening` \| `underwriting` \| `ic` \| `approved` \| `acquired` |
| `status` | `active` \| `rejected` \| `withdrawn` \| `lost` \| `converted` |
| `currency`, `target_price` | |
| `source`, `broker_name`, `vendor_name` | provenance |
| `size_sqft`, `size_sqm`, `passing_rent`, `erv` | |
| `niy`, `reversionary_yield`, `capex_budget` | |
| `target_irr`, `equity_multiple`, `probability` | |
| `summary`, `owner_user_id`, `created_by` | |
| `archived_at` | soft delete; preserves audit history |

`status` is orthogonal to `stage`, so an opportunity can be paused or lost at any
stage without losing its position.

**`investment_cases`** — the underwriting snapshot, versioned per opportunity
(`unique (opportunity_id, version)`), `status` `draft` → `approved`. Carries the
assumptions that flow into the asset: `acquisition_price`, `acquisition_date`,
`noi`, `occupancy_pct`, `erv`, `capex`, `debt`, `ltv_pct`, `valuation`,
`target_irr`, `target_equity_multiple`, `thesis`, `business_plan_assumptions`.
**Immutable once approved.**

**`transactions`** — the acquisition event: `opportunity_id`, `property_id`,
`investment_case_id`, `acquisition_price`, `acquisition_date`,
`acquisition_costs`, `equity_invested`, `debt`, `completed_at`.
**Immutable always.**

### Asset intelligence (`0003_asset_intelligence.sql`)

**`assets`** — the post-acquisition canonical object. Carries the full provenance
chain: `portfolio_id`, `property_id`, `opportunity_id`, `investment_case_id`,
`transaction_id`. Plus `name`, `lifecycle_stage`, `currency`, `acquisition_date`,
`acquisition_price`, `equity_invested`, `hold_thesis`, `is_demo`.

**`business_plans`** — `plan_type` (`underwriting` \| `approved` \|
`current_forecast`), `version`, `as_of_date`, and the metric set
(`gross_rental_income`, `noi`, `operating_expenses`, `occupancy_pct`, `capex`,
`valuation`, `yield_pct`, `debt`, `ltv_pct`, `cash_on_cash_pct`,
`equity_multiple`, `irr_pct`). The `underwriting` plan cannot be updated or
deleted.

**`performance_periods`** — actuals. `period_label`, `period_end`, `status`
(`draft` \| `closed`), same metric set. Closed periods are the audit record.

**`valuations`** — `valuation_date`, `valuer`, `valuation`, `valuation_type`,
`noi`, `yield_pct`, `erv`.

**`asset_risks`** — `title`, `category`, `description`, `probability`,
`financial_impact`, `severity`, `mitigation`, `owner`, `deadline`, `status`.

**`asset_decisions`** — `title`, `issue`, `recommendation`, `financial_impact`,
`decision_maker`, `deadline`, `status`.

### FX (`0004_fx.sql`)

**`fx_rates`** — `currency`, `rate_to_gbp`, `as_of_date`, `source`. The source and
date are surfaced on the portfolio screen. There is no fallback rate table in
application code: `portfolioAggregate` requires an explicit rate map and raises
rather than assume a missing currency.

### Investor portal (`0005`, `0006`)

| Table | Purpose |
| --- | --- |
| `investor_organizations` | External investor entity. `status`: `active` \| `suspended` \| `closed`. |
| `investor_contacts` | People at an investor organisation; each maps to an Auth user. |
| `investor_publications` | The investor-facing identity. `status`: `draft` \| `published` \| `withdrawn`. |
| `publication_sources` | **Admin-only** mapping publication → opportunity. The only place the relationship exists; projected by no investor-readable view. |
| `publication_versions` | Immutable published content. |
| `publication_version_sources`, `publication_documents` | Version content and attachments. |
| `publication_entitlements` | Which investor organisation may see which publication. |
| `investor_saved`, `investor_requests` | Investor-generated records. |
| `investor_activity_events` | Append-only engagement audit trail. |
| `investor_invites` | `token_hash` only — the SHA-256 of the raw token. Single-use, time-limited, revocable. The raw token exists in the invitation link and nowhere else. |

---

## 3. Opportunity stages (`opportunities.stage`)

1. `new` — logged
2. `screening` — initial fit / thesis
3. `underwriting` — investment case being built
4. `ic` — investment committee
5. `approved` — IC sign-off; the case is frozen
6. `acquired` — converted; an asset exists

`status` (`active` / `rejected` / `withdrawn` / `lost` / `converted`) runs
alongside.

**This is the only stage vocabulary.** A second one (`PipelineStage`,
`PIPELINE_STAGES`, `pipelineStageOf`) was removed in Phase 0.

---

## 4. Row-Level Security

See [`04-rls-and-types.md`](04-rls-and-types.md). In summary: RLS on every table,
predicates built from JWT claims through `app.is_admin()`, `app.has_org()`,
`app.can_write()`, and `anon` revoked everywhere.

---

## 5. Derived-value strategy

| Value | Source of truth | Where computed |
| --- | --- | --- |
| Asset snapshot (LTV, yield, IRR delta, valuation vs cost) | `business_plans` + `performance_periods` + `valuations` | `src/lib/asset-intelligence/metrics.ts`, computed on read |
| Portfolio aggregate | the asset set + `fx_rates` | `portfolioAggregate`, computed on read; explicit FX required |
| Investment Score overall + recommendation | category scores 1–10 × weights | `src/lib/scoring/model.ts` |
| DD progress | DD workstream statuses | `src/lib/dd/progress.ts` |

Derived values are **computed on read**, not persisted. The inputs are immutable
where it matters (approved case, underwriting plan, closed periods), so a figure
is reproducible from the record rather than from a cached copy that can silently
go stale.

The exception is deliberate: `publication_versions` freeze their content at
publication, because an investor must see exactly what was sent to them.
