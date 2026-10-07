# 28 - Merging the Emerald duplicate: migration 0036 and a reviewed one-off

Status: PROPOSED. Nothing here has been run against reiwa-dev. Migration 0036 and the one-off are written and
tested against a disposable local database only.

## What happened
The deal-seed loader created "Emerald Theatre, Covent Garden" (`b5c09009-02e1-4350-b163-e6c62fb74714`) as a new
deal. The 30 September pipeline load already holds the same building as "Emerald Theater"
(`0f4d3e03-02ef-4957-918d-1ffb9d75bd48`). Why the loader's checks missed it, and how the matcher should change, is in
the proposal handed over separately (name test defeated by the Theater/Theatre transposition; the address test is
address-led and market-scoped and did not link the two properties for a reason query 1 of the discovery SQL settles).
**Do not run the loader for the remaining deals until the matcher is fixed.**

## Decisions this implements (yours)
1. A new `merged` status, by migration, not `withdrawn`.
2. The duplicate's underwriting is kept as a **non-current v2 draft** on the survivor.
3. The survivor is renamed **Emerald Theatre, Covent Garden**; the old name is kept in `source_facts._previous_names`.
4. The duplicate is archived, not deleted.

## The two files

### `supabase/migrations/0036_merged_status.sql` (schema; goes through the normal migration path)
- `opportunities.status` admits `merged`.
- `opportunities.merged_into_opportunity_id` names the survivor. A status with no pointer is a label; with one it can
  be queried and shown. **This column is an addition to what you asked for**; strike it if you would rather have the
  bare status (the CHECK below goes with it).
- `CHECK ((status = 'merged') = (merged_into_opportunity_id is not null))` and no self-merge. `ON DELETE RESTRICT`.
- Changes no row, no policy, no grant, no view.

App side (so a merged row cannot be made or revived by accident): `OppStatus` and the two label maps know the word;
`setOutcome` refuses `merged` (only the script sets it); `reactivate` refuses a merged record; the pipeline's
"still to triage" count ignores merged records. Merged rows already fall outside both the board and the archived list.

### `supabase/one-off/2026-10-07_merge_emerald_duplicate.sql` (data; paste into the SQL editor, by hand)
Not in `supabase/migrations/`, on purpose: `scripts/migrate.ts` applies every file in that folder to every database,
and this changes two specific rows in one. A test asserts the runner never reads `one-off/`.

**Run order**
1. Apply `0036` (paste, as with the others).
2. Run the discovery SQL (queries 1 to 3 especially). If query 2 shows anything on the duplicate beyond one case, one
   first-seen event and one loader audit row, stop: the script will also stop, but you should know why first.
3. Run the merge script AS IS. `v_apply` is `false`: it does every step, checks the result, and then raises an
   exception that rolls everything back. **The error text is the report.** Read it.
4. Change `v_apply boolean := false;` to `true`, run again.
5. Run `2026-10-07_merge_emerald_duplicate_verify.sql` (read-only).

**What the dry-run report shows:** both records and both properties before (names, references, brokers, contacts,
property address, market and identity key), every underwriting case, a warning if the survivor feeds a publication,
then the after state: survivor name/status/contact, the survivor's cases including the moved v2, the clashes it kept
the survivor's value for, the audit rows repointed, and which property was left as is.

**What it does**
| Step | Effect |
|---|---|
| Fold | Into the survivor, only where empty: source contact (Guy Harris), source line, deal stage, data completeness, size, photo reference. Never overwrites. |
| `source_facts` | Duplicate's facts added beneath the survivor's (survivor wins); every clash, the duplicate's loader flags, its broker text ("Hanover Green LLP") and its source line recorded under `_merged_from`. |
| Property facts | Heritage, tenure, ground rent, WAULT, covenant, EPC, transport: empty fields on the survivor's property filled; clashes recorded, not resolved. |
| Underwriting | The duplicate's case becomes the survivor's next version, status `draft`. The survivor's own v1 and its projected headline figures are untouched (a draft is not an input to the projection). The 7.47% vs 7.00% difference is kept visible, not chosen between. |
| Rename | Survivor becomes "Emerald Theatre, Covent Garden"; old name appended to `_previous_names`. |
| Timeline | One new `note` event on the survivor's property. The duplicate's first-seen event stays (events are append-only). |
| Loader audit | `deal_load_rows` repointed at the survivor and annotated; `raw_row` untouched; `outcome` stays `created` because that is what happened. |
| Duplicate | `status = 'merged'`, archived, pointing at the survivor. Kept, not deleted. |

**What it stops on (changes nothing):** a missing record, the same record twice, different organisations, an
already-merged duplicate, an archived or non-active record, a duplicate that is not a `SEED-` record or not newer than
the survivor, either record unbound to a property, **any other table holding rows for the duplicate** (checked
generically across every base table with an `opportunity_id` column), more than one case on the duplicate, an approved
or superseded case, prices more than 1% apart, a different broker firm. After the work it re-checks the result and
rolls back if any postcondition fails. Running it twice is safe: the second run finds the duplicate merged and stops.

## What it deliberately leaves
- **The duplicate's own property row.** If the keys differed (likely), the loader also created a second property. It
  is left unreferenced except by the archived duplicate and its first-seen event. Properties have no "merged" notion,
  and deleting one would cascade-delete its events, which are meant to be append-only. The report names it. Tidy later,
  with the matcher work.
- **The property's name.** Only the opportunity is renamed.
- **A reversal script.** Nothing is deleted and everything moved is recorded under `source_facts._merged_from`, so a
  reversal is possible; one has not been written.

## What the tests prove (`tests/emerald-merge.test.ts`, 18 tests, real Postgres)
The pair is built by the real loader, reproducing the incident's shape (a name-led address on the original, a clean
one on the duplicate; fictional names prefixed ZZTEST). The default run changes nothing (every row compared). The
applied run produces exactly the result above, deletes nothing (row counts equal), keeps the survivor's own case and
headline figures, keeps a draft v2 that is not current, repoints the audit row, adds exactly one event. It never
overwrites a field the survivor already has. A loader re-run finds the archived duplicate by its reference and does not
recreate it. Each guard stops the run with no change. The database refuses a merged status with no survivor, a pointer
on a non-merged row, a self-merge and the deletion of a survivor. Five deliberate breakages of the script (switch
defaulting to apply, moved case current, price guard removed, survivor fields overwritten, dependents scan disabled)
each fail the suite.

## Things I could not check
- The real rows. The script is written to the schema and tested on fixtures; the guards exist because I have not seen
  the live data. If a guard stops it, that is information, not a failure.
- That every pipeline, board and report view hides archived rows. The board and archived list do (a merged status is in
  neither); I did not audit other readers. The next matcher change should: `findCandidates` can currently surface an
  archived opportunity as a property's latest.
- Whether the survivor feeds a publication. The script warns if so: the rename will light the "internal record has
  changed" notice on it.
