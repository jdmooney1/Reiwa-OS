# 02 · Data Model

> Proposed domain model for Reiwa OS. The concrete DDL lives in
> [`../supabase/schema.sql`](../supabase/schema.sql); this document explains the
> reasoning and relationships.

---

## 1. Aggregate overview

The **deal** is the root aggregate. Each deal owns one asset snapshot, one financial
profile, and many child records. Contacts and profiles are shared reference data.

```
profiles (Clerk users)
   │
   │ created_by / owner
   ▼
deals ──────────────────────────────────────────────┐
   │ 1:1     assets            (Asset Snapshot)       │
   │ 1:1     deal_financials   (Financial Metrics)    │
   │ 1:many  dd_items          (Due Diligence)        │
   │ 1:many  risks             (Risk Register)        │
   │ 1:1     investment_scores (Investment Score)     │
   │ 1:many  documents         (Document Vault)       │
   │ many:many contacts via deal_contacts             │
   │ 1:many  deal_activity     (Audit log)            │
   │ 1:many  memos             (Investment Memo)      │
   └──────────────────────────────────────────────────┘
```

Design choices:

- **Asset & financials are 1:1 tables, not columns on `deals`.** Keeps the `deals`
  row lean for pipeline queries and lets each module evolve independently. (A deal can
  later hold multiple assets — a portfolio — by relaxing the unique constraint.)
- **Numeric money stored as `numeric(18,2)`**, never floats. Currency held per deal.
- **Enums in Postgres** for stage, market, asset type, DD status, risk severity — they
  power the pipeline board and keep values consistent. Mirrored in `src/lib/constants`.
- **Soft delete** via `archived_at` on `deals` rather than hard deletes, to preserve
  audit history.

---

## 2. Entities

### `profiles`
Mirror of Clerk users. `id` = Clerk `sub`. Holds `full_name`, `email`, `role`
(`founder` | `analyst` | `adviser`), `avatar_url`. Synced via Clerk webhook.

### `deals` — Deal Pipeline + Deal Detail
The core record.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `reference` | text | Human deal code, e.g. `RC-LON-0042` |
| `name` | text | Working name |
| `market` | enum `market` | `london` \| `amsterdam` |
| `asset_class` | enum `asset_class` | office, residential, retail, … |
| `stage` | enum `deal_stage` | sourced → closed (see §3) |
| `status` | enum `deal_status` | `active` \| `on_hold` \| `dead` \| `completed` |
| `currency` | enum `currency` | `GBP` \| `EUR` |
| `target_price` | numeric(18,2) | Headline asking / target |
| `owner_id` | fk profiles | Lead analyst |
| `source` | text | Broker / off-market / direct |
| `sourced_at` | date | |
| `summary` | text | One-paragraph thesis |
| `archived_at` | timestamptz null | Soft delete |
| `created_by`, `created_at`, `updated_at` | | Audit |

### `assets` — Asset Snapshot (1:1 with deal)
Physical property facts: `address_line`, `city`, `postcode`, `country`, `latitude`,
`longitude`, `tenure` (freehold/leasehold), `total_area_sqm`, `nia_sqm`, `gia_sqm`,
`year_built`, `units_count`, `occupancy_pct`, `walt_years` (weighted avg lease term),
`epc_rating`, `condition_notes`.

### `deal_financials` — Financial Metrics (1:1 with deal)
Inputs and a curated set of derived metrics. Derived values are computed by pure
functions in `src/lib/finance` and persisted for fast pipeline display / memo export.

Inputs: `purchase_price`, `acquisition_costs`, `gross_dev_value`, `net_operating_income`,
`gross_rental_income`, `equity_invested`, `debt_amount`, `interest_rate_pct`,
`hold_period_years`, `exit_yield_pct`.

Derived (stored): `net_initial_yield_pct`, `gross_yield_pct`, `ltv_pct`, `dscr`,
`levered_irr_pct`, `unlevered_irr_pct`, `equity_multiple`, `cash_on_cash_pct`,
`price_per_sqm`.

### `dd_items` — Due Diligence Tracker (1:many)
| Field | Notes |
| --- | --- |
| `category` | enum `dd_category` — legal, financial, technical, commercial, tax, esg |
| `title`, `description` | |
| `status` | enum `dd_status` — `not_started` \| `in_progress` \| `complete` \| `flagged` \| `na` |
| `assignee_id` | fk profiles |
| `due_date` | |
| `completed_at`, `notes` | |

Seeded from category templates in `src/lib/constants` when a deal enters DD.

### `risks` — Risk Register (1:many)
`category` (market, tenant, structural, legal, financial, regulatory, esg, fx),
`title`, `description`, `likelihood` (1–5), `impact` (1–5), `severity` (derived /
stored band: low/medium/high/critical), `mitigation`, `owner_id`, `status`
(`open` | `mitigated` | `accepted` | `closed`). Drives a 5×5 risk matrix in the UI.

### `investment_scores` — Investment Score (1:1 with deal)
A weighted multi-criteria score. Stores per-pillar sub-scores plus the weighting model
used, so a score is always reproducible.

Pillars (0–100 each): `location_score`, `asset_quality_score`, `cashflow_score`,
`risk_score`, `return_score`, `esg_score`. Plus `weights` (jsonb), `total_score`
(0–100 derived), `recommendation` (enum: `pursue` | `hold` | `pass`), `rationale`.

### `documents` — Document Vault (1:many)
Metadata for files in Supabase Storage. `storage_path`, `bucket`, `category` (enum:
legal, financial, technical, marketing, valuation, correspondence, other), `file_name`,
`mime_type`, `size_bytes`, `version`, `uploaded_by`, `uploaded_at`. Files live in a
private bucket; access via short-lived signed URLs generated server-side.

### `contacts` — Contacts (shared directory)
`full_name`, `company`, `role_title`, `type` (enum: broker, vendor, lawyer, lender,
valuer, investor, adviser, other), `email`, `phone`, `notes`. Linked to deals through
`deal_contacts`.

### `deal_contacts` — join (many:many)
`deal_id`, `contact_id`, `relationship` (e.g. "selling agent", "acquisition lawyer").

### `deal_activity` — Audit log (1:many)
`deal_id`, `actor_id`, `action` (enum: created, stage_changed, score_updated,
document_added, dd_updated, risk_added, note, …), `detail` (jsonb), `created_at`.
Powers the deal Overview timeline and IC governance trail.

### `memos` — Investment Memo (1:many, later phase)
`deal_id`, `title`, `content` (jsonb / structured sections), `version`, `status`
(`draft` | `final`), `generated_pdf_path`, `created_by`. Memo export is a later phase;
the table is included now so the schema is forward-compatible.

---

## 3. Deal pipeline stages (`deal_stage` enum)

Ordered lifecycle, used for the pipeline board columns and stage-gate logic:

1. `sourced` — opportunity logged
2. `screening` — initial fit / thesis
3. `underwriting` — financial modelling
4. `due_diligence` — DD tracker active
5. `ic_review` — investment committee
6. `approved` — IC sign-off (founder only)
7. `closed` — acquired / completed
8. `rejected` — passed / dead (with reason)

`status` (`active`/`on_hold`/`dead`/`completed`) is orthogonal to `stage` so a deal can
be paused at any stage without losing position.

---

## 4. Row-Level Security model

- All application tables have RLS enabled.
- A helper `current_profile_id()` returns `auth.jwt() ->> 'sub'`.
- **MVP policy:** authenticated internal users (`founder`, `analyst`) can read and write
  all deals and children — Reiwa Capital is one small trusted team. Writes that change
  `stage` to `approved` are additionally gated to `founder` (enforced in server action;
  policy backstop optional).
- **External phase:** add a `deal_access` table (`deal_id`, `profile_id`, `level`) and
  tighten policies so an `adviser` sees only deals they are granted, read-mostly.

This keeps MVP simple while leaving a clean path to per-deal external access.

---

## 5. Derived-value strategy

| Value | Source of truth | Where computed |
| --- | --- | --- |
| Financial metrics (IRR, NIY, LTV, DSCR…) | inputs on `deal_financials` | `src/lib/finance` pure fns; persisted on save |
| Risk severity | likelihood × impact | `src/lib/risks`; stored band |
| Investment total score | pillar scores × weights | `src/lib/scoring`; stored |

Derived values are **persisted** (not just computed on read) so the pipeline grid and
memo export stay fast and a memo reflects the numbers as they were at sign-off. Recompute
on every relevant write.
