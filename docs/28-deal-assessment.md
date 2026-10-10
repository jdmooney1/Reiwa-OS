# 28 · Deal assessment: the engine, and a written view over it

Every opportunity now has an **Assessment** tab. It runs the same underwriting and
stress-testing that the Mutual House memorandum (October 2026) was built on, for any
deal in the pipeline, and records each run beside the underwriting.

Two halves, kept apart on purpose:

| | What it is | Who produces it |
| --- | --- | --- |
| **The model** | Monthly cash flow, after UK/local tax, Reiwa fees and the yen hedge; scenarios, single-factor sensitivities, 5 to 50-year holds, break points, price for a target return | Deterministic code, `src/lib/underwrite` |
| **The assessment** | Verdict, strengths and concerns, an evidence register rating every input, proposed terms, committee questions, data gaps | A model, against a closed schema |

The rule from `docs/07` and `docs/21` holds: **every figure is computed by code from
named inputs.** The assessment's schema has no field that can carry a result. The
only numbers it may write are five *levers* (price factor, deferred share, months of
extra guarantee, months of rent top-up, acquisition fee). They are inputs: the engine
prices them before the run is stored, and the tab shows the engine's figures for them.
A unit test pins that list. Prose can still carry a figure the schema cannot, so
`figures.ts` checks every percentage, amount and multiple in the written fields against
what the model was shown; any that match nothing are listed on the tab as the writer's,
not the model's.

## Two tiers, decided by the data

| Tier | When | How income is modelled |
| --- | --- | --- |
| **Lease by lease** | The investment case carries a rent roll (`assumptions.rentRoll`) | Every unit: expiry, break, review (upward-only or open market), vendor guarantee, re-letting with void, incentive and fit-out, renewal probability |
| **Screening** | No rent roll, but a price and an income | Income split into three tranches expiring at half, one and one-and-a-half times the WAULT, re-let at ERV |

A screening run says on the tab, and in the assessment's instructions, that it is not
a basis for a bid. Nothing chooses the tier but whether the rent roll exists.

The engine needs a price and some measure of income (gross rent, NOI, passing rent or a
quoted NIY). Without them it refuses and names what is missing.

## Where every input comes from

Precedence: **investment case → rent roll → property record → opportunity → FX table →
dated market default** (`src/lib/underwrite/defaults.ts`, October 2026). Every input is
stored with its source and basis, and a default is shown as "Default" in the
assumptions table, so a default can never pass for evidence. The assessment rates each
input high / medium / low and says how to confirm it.

Analysts set a deal's own figures when they revise the underwriting, in a new
collapsible block on the version form:

- **Rent roll (CSV).** Header row first; columns `unit, tenant, use, area_sqft, rent_pa,
  expiry, break, review_date, review_basis, erv_pa, erv_psf, guarantee_until,
  relet_capex_psf, renewal_pct`. The whole table is refused, with every problem listed
  by row, rather than half-loaded.
- **Model settings.** `key = value` lines that override a default for this version
  (exit yield, purchase costs, rent growth, voids, LTV, debt rate, tax, fees, hedge
  ratio, ...). Unknown keys are refused, not ignored.

Both live in `investment_cases.assumptions`, so they are versioned, immutable once
approved, and carried forward to the next version like every other field.

## Conventions the engine uses

- Dates count to the nearest month boundary (a lease ending 31 December keeps December).
- Reviews: the stated date and every five years after; an open-ended lease reviews
  five-yearly from completion; new leases review five-yearly. Upward only unless stated.
- Nobody renews space that is vacant, guaranteed by the vendor, or vacated at a break, so
  its first re-letting is a full void; later ones use the renewal blend.
- Exit at the end of the hold on the next twelve months' **headline** rent less ground
  rent, capitalised at the exit yield grossed up for purchaser's costs; rent still lost
  to voids or rent-free in that year is deducted (valuer's convention).
- Leasehold: below 80 years unexpired at sale, the exit yield takes an add-on per decade
  and a term-based value factor. Freehold: none.
- From year 6: lifecycle capex (1% of rent; an office refresh every 10 years; a full
  refurbishment every 25 years from year 20), refinancing every five years.
- Tax: income tax on NOI less interest and fees with losses carried forward, and tax on
  the gain. No capital allowances, no structure relief: simplified, and labelled so.
- Yen: hedged at the policy-rate gap for five years, then a flat cost; unhedged on a
  straight-line path to the exit rate.

Regression: `tests/unit/deal-engine.test.ts` runs Mutual House through the engine. It
reproduces the standalone model's first four years of rent exactly, and lands at 8.3%
sterling / 5.7% yen against the standalone 8.0% / 5.4% (the engine adds a mid-term
review to new leases and a letting fee on renewals, which the standalone model left
out). The yen break-even exit yield is 7.7% (standalone: about 7.6%).

## Running it

- **Run the model** (free, instant): engine only. Every figure on the tab.
- **Run with assessment** (about a minute, billed): adds the written view and prices its
  proposed terms. Needs `ANTHROPIC_API_KEY` server-side; without it the button is
  disabled and the engine still runs.
- **Every live deal, engine only:**
  `npm run db:run-assessments -- --org "<organisation>" --user <email>` (dry run, prints a
  table), then add `--write` to record. The written assessment is never run in bulk: it
  is a billed call and a judgement someone should read when it lands.

On demand only: never on save, never on a timer.

## Storage and access

`deal_assessments` (migration `0036`): one row per run with the inputs, the full report,
the assessment (or NULL), the model id, the verdict, the underwriting version it read,
and who ran it. **Append-only** (select and insert granted, no update or delete policy):
"what did the assessment say before the IC" keeps one answer. The trigger stamps the time
and refuses an author other than the signed-in user. Deleting a draft case keeps its runs
(the case id is cleared). A stored run is shown exactly as recorded and never recomputed.

**Reiwa staff only, within the organisation**: both policies require `app.is_staff()` and
`app.has_org(org_id)`, so a client organisation's own users can neither read nor write an
assessment even though they can see their pipeline; the page returns 404 for them too.

Running is for Reiwa staff (`requireStaffSession`), the same posture as the memo drafting
aids. Revising the underwriting replaces the rent roll or model settings only when the box
was edited, so stored assumptions this version of the form cannot read are carried forward
untouched. Nothing investor- or prospect-facing imports it; a unit test checks that. Nothing
in the module writes to `investment_cases`, `opportunities` or `properties`.

## Tests

| File | Covers |
| --- | --- |
| `tests/unit/deal-engine.test.ts` | arithmetic, the Mutual House regression, scenarios, horizons, reverse stress, terms |
| `tests/unit/deal-inputs.test.ts` | tiers, precedence and provenance, rent roll CSV, model settings |
| `tests/unit/deal-assessment-boundaries.test.ts` | purity, no writes to the underwriting, append-only table, closed schema, what the model reads, portal isolation |
| `tests/unit/assessment-view.test.ts` | the tab renders empty, engine-only and full runs |

No integration test yet: one should insert a run under RLS and assert a second
organisation cannot read it, as `tests/memo-ai-reviews.test.ts` does for reviews.

## Not yet

- Capital allowances and structure (UK REIT, GK-TK) are not modelled; the assessment is
  told so and flags them.
- Hotels and other operating assets are modelled as leases, which understates their
  risk; a gap is shown.
- The defaults are dated October 2026 and should be reviewed quarterly.
