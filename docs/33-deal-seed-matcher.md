# 33 - Deal-seed matcher: closed history is never written to, and spelling variants collide

Code only. No migration. Run before loading any more deals.

## 1. A reference that matches an archived or merged record
**Was.** `seedDeal()` looked the seed reference up with no `archived_at` or status filter. A reference that matched a
record since archived or merged counted as "already loaded by this seed": the duplicate scan was skipped, and the code
fell into the UPDATE branch, writing coalesce-based values into closed history.

**Now.**
- The lookup, and the UPDATE itself, are restricted to LIVE records (`archived_at is null and status <> 'merged'`).
  The update asserts it touched exactly one row.
- A reference matching only a closed record is HELD, reported by name, and joined by the ordinary collision scan:

| Closed record | Reported as |
|---|---|
| merged | `already loaded and merged into <survivor opportunity_id> ("<survivor name>") [<reference>]` |
| archived (rejected / withdrawn / lost) | `already loaded and archived (status <status>) [<reference>]` |

- `--allow-existing` does **not** override this. The reference is unique per organisation (a new row would fail on it
  anyway), and closed history is not written to. The loader report says so in words; `deal_load_rows.reason` carries the
  same text.
- The merge pointer is read as `to_jsonb(o) ->> 'merged_into_opportunity_id'`, so the code runs whether or not 0036
  (the merged status and the pointer column) is in the schema. Without 0036 only the archived case can occur.
- The scan's other lookups also exclude merged rows now, not just archived ones.

Noticed, not changed: a `converted` record (an acquired deal) that is not archived still counts as live, so a matching
reference can still fill its empty fields. If acquired deals should be frozen too, that is one more word in `LIVE`.

## 2. Name variants
`similarNames()` used to lowercase, map "&" to "and" and strip punctuation. "Emerald Theatre" and "Emerald Theater" were
different strings, which is how that duplicate got through; the merge only made it moot by renaming the survivor.

`normaliseName()` now maps each word through a small table, `NAME_VARIANTS` (`src/lib/data/deal-seed.ts`), after
dropping apostrophes, a possessive or plural "s" (Queen's / Queens / Queen), and "the". The table:

| Kind | Examples |
|---|---|
| British / American | theatre-theater, centre-center, harbour-harbor, colour-color, grey-gray, metre-meter, programme-program |
| Street types | street / saint -> st, road -> rd, avenue / av -> ave, square -> sq, place -> pl, court -> ct, garden(s) -> gdns, lane -> ln, terrace -> ter, mount -> mt, building(s) / bldg(s) -> bldg |
| Numbers | one ... ten -> 1 ... 10 ("One Fleet Place" = "1 Fleet Pl") |

Not a fuzzy matcher. A pair belongs in the table only when the two spellings are the same word; to extend it, add the
pair and a test. The rule after normalising is unchanged: equal, or one contains the other (minimum 6 characters).
Different numbers still differ (9 vs 16 Conduit Street, One vs 2 Fleet Place), and "Emerald Hotel" is not "Emerald Theatre".

## Tests
`tests/unit/deal-seed.test.ts`: variants (theatre/theater with the real punctuation, spelling pairs, abbreviations,
numbers, plurals, negatives), a table-shape test, and the closed-record report text.
`tests/deal-seed.test.ts`: an archived reference is held and the record is byte-for-byte unchanged (including a blanked
field the seed would have refilled), `--allow-existing` does not override it, the next deal in the transaction still
loads, a merged reference reports the pointer and the survivor's name (runs once 0036 is in the schema), a live reference
still updates, and the Theatre/Theater collision both ways plus a different building that does not collide.
Mutation-checked: restoring the unfiltered lookup, and removing the variant table, each fail tests.
