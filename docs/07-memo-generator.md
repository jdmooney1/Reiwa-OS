# 07 · AI Investment Memo Generator

A **structured memo generator**, not a chatbot. It composes investment-memo prose by
reading the deal file — deal data, financial metrics, DD tracker, risk register,
investment score and documents — and templating it into 17 sections. The AI calls are
**placeholders** today: deterministic composers in `src/lib/memo/generate.ts` with the
same signatures an LLM backend would use, so the editor and actions don't change when a
model is wired in.

## Sections (17)

Executive Summary · Key Metrics · Investment Thesis · Asset Overview · Location and
Market · Income and Tenancy · Business Plan · Financial Analysis · Capex Plan ·
Planning, Heritage, ESG · Japan Investor Rationale · Tax and Structuring Considerations ·
FX Sensitivity · Risk and Mitigation · Exit Strategy · Recommendation · Further DD
Required.

Each section is generated from real fields — e.g. *Key Metrics* from the deal +
`deal_metrics`; *Risk and Mitigation* from the risk register (ranked by score) plus
flagged DD issues; *Further DD Required* from open DD workstreams grouped by section;
*FX Sensitivity* from the deal currency, FX risks and hedging workstreams.

## Actions (`src/lib/memo/generate.ts`)

| Action | Result |
| --- | --- |
| Generate first draft | Composes all 17 sections (+ Japanese summary) |
| Regenerate section | Recomposes the active section |
| Summarise risks | Fills *Risk and Mitigation* and navigates to it |
| IC recommendation | Fills *Recommendation* from score + flagged risks/issues |
| Japanese investor summary | Generates the 日本語 summary and switches to that format |
| Broker question list | Side panel of questions from open commercial/vendor items + data gaps |
| DD request list | Side panel of outstanding DD workstreams as requests |

## Output formats

- **Internal IC Memo** — all 17 sections.
- **Investor Teaser** — Executive Summary, Key Metrics, Asset Overview, Location,
  Thesis, Business Plan, Exit.
- **One-Page Asset Snapshot** — Executive Summary, Key Metrics, Asset Overview.
- **Japanese Language Summary** — a single 日本語 investor summary.

`assembleDocument()` joins the selected sections for copy/export.

## Editor (Deal → Memo tab)

Three panes: **left** section navigation (with drafted indicators), **centre** the
content editor (editable textarea, per-section regenerate, word count) — replaced by a
side-output view for broker/DD lists — and **right** the AI actions. The format
selector and Copy / (disabled) PDF export sit in the toolbar.

## Wiring a real model later

Replace the bodies of the exported functions in `generate.ts` with LLM calls (passing
the same `DealFile` context). The functions are already async-wrapped in the UI
(`withDelay`), so swapping in a network call requires no UI change. Keep the
deterministic composers as the prompt context / fallback.
