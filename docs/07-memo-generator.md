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
| **One-Page Asset Snapshot** | Executive Summary, Key Metrics, Asset Overview |
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
| Investment Thesis, Business Plan | `thesis` / `business_plan_assumptions` of that case, verbatim |
| Asset Overview, Location and Market | `opportunities` / `properties`: name, type, strategy, size, market, submarket, city, country |
| Income and Tenancy | the case's income fields, plus income and covenant diligence |
| Financial Analysis, Capex Plan | the case's figures; capex also from capex diligence |
| Exit Strategy | hold period, exit value and yield from the case; exit diligence. There is no exit text field |
| Planning/Heritage/ESG, Japan Rationale, Tax and Structuring | their **diligence workstreams** (status, finding, resolution). No dedicated schema exists for these |
| FX Sensitivity | deal currency, the `fx_rates` row **with its source**, and the currency-risk diligence workstreams. There is no hedge data; the section says so |
| Risk and Mitigation | the risk register ranked by severity then impact, plus flagged diligence issues not yet promoted |
| Recommendation | the investment committee's **recorded** decision. The Investment Score model stores no scores per opportunity, so none is shown |
| Further DD Required | open diligence workstreams grouped by section |

**What a memo can see.** `MemoSource` is a whitelist. It has no street address, no
coordinates, no geocode, no photographs, no broker or vendor, no source contact and no
triage note. A memo is a document that gets forwarded, and the location pin and
photographs are diligence-tier for an investor (migrations 0018, 0020): a memo must not
be the way round that. Tests hold the line.

**Audience.** Every block is `external` or `internal`. The Investor Teaser and the
One-Page Snapshot show external blocks only (price, targets, market, asset type, size,
strategy, hold, exit figures). Financing structure, income detail, diligence findings and
the risk register appear in the Internal IC Memo only. A person's own override text is
shown in every format because they chose to write it. Underwriting thesis and business
plan text is external by the format definition but is the analyst's text as written, so
finalising an external format asks the person to confirm it is fit to leave the building.

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
- **Investment Score in the Recommendation.** No scores are stored; the committee's
  recorded decision is used instead.

## If an LLM is wired in later

Keep the provenance discipline already used in Asset Intelligence
([`09-asset-intelligence.md`](09-asset-intelligence.md)): every statement tagged
**fact · calculation · forecast · assumption · commentary**, and model-authored text
marked as commentary rather than presented as source data.

Deterministic composition from real fields comes first and stands on its own. A model
may improve the prose over that foundation; it may not be the foundation.
