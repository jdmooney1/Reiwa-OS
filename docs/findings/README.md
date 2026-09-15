# Findings

A log of defects where the system **presented an absence as a claim**: where a
gap in what Reiwa knew was rendered, stored or returned as though it were a
fact about the world.

This is the failure mode worth tracking separately from ordinary bugs. An
ordinary bug produces a wrong answer that somebody notices. These produce a
confident answer nobody can tell is hollow — a figure with no source, a
diligence finding from a document nobody opened, a null that reads as "there
was none" when it means "we did not record it". In an investment business the
cost is not a broken screen; it is a decision taken, or a number quoted to an
investor, on something that was never true.

## The pattern

Three shapes recur:

1. **Fabrication** — the system invents content and presents it as derived.
2. **Empty structure** — a container with no possible contents, rendered as
   though it merely happens to be empty today.
3. **Silent null** — a record that omits something, where the omission is later
   read as a negative fact.

## Register

| # | Date | Finding | Shape | Found by | Resolved |
| --- | --- | --- | --- | --- | --- |
| 1 | 2026-09-15 | The mock deal model | Fabrication | Product audit | `252bbe1` |
| 2 | 2026-09-15 | Eight phantom asset collections | Empty structure | Phase 0 inspection | `252bbe1` |
| 3 | 2026-09-15 | The memo generator | Fabrication | Phase 0 inspection | `252bbe1` |
| 4 | 2026-09-15 | The document "AI ingestion" engine | Fabrication | Phase 0 inspection | `252bbe1` |
| 5 | 2026-09-15 | Publication provenance captured only approved underwriting | Silent null | Phase 1A self-review | `eae7249` |

> **On entries 1–4.** This log did not exist when they were found; it is created
> with entry 5. The four are real and were each documented at the time, but in
> the phase documents rather than here, so the rows above are reconstructed from
> that record — `docs/02`, `docs/07`, `docs/08`, `docs/09` and commit `252bbe1`
> — not copied from a prior register. They are summarised below for continuity.
> Entry 5 is the first written as it happened.

---

## 1 · The mock deal model

`/deals/[dealId]` rendered a complete deal file — overview, financials,
diligence, risks, score, documents, contacts, decisions, memo — entirely from
`src/lib/mock-data.ts`. It never read the database and never wrote one. The
accompanying `Database` interface in `src/types/database.ts` declared tables
named `deals`, `risks`, `contacts`, `documents`, `investment_scores` and
`decision_log`, **none of which had ever been created in any migration**.

The type layer made it worse rather than better: it type-checked, it read like a
contract, and it licensed the screen to look persistent.

See `docs/02-data-model.md`, `docs/10-persistence-gate.md`.

## 2 · Eight phantom asset collections

`AssetFile` declared `leases`, `capex`, `developments`, `milestones`, `loans`,
`advisers`, `actions` and `events`. No table existed for any of them, and
`assembleOne()` hardcoded all eight to `[]`. Eight of the ten asset tabs then
rendered a card reading *"the data model and demonstration records already
exist for this module; the interface is delivered in Phase N."*

That sentence was false in both halves. This is the clearest case of shape 2: a
roadmap dressed as a disabled feature, which invites somebody to sell a
capability that does not exist.

See `docs/09-asset-intelligence.md`.

## 3 · The memo generator

`src/lib/memo/generate.ts` composed investment-committee prose from
`DealNarrative` — a hand-written thesis, rationale, business plan and open
questions attached to exactly one mock deal. For any other opportunity it had no
content at all, yet still produced a confident, well-formatted memo.

A memo is the document a committee commits capital on. The 17-section structure
was real and was preserved; the prose was not.

See `docs/07-memo-generator.md`.

## 4 · The document "AI ingestion" engine

`generateExtraction(category, deal)` returned hardcoded strings selected by a
`switch` on the document category, interpolating a few of the deal's figures for
plausibility. It never read a file. Its output appeared under *summary, key
facts, financial figures, lease terms, risks, missing information, follow-up
questions*, wrapped in a simulated processing delay, and one click turned those
invented findings into live diligence workstreams and risks.

So a lease nobody had read produced a confident list of lease terms. This was
the most dangerous of the four, because the output was actionable.

See `docs/08-document-vault.md` §3.

---

## 5 · Publication provenance captured only approved underwriting

See [`2026-09-15-publication-provenance.md`](2026-09-15-publication-provenance.md).
