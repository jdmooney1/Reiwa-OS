# 32 - Investor mandates: what an investor wants, matched to deals (staff only)

One migration, `0050_investor_mandates.sql`. Rollback: `supabase/rollback/0050_investor_mandates.down.sql`.

## What it is
A mandate is an investor ORGANISATION's stated appetite. It lets Reiwa staff answer "who should I call about this deal"
and "what does this investor actually want". Rule-based: overlap and range checks, no score.

| Preference | Stored as | Rule |
|---|---|---|
| Markets | `markets text[]` (max 12) | the deal's market is any of them (case-insensitive) |
| Asset types | `asset_types text[]` | any of; values are the ones deals use (office, mixed_use...) |
| Strategies | `strategies text[]` | any of (core, core_plus, value_add...) |
| Deal size | `deal_size_min/max` + `currency` | the deal's total cost is within the range, inclusive at both ends |
| Minimum entry yield | `min_entry_yield_pct` | the deal's entry yield is at least this |

A group left blank is not tested. A mandate that states nothing matches nothing (never "everyone").
Within a group it is OR; across groups it is AND.

Each stated preference comes back pass / fail / **unknown** (the deal has no figure to test it: not yet underwritten, no
market, a different currency). The verdict is `fit` (all pass), `possible` (nothing fails, something unknown), `no_fit`
(something fails) or `no_mandate`. A deal with no yield yet is shown as "possible", with what is missing, not dropped.

## Kept apart on purpose
- **Not on `investor_organizations`.** A row an investor can read is readable in full (a row policy filters rows, not
  columns): see 0038. `investor_mandates` is its own table with ONE policy, Reiwa admin, and no investor policy. An
  investor, a staff user and an organisation user read nothing from it (tested). Nothing investor-facing references it
  (a source test fails if one ever does).
- **Per organisation, not per contact.** One row per organisation.
- **Not the investment score.** `src/lib/scoring` is Reiwa's own assessment of deal quality. The mandate module imports
  nothing from it (tested) and shares no vocabulary: a deal can score well and fit nobody, or the reverse.

## Deal size is a simplification
Deal size is compared with a deal's TOTAL COST. An investor's real "ticket" is its equity cheque, which depends on
leverage and co-investment, and no equity-required figure exists on a deal yet. It is the size of deal they will look at,
not a finished definition of ticket size; when an equity figure exists that is what to compare. The simplification is
stated in the code, in the editor beside the field, and here. A deal in another currency is "unknown", not converted.

## Where it shows (admin only)
- **Investor organisation page:** the mandate editor, and "Live deals that suit this mandate" (live = active and triaged
  live), best first, with a "Why" line per check.
- **Opportunity > Publication page:** "Investors to call about this deal": active organisations whose mandate fits or
  may fit, best first.
- **Not yet: the pipeline "Matches" column.** Deferred until the pipeline PR and the Emerald merge are in.
- Both cards hide until 0050 is applied.

## Apply
Run the migration, then if applying by hand:
```sql
insert into app._migrations(name) values ('0050_investor_mandates.sql') on conflict do nothing;
```
Numbering: 0036-0049 are taken or in flight on other branches (the merged-status migration, saved views, the
investor-org leak fix, and a long run on `claude/quirky-meitner-k4tokb`), so this uses 0050. The runner keys on the full
file name, so a duplicate prefix still applies, but a fresh number avoids any ordering doubt.

## With the guarded delete (PR for investor-contact-errors-and-delete)
Deleting an investor organisation deletes its mandate (`on delete cascade`). When that branch and this one are both in,
the catalog test there will fail until `investor_mandates` is added to `GUARD_COVERAGE.cascades`
(`src/lib/investor/deletion-guard.ts`), which is the intended prompt. A mandate does not block a delete.

## Tests
`tests/unit/investor-mandates.test.ts` (29: every rule and boundary, ranking, input validation, the cards, and the source
boundaries), `tests/investor-mandates.test.ts` (18: storage, the table's CHECKs, who can and cannot reach it, matching
end to end). Mutation-checked: an added investor policy, and an off-by-one at the size boundary, each fail tests.
