# 07 · Investment Memo

A **structured memo**, not a chatbot: a document assembled from the opportunity's own
record — the investment case, DD tracker, risks, score and documents — into 17 sections
with four output formats.

> **Status after Phase 1.**
>
> | | |
> | --- | --- |
> | **Exists today** | A `memos` table (migration 0023), a pure composition module (`src/lib/memo/compose.ts`), a Memo tab on the opportunity workspace, and a print view. |
> | **Reusable domain logic** | `src/lib/memo/sections.ts` - the 17-section spine and four output formats. Unchanged. |
> | **Still not built** | Any language-model drafting, a rich-text editor, a PDF library, machine translation. See "Not in Phase 1". |
>
> **The first generator was deleted, deliberately.** `src/lib/memo/generate.ts` composed
> its prose from `DealNarrative` - a hand-written thesis, strategic rationale,
> business plan and open questions attached to exactly one mock deal. Its output
> read like analysis and was nothing of the kind: for any opportunity other than
> 58 Queens Gate it had no content to work from at all.
>
> A memo is the document a committee commits capital on. A placeholder that emits
> confident, well-formatted, fabricated reasoning is the single most dangerous
> thing in this codebase, and it was removed rather than carried forward. The
> Phase 1 composer exists under that warning: **every section is composed
> deterministically from real rows, or it is empty and says so.**

## Sections (17)

Executive Summary · Key Metrics · Investment Thesis · Asset Overview · Location and
Market · Income and Tenancy · Business Plan · Financial Analysis · Capex Plan ·
Planning, Heritage, ESG · Japan Investor Rationale · Tax and Structuring Considerations ·
FX Sensitivity · Risk and Mitigation · Exit Strategy · Recommendation · Further DD
Required.

Section keys are stable (`MemoSectionKey`); labels and ordering live in
`src/lib/memo/sections.ts`.

## Output formats

| Format | Sections |
| --- | --- |
| **Internal IC Memo** | all 17 |
| **Investor Teaser** | Executive Summary, Key Metrics, Asset Overview, Location and Market, Investment Thesis, Business Plan, Exit Strategy |
| **One-Page Asset Snapshot** | none of the prose sections: a purpose-built landscape data grid (see below) |
| **Japanese Language Summary** | a single 日本語 investor summary, handled specially |

Defined as `OUTPUT_FORMATS` / `FORMAT_BY_KEY`.

## How Phase 1 works

**Composition** (`src/lib/memo/compose.ts`, pure, no server imports). A section is
`composed` or `empty`. An empty one carries a reason that names what is missing and what
would create it. The only words a composed section contains are labels the module owns
and text a person already wrote into a record (an underwriting thesis, a diligence
finding, a risk's mitigation), carried verbatim and attributed to its source.

| Section | Source |
| --- | --- |
| Executive Summary | none - written by hand, always empty until it is |
| Key Metrics | the approved `investment_cases` row; else the `current` one, flagged "Based on unapproved underwriting"; else empty |
| Investment Thesis, Business Plan | `thesis` / `business_plan_assumptions` of that case, verbatim, **internal**: shown in the IC memo, empty in the Teaser and Snapshot until overridden |
| Asset Overview, Location and Market | `opportunities` / `properties`: name, type, strategy, size, market, submarket, city, country |
| Income and Tenancy | the case's income fields, plus income and covenant diligence |
| Financial Analysis, Capex Plan | the case's figures; capex also from capex diligence |
| Exit Strategy | hold period, exit value and yield from the case; exit diligence. There is no exit text field |
| Planning/Heritage/ESG, Japan Rationale, Tax and Structuring | their **diligence workstreams** (status, finding, resolution). No dedicated schema exists for these |
| FX Sensitivity | deal currency, the `fx_rates` row **with its source**, and the currency-risk diligence workstreams. There is no hedge data; the section says so. A rate more than 30 days old is flagged with its age ("This rate is N days old"), measured against the date the memo is composed on |
| Risk and Mitigation | the risk register ranked by severity then impact, plus flagged diligence issues not yet promoted |
| Recommendation | the newest **complete** Investment Score ([`06`](06-investment-score.md)) and the investment committee's **recorded** decision, side by side. Neither overwrites the other; if only one exists the section says so, and if neither does it says what to record. Internal audience only |
| Further DD Required | open diligence workstreams grouped by section |

**What a memo can see.** `MemoSource` is a whitelist. It has no coordinates, no geocode,
no broker or vendor, no source contact and no triage note, and **the seventeen prose
sections can see no street address and no photograph.** A memo is a document that gets
forwarded, and the location pin and photographs are diligence-tier for an investor
(migrations 0018, 0020): a memo must not be the way round that. Tests hold the line.

**The one exception: the Asset Snapshot** (decision: JD). It is a branded one-pager that
staff review and then send themselves, and it carries the street address and a
photograph. Those travel in one named object, `MemoSource.asset`, read only by
`composeSnapshot()` and loaded only by `src/lib/data/snapshot-source.ts`; the boundary
tests allow-list exactly those declarations. The photograph follows the investor teaser
card's rule: only a photo staff have cleared as `diligence`, headline first, then gallery
order; an `internal` photo is never used. Finalising a Snapshot tells the person it
carries the address and a photograph, which the portal shows an investor only at the
diligence tier.

## The One-Page Asset Snapshot

Reiwa Capital's bilingual (EN/JA) landscape A4 sheet, composed as `ComposedMemo.snapshot`
and drawn by `src/components/memo/asset-snapshot.tsx` (one component for the workspace and
the print view). Printed through the browser's own print dialog, set to landscape, like
the other formats.

| Template field | Source |
| --- | --- |
| Price Guidance | the basis case's `acquisition_price` (not the valuation); the opportunity's projection of it only when there is no case |
| JPY Equivalent | price x the deal currency's `rate_to_gbp` / the JPY `rate_to_gbp` (`convertViaGbp`); none for a yen deal |
| NIY, Passing Rent, ERV, Occupancy, Capex | the basis case (`entry_yield_pct`, `gross_rental_income`, `erv`, `occupancy_pct`, `capex`) |
| Total Area | the opportunity's sq ft and sq m; tsubo is sq m / 3.30578 (`src/lib/units.ts`) |
| Address, City, Country, Submarket, Asset Type, Ref | `properties` and `opportunities` |
| Photograph | a `diligence`-cleared `property_photos` row (above) |
| Value allocation, Depreciation Basis | the case's `land_value`, `building_value`, `depreciation_years` (migration 0027). Building % = building / (land + building); the annual charge is building / years, straight-line, converted to yen like the price. All **derived on read, never stored** (`src/lib/underwriting/allocation.ts`). Absent until land AND building are entered; the depreciation cell is absent until a life is |
| FX footer | the stored rates with their source and date, and `This rate is N days old.` when the oldest used is past 30 days |

**What is not shown, and why.** Nothing the record cannot back: WAULT, every Property
Facts and Property Notes row, transport and the map have no source. **Reversionary yield is not
shown either**: the opportunity's `reversionary_yield` column is a copy of the case's
*exit* yield (migration 0009), a different quantity, and printing it under that name
would state a number nobody underwrote. A printed copy drops each missing cell and closes
the grid up; the workspace shows "Not yet captured" in its place and lists what is
missing. Neither ever shows the template's bracketed placeholder text or "TBC"
(`tests/unit/asset-snapshot.test.ts`).

**Audience.** Every block is `external` or `internal`. The Investor Teaser and the
One-Page Snapshot show external blocks only (price, targets, market, asset type, size,
strategy under Asset Overview, hold and exit figures). Financing structure, income
detail, diligence findings and the risk register appear in the Internal IC Memo only.
**So do the underwriting's Investment Thesis and Business Plan text**: it is written in
committee voice (hedges, candid risk framing, negotiating reasoning), so in the external
formats those two sections are empty until a person writes an investor-facing version in
the override box. A person's own override text is shown in every format because they
chose to write it. No composed prose block is external; external prose comes only from an
override.

**Persistence** (`memos`, migration 0023). `content` is the composed snapshot
(structured data, a copy and not a live join); `overrides` is per-section human text
keyed by section, kept apart so composed and typed text stay distinguishable. A revision
is a new row (`version + 1`), at most one draft per opportunity. A **final memo is
immutable in the database** (`app.guard_memo`): no update, no delete, and a draft becomes
final by one update that changes only the status stamp. A later underwriting revision
does not change it.

**Authoring and export.** Format selector (one record, four lenses), per-section
composed / edited / empty state, a plain textarea per section, Recompose (keeps the
text), Finalise (confirm, irreversible). Export is a print-optimised page that the
browser prints to PDF: no PDF library. A draft prints with a DRAFT banner; empty sections
print as "No data recorded".

**Japanese Language Summary** is one hand-written text under its own key, with the
English figures shown beside it to work from. It is never machine-translated.

## Not in Phase 1

- **A language model.** Out of scope.
- **Machine translation.** A wrong translation of an investment term is a worse failure
  than no translation. A decision for a later phase.
- **A rich-text editor.** Per-section plain textareas.
- **Typeset PDF.** Revisit once a real Teaser has been seen printed.
- **Street address or map in a memo.** Deliberately absent; see "What a memo can see".

## If an LLM is wired in later

Keep the provenance discipline already used in Asset Intelligence
([`09-asset-intelligence.md`](09-asset-intelligence.md)): every statement tagged
**fact · calculation · forecast · assumption · commentary**, and model-authored text
marked as commentary rather than presented as source data.

Deterministic composition from real fields comes first and stands on its own. A model
may improve the prose over that foundation; it may not be the foundation.
