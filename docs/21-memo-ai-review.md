# 21 — Pre-finalisation memo review

A reviewer, not an author. A Reiwa administrator can run one optional pass over
a **draft** memo before finalising it; the pass reads the composed memo and
returns a list of things worth a second look. It writes nothing to the memo, it
recomputes nothing, and it blocks nothing.

Read `docs/07-memo-generator.md` first — this sits beside the memo generator and
changes none of it.

## Why this is separate from the memo generator

`docs/07` states the rule the memo is built on: every section is composed from
rows that exist, or it is empty and says so, and **nothing in a memo is written
by a model**. `tests/unit/memo-boundaries.test.ts` enforces that by asserting
that no file under `src/lib/memo` or `src/components/memo` so much as mentions a
model or makes an outside call.

That line does not move. This feature therefore lives **outside** that tree:

| Concern | Lives in |
| --- | --- |
| Finding shape and closed schema | `src/lib/memo-review/findings.ts` |
| Which memos may be reviewed | `src/lib/memo-review/eligibility.ts` |
| Composed memo → prompt text (pure) | `src/lib/memo-review/prompt.ts` |
| The one model call (`server-only`) | `src/lib/memo-review/review.ts` |
| Audit rows | `src/lib/data/memo-reviews.ts` |
| Server action | `src/app/actions/memo-review.ts` |
| Panel | `src/components/memo-review/review-panel.tsx` |
| Table | `supabase/migrations/0030_memo_ai_reviews.sql` |

The memo workspace renders the panel; the composer does not know it exists.

## What it reads

`buildReviewPrompt()` takes a `ComposedMemo` and its `overrides` — the same
object the workspace and the print view render — and nothing else. It opens no
connection and imports no data module, so if a fact is not already in the memo
object the review cannot see it. The broker, vendor, source contact, triage
note, coordinates and every investor record are absent for the same reason they
are absent from the memo: they were never copied into it. The Snapshot's street
address *is* in the memo object and is still withheld — a reviewer has no use
for it.

Sections are rendered at **internal fidelity whatever format is open**, because
the sections most worth checking before finalising (Recommendation, Risk and
Mitigation, Tax and Structuring) are the internal-only ones. The open format is
passed as context, not as a filter.

**Figures are passed through untouched** — no rounding, no unit conversion, no
recomputation. A reviewer that reformatted a figure would be the first step
towards one that corrects it.

## What it may say back

Four categories, and nothing else: `numeric_inconsistency`, `outlier_metric`,
`unresolved_gap`, `internal_contradiction`. Each finding is a short label, the
sections it concerns, and a one-line reason.

The schema is the enforcement, not the prompt. `ReviewSchema` is handed to the
API as a structured-output format, so a finding has exactly four fields and
cannot carry a suggestion, a replacement sentence or a corrected number. **A
finding points; it never corrects.** If two figures disagree it says so and
names both sections — which one is right is for the analyst to determine from
the records.

There is no verdict. An empty list means nothing was raised, and the panel says
in as many words that this is *not* a confirmation that the memo is correct.

## What it cannot do

- **It cannot change the memo.** The action imports no function that writes one
  — not `setOverride`, `recomposeDraft`, `createMemoDraft` or `finalizeMemo` —
  and the data layer issues no statement against `memos`.
- **It cannot block finalising.** `finalizeMemoAction` and `app.guard_memo` are
  untouched. A memo with twenty open findings finalises exactly as one with
  none. A model's false positive must never hold up a deal; the control stays
  human judgement.
- **It cannot run itself.** On demand only — never on save, never on a timer.
- **It cannot reach an investor or a prospect.** Administrator-only, and no
  portal, prospect or print surface references it in any form.
- **It cannot run on a final memo.** `reviewRefusalReason()` refuses, so "there
  is a review row" keeps meaning "it was checked *before* it went out".

## Audit trail

`memo_ai_reviews` — one row per run: `memo_id`, `model`, `findings` (jsonb),
`created_by`, `created_at`. Append-only: no update policy, no delete policy, and
`authenticated` is granted `SELECT, INSERT` and nothing else, so a review cannot
be edited or tidied away afterwards. RLS is administrator-only (`app.is_admin()`
on both policies); `anon` is revoked. Same reasoning as `deal_share_views`
(0029).

## Configuration

`ANTHROPIC_API_KEY`, server-side only, never `NEXT_PUBLIC_`. Without it the
workspace runs normally and only this button is refused, with a clear message —
the same posture as `RESEND_API_KEY`. A missing key, a refusal, a truncated
answer and an unparseable answer all **fail loudly**; none of them is ever
recorded as an empty review, because "nothing found" and "it did not run" must
not look alike.

## Tests

| File | Covers | Needs a database |
| --- | --- | --- |
| `tests/unit/memo-review-boundaries.test.ts` | the four boundaries above | no |
| `tests/unit/memo-review-prompt.test.ts` | what is shown, figures untouched, closed schema | no |
| `tests/memo-ai-reviews.test.ts` | one row per run, memo untouched, admin-only, append-only | yes |

The integration file never imports `runReview()`: it writes findings by hand, so
the suite makes no model call, costs nothing to run and stays deterministic.
