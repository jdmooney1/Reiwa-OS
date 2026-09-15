# 5 · Publication provenance captured only approved underwriting

- **Date:** 2026-09-15
- **Shape:** silent null — a record that omits something, where the omission is
  later read as a negative fact
- **Found in:** Phase 1A, review round, by self-review while writing the
  durability test for review item 5
- **Introduced by:** `a6ed784` (migration `0008`, this phase)
- **Resolved by:** `eae7249` (migration `0009`)
- **Severity:** would not have produced a wrong figure, but would have destroyed
  the ability to explain a figure already sent to an investor

## What it was

When an investor publication draft is created from an internal opportunity, the
draft is an independent snapshot — that boundary is correct and deliberate. To
make the snapshot explicable later, Phase 1A began recording, privately and
admin-only, **which underwriting version and which committee decision were live
at the moment the draft was taken**.

The capture read:

> the investment case for this opportunity **whose status is `approved`**

An opportunity published *before* it had been to committee therefore recorded
`NULL` — no underwriting provenance at all.

## Why that is this pattern and not an ordinary omission

The draft is prefilled from the opportunity's headline figures, and those
figures are projected from the **authoritative** underwriting version, which is
the approved one if there is one and otherwise the current working one. So in
the pre-committee case there *was* an underwriting version behind the numbers
the investor saw. It simply was not the one the capture looked for.

The stored `NULL` would then be read, months later, as *"this publication had no
underwriting behind it"* — a statement about the world. The truth was *"it had
one, and we did not write it down."* Those are different facts, and the record
could not distinguish them.

That is precisely the failure this log exists for. It is milder than entries
1–4 because nothing fabricated a figure; it is the same species because an
absence in the record would be read as a claim about the business.

## The aggravating factor

The same columns were originally attached with `ON DELETE SET NULL`, reasoned as
*"provenance must never be able to block a publication."* That protected the
wrong thing. Publication content is an independent immutable snapshot and was
never at risk either way. What `SET NULL` protected was the ability to delete
the source record — at the cost of **silently converting a recorded provenance
into exactly the ambiguous null described above**. A deletion would have
manufactured this finding retrospectively, on publications that had been
captured correctly.

## Resolution

Two changes, both in migration `0009`:

1. **Capture the authoritative version, not only an approved one** — the same
   rule that projects the opportunity's headline figures, so the provenance
   always names the version the draft was actually prefilled from.
2. **`ON DELETE RESTRICT`** on both provenance foreign keys. Once an underwriting
   version or a decision has been cited to an investor it stops being deletable.
   This matches `publication_sources.opportunity_id`, which has carried the same
   rule since migration `0005`, for the same reason.

`NULL` remains permissible in one honest case: an opportunity published before
it was ever underwritten. There, null is the truthful answer, and it can no
longer be reached by deletion — only by never having had a case at all.

No investor-facing behaviour changed: no version content, entitlement, document
tier or delivery path was touched.

## What made it visible

Writing the test for review item 5 — *"refuses to destroy an underwriting
version cited by a publication"*. The delete succeeded instead of being
refused. The `RESTRICT` was correct; there was simply nothing in the provenance
column to protect, because the test's opportunity had not yet been to
committee.

The finding came from the test failing for the *wrong reason*. Had the test
happened to use an approved opportunity — the more obvious case to write — it
would have passed, and the gap would have shipped.

## Carry-forward

Before adding a provenance column, state what its `NULL` will mean and confirm
that reading it as a fact about the business is true. If `NULL` would be
ambiguous between *"did not happen"* and *"not recorded"*, the column is not
finished. The same question applies to `ON DELETE SET NULL` anywhere in this
schema: it converts a known fact into an unknown one, silently, and should be
justified per column rather than chosen as the safe default.
