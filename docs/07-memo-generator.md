# 07 · Investment Memo

A **structured memo**, not a chatbot: a document assembled from the opportunity's own
record — the investment case, DD tracker, risks, score and documents — into 17 sections
with four output formats.

> **Status after Phase 0.**
>
> | | |
> | --- | --- |
> | **Exists today** | Nothing. There is no memo screen, no memo table, and no generator. |
> | **Reusable domain logic** | `src/lib/memo/sections.ts` — the 17-section spine, stable section keys, labels, and the four output-format definitions. Pure, mock-free, kept intact. |
> | **Phase 1 must build** | A `memos` table keyed on `opportunity_id`, the composition layer, and the editor. |
>
> **The generator was deleted, deliberately.** `src/lib/memo/generate.ts` composed
> its prose from `DealNarrative` — a hand-written thesis, strategic rationale,
> business plan and open questions attached to exactly one mock deal. Its output
> read like analysis and was nothing of the kind: for any opportunity other than
> 58 Queens Gate it had no content to work from at all.
>
> A memo is the document a committee commits capital on. A placeholder that emits
> confident, well-formatted, fabricated reasoning is the single most dangerous
> thing in this codebase, and it was removed rather than carried forward. The
> section structure below is real and worth keeping; the prose was not.

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

## What Phase 1 must build

**Composition.** Each section should be composed from fields that exist:

| Section | Source |
| --- | --- |
| Key Metrics | `opportunities` + the approved `investment_case` |
| Financial Analysis, Capex Plan | `investment_cases` |
| Risk and Mitigation | the risk register, ranked, plus flagged DD issues |
| Further DD Required | open DD workstreams grouped by section |
| FX Sensitivity | opportunity currency, `fx_rates`, and hedging workstreams |
| Recommendation | the Investment Score and its flagged categories |

Sections with no underlying data should be **empty and visibly so**, never filled
with plausible prose. An author can tell the difference between a blank section and
a wrong one; a reader of the finished memo cannot.

**Persistence.** A `memos` table keyed on `opportunity_id`, with `content` as
structured sections, `version` and `status` (`draft` | `final`). A finalised memo
should be immutable for the same reason an approved investment case is: it is the
document the decision was made on.

**Authoring.** Section navigation, an editor per section, format selection and
export. Human-edited text and composed text should be distinguishable in the record.

## If an LLM is wired in later

Keep the provenance discipline already used in Asset Intelligence
([`09-asset-intelligence.md`](09-asset-intelligence.md)): every statement tagged
**fact · calculation · forecast · assumption · commentary**, and model-authored text
marked as commentary rather than presented as source data.

Deterministic composition from real fields comes first and stands on its own. A model
may improve the prose over that foundation; it may not be the foundation.
