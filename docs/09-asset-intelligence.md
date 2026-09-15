# 09 · Asset Intelligence

The post-acquisition operating layer of Reiwa OS. It answers four questions for an
investor — what we underwrote, what is happening now, what changed, and what needs
attention — by turning fragmented asset-management information into structured
investment intelligence. It is **not** a property-management database or a file
repository.

> **Status after Phase 0.**
>
> | | |
> | --- | --- |
> | **Exists today** | `/portfolio` and `/assets/[assetId]` with two tabs — Overview and Performance. Both read from Postgres under RLS. The underwriting / forecast / actual comparison is real. |
> | **Reusable domain logic** | `src/lib/asset-intelligence/metrics.ts` (snapshot, three-way variance, portfolio aggregation), `ai.ts` (provenance-tagged brief), `labels.ts`, and the shared `VarianceValue` component. |
> | **Phase 1+ must build** | A schema before a screen, for every module in the roadmap below. |
>
> **Eight tabs were removed.** Leasing, CapEx / Development, Valuation, Financing,
> Risks, Decisions, Advisers & Actions and Reporting each rendered a card stating
> *"the data model and demonstration records already exist for this module; the
> interface is delivered in Phase N."*
>
> That was false. There is no `leases`, `capex_items`, `development_projects`,
> `milestones`, `loans`, `advisers`, `asset_actions` or `asset_events` table in any
> migration, and `assembleOne()` hardcoded all eight collections to `[]`. A roadmap
> presented as a disabled feature is worse than an absent one: it invites someone to
> sell a capability that does not exist, and it makes the product look thin in nine
> places instead of complete in two.
>
> Each tab returns when the module behind it genuinely exists.

## Lifecycle & the persistent asset

```
opportunity → investment_case → transaction → asset → (exit)
```

A single **`asset_id`** persists from acquisition onward. The asset carries its full
provenance — `opportunity_id`, `investment_case_id`, `transaction_id`,
`property_id` — so the system compares **Original Underwriting vs Current Forecast vs
Actual** without duplicating the property.

The comparison reads across `business_plans` (immutable underwriting baseline plus
the latest forecast) and `performance_periods` (actuals). History is never
overwritten: the underwriting plan, the approved investment case and the transaction
are all immutable by trigger, and closed periods are the audit record.

`Asset.source_opportunity_id` names the opportunity it was converted from. (It was
`source_deal_id` until Phase 0, pointing at a model that no longer exists.)

## Multi-tenant architecture

```
organizations → organization_members → portfolios → assets
```

Every asset-scoped table denormalises `org_id`, and org-scoped RLS
(`app.has_org(org_id)`) means an organisation sees only its own assets. Built into
these tables from the first migration — see [`04-rls-and-types.md`](04-rls-and-types.md).

## Schema that exists (`0003_asset_intelligence.sql`)

`assets`, `business_plans` (versioned; `underwriting` immutable),
`performance_periods` (immutable once closed), `valuations`, `asset_risks`,
`asset_decisions`.

That is the complete list. Full column detail is in
[`02-data-model.md`](02-data-model.md).

## Navigation & routes

Sidebar section **Asset Intelligence** → `/portfolio` and `/assets/[assetId]`.

The asset page has two tabs:

- **Overview** — snapshot strip, three-way comparison, decisions required,
  highest-priority risks, and the provenance-labelled brief.
- **Performance** — closed actuals periods against plan, with variance, and the
  action to record a period.

## FX

Portfolio totals are converted to a GBP reporting currency using rates read from
`fx_rates`, with the **source and date shown on the screen**.

`portfolioAggregate(files, rates, reportingCurrency)` requires the rate table and
raises on a missing currency. Phase 0 removed a `DEMO_FX_TO_GBP` constant that acted
both as a default argument and as a per-currency `?? 1` backstop inside `rateOf` —
the latter would have valued a yen position as sterling, roughly a 190x
overstatement, on the one screen whose job is to state what the portfolio is worth.

A wrong number that renders is worse than a page that fails, because nobody can see
it is wrong. Rates are still static and still need a live feed; what they no longer
have is a silent fallback.

## AI intelligence layer (provenance-first)

`ai.ts` answers three structured questions — **what changed · why it matters · what
needs attention** — and every statement is tagged with provenance: **fact ·
calculation · forecast · assumption · commentary**. Today it emits only facts and
calculations derived deterministically from structured data. Model-authored
*commentary* plugs into the same interface when it arrives. AI inference is never
presented as source data.

A fourth question, *what's next*, was removed in Phase 0: it was built entirely from
the non-existent `asset_events` collection and could only ever return nothing. It
returns when there is an event model to answer it.

Intelligence hierarchy (not reversed): **Portfolio** (where to focus) → **Asset
Intelligence** (why) → **structured data** (evidence) → **documents** (source) →
**AI** (interpretation).

## Demonstration data (`is_demo = true`)

Two assets, seeded through the real lifecycle chain by
`src/lib/db/fixtures/demo-assets.ts` — property → opportunity → approved case →
transaction → asset → plans, periods, valuations, risks, decisions. They exist in
Postgres under the same constraints and the same RLS as a real asset, which is the
point: a fixture that takes a shortcut around the schema proves nothing.

- **16 Conduit Street, Mayfair** — operating mixed-use; the three-way comparison
  shows office-vacancy-driven NOI and IRR drift against underwriting, with a
  required leasing-incentive decision.
- **Herengracht 472, Amsterdam** — value-add / redevelopment; budget-versus-forecast
  overrun and a required revised-budget decision.

Figures are realistic illustrations, not real transactions. The fixture previously
also carried leases, capex, developments, milestones, loans, advisers, actions and
events; the seeder silently dropped all of it, because no such tables exist. That
data was removed in Phase 0.

## Roadmap

Each item needs **a table and a migration before a tab**. The order below is by
dependency, not by ambition.

| Module | Needs |
| --- | --- |
| **Leasing** | `leases` — tenant, unit, term, break, review, passing rent, ERV, incentives, status |
| **Operating CapEx** | `capex_items` — budget / approved / committed / spent / forecast / variance |
| **Development** | `development_projects` + `milestones` — programme, workstreams, baseline vs forecast dates |
| **Financing** | `loans` — terms, hedging, covenants (LTV / ICR / debt yield), maturity |
| **Valuation history** | exists (`valuations`); needs a screen and a movement bridge |
| **Risks & Decisions** | exists (`asset_risks`, `asset_decisions`); currently surfaced on Overview, needs dedicated registers |
| **Advisers & Actions** | `advisers` + `asset_actions`, linked to risks and decisions |
| **Events / timeline** | `asset_events` — the model `upcomingEvents` was written against |
| **Reporting** | monthly / quarterly / annual / IC reports from the same dataset |

Valuation, Risks and Decisions are the cheapest three: the data is already there.
