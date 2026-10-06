# 22 · Japanese translation of the Investor Teaser

A drafter that a person overrules. A Reiwa administrator can ask for a first-pass
Japanese rendering of every section of a **draft** memo's Investor Teaser, read each
section beside the English, and accept, edit or discard each one on its own. Nothing a
model writes is kept until a person accepts it.

Read `docs/07-memo-generator.md` and `docs/21-memo-ai-review.md` first: this sits beside
the memo generator, uses the same SDK and the same discipline as the reviewer, and changes
none of what a memo is.

## Scope

- **Teaser only.** The Snapshot is a dense data grid (translating labels is a smaller
  problem and can follow); the IC memo never leaves the firm. A section outside the
  Teaser's seven cannot be sent, named by the model, or saved.
- **Staff drafting tooling.** There is no language toggle and no bilingual portal. A
  translated Teaser reaches an investor the way an English one does: staff finalise it and
  send it.
- **On demand, admin-only, draft-only.** No translation on save, on a timer, or while
  editing. A final memo is refused: translate the next version.

## The flow

1. **Draft Japanese translation** (Teaser view of a draft memo, administrators only).
   `translateMemoAction` builds the English from the composed Teaser, makes **one call for
   the whole Teaser** (so "net initial yield" is one Japanese term throughout), checks every
   section's figures, records one `memo_translation_drafts` row, and returns the drafts.
   It writes nothing to the memo.
2. Each section shows English beside the Japanese draft in an editable box, with a live
   figure check. **Accept and save** writes that section's text, as it then stands in the
   box, to `memos.ja_overrides`. **Discard** puts the draft away. **Save anyway** appears
   instead if the figures differ, and the server refuses a mismatch unless that was chosen.
3. A saved section is listed with **Remove**. To change it, draft again and accept again.
4. The **Japanese Language Summary** tab and its print view show the translated Teaser.

## What the model sees, and what it may not do

- **Input**: the composed Teaser only, overrides applied, in the English an investor would
  read: the seven Teaser sections, internal blocks withheld as in print, empty sections not
  sent, figures exactly as the English page displays them. Not the IC sections, the
  Snapshot, the address, scores, decisions, or the hand-written Japanese summary.
  (`src/lib/memo-translation/source.ts`, pure.)
- **Rules in the prompt** (`prompt.ts`): never change a figure (same digits, commas,
  decimals, symbols; no 万/億, no unit or currency conversion, no reformatted dates); add,
  drop or soften nothing; keep proper names as written; one term per concept across the
  whole document; polite business register. A short glossary is taken from the firm's own
  bilingual Snapshot template (純初期利回り, 現行賃料, 想定賃料, 稼働率, 資本的支出).
- **Output**: a closed schema keyed by the Teaser's seven section keys, one string each
  (`schema.ts`), enforced as a structured-output format and re-validated with Zod. A key
  outside the Teaser is rejected, a section that was sent but came back empty is an
  error, and text for a section that was not sent is discarded.
- **Failure is an error, never a silent gap**: a missing key, a refusal, a truncated or
  unparseable answer, or an API error each throw a sentence for a person
  (`translate.ts`), and nothing is recorded.

## The figure check

`numbers.ts` compares the **spelling** of every figure (digits with their commas and
decimals) in a section's English with its Japanese, as a multiset. It reports `missing`
(dropped or altered) and `unexpected` (invented or altered). `6,400万`, `64000000` and
full-width digits all fail by design. It is a tripwire for the most expensive mistake, not a
translation review: a pass means the numbers match, not that the Japanese is good. It runs
on generation (shown with the draft), live as a person edits, and again on the server at
accept time.

## Database (migration `0031_memo_ja_translation.sql`)

| Object | Notes |
| --- | --- |
| `memos.ja_overrides jsonb not null default '{}'` | Section key → Japanese text, Teaser keys only (CHECK), same shape as `overrides`. |
| `app.guard_memo()` | **One word changed.** The function lists the columns a *draft* may change; `ja_overrides` is added to that list. Without it the first accepted translation is rejected as an identity change. A final memo is untouched: any update is still refused, so an accepted translation freezes at finalisation like the English. `tests/unit/memo-translation-boundaries.test.ts` holds the new function to "0023's, identical but for that line". |
| `memo_translation_drafts` | One row per generation: `model`, `sections {key: {source, draft}}`, `created_by`, `created_at`, `accepted_sections []`. Administrator-only RLS. `authenticated` has `select, insert` and `update (accepted_sections)` only; no delete. |

`accepted_sections` lists the keys **ever saved** from a draft, never what was merely
generated. Removing a saved section from the memo leaves its key there ("kept, then taken
back" is a fact worth having).

### Reconciling the existing `japanese_summary`

`overrides.japanese_summary` (the single hand-typed paragraph) is **not touched, converted
or deleted**: a finalised memo that carries one reads exactly as it did.

- With no accepted translation, the Japanese view is the earlier summary, byte for byte.
- Once any section is accepted, the Japanese view is the Teaser section by section, and the
  hand-written summary **stands in for the executive summary** until a translated one is
  accepted (`src/lib/memo-translation/japanese.ts`). The summary stays editable.

### Not carried to a new version

`createMemoDraft` copies `overrides` forward; it does **not** copy `ja_overrides`. A
translation is a rendering of the English beneath it, and that English can change in the
next version, so a carried translation would keep reading as current after the text under it
had moved. A new version is translated again. (A later change can carry it forward with a
staleness check.)

## Audit

"Was this translated by a model, and which parts did a human keep?" is answered by
`memo_translation_drafts`: the model, the English that was sent, the Japanese that came
back, who ran it and when, and which sections were saved.

## Configuration

`ANTHROPIC_API_KEY`, server-side only (already used by the pre-finalisation review). No new
dependency. The model is pinned in `translate.ts` (`TRANSLATION_MODEL`) and recorded on
every row. Apply `0031` before deploying the code that uses it.

## Limits to know

- **Figures are checked; wording is not.** A financial translation still needs a Japanese
  reader's eye on terminology and tone before anything is sent.
- **A section becomes one block of text.** A metrics section is saved as lines of
  `label: figure` in Japanese, not as the structured grid the English shows, and a
  Japanese section with no accepted text is simply not printed.
- **The Teaser's fixed footer is English.** The targets statement under the Teaser is
  not translated by this feature; its Japanese wording is a decision for counsel.
- **Not evaluated against the live model.** The suite and the browser check use a stand-in
  for the API; none of it proves how the real model translates.
