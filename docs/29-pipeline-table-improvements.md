# 29 - Pipeline table: money filters, sorting, saved views, triage mode, removing a deal

One migration (`0037_pipeline_saved_views.sql`, saved views only). Everything else is code on the
existing schema.

## 1. Filters (all combine with the existing ones, all live in the URL)
| Control | Param | Notes |
|---|---|---|
| Price range, £m | `pmin`, `pmax` | min inclusive, max exclusive, so the presets (<5, 5-15, 15-30, 30+) partition cleanly |
| Minimum entry yield | `ymin` | inclusive; presets 5 / 6 / 7 or a custom number |
| Sort | `sort` | `-key` is descending; keys `price`, `totalCost`, `entryYield`, `irr` |
| Layout / mode | `view=table`, `mode=triage` | |
| Existing | `triage`, `priority`, `market`, `type`, `strategy`, `q` | |

- The price filter compares **GBP deals only**. No FX is applied (a converted number would be a guess);
  non-GBP deals are hidden while a price filter is on, and the page says how many.
- Junk in the URL is dropped, not refused (`src/lib/pipeline/view-state.ts`).
- Deals with no figure for the sorted column go last in both directions. Header click cycles
  descending, ascending, off.

## 2. Saved views
- Private to the user who saved them. Name is unique per user (case-insensitive); 50 per user.
- Stores the same state as the URL (filters, sort, layout). Apply / save / rename / update / delete from
  the Views menu; it shows "(changed)" when the live view has drifted from the applied one.
- Until 0037 is applied the menu says views are not available yet; nothing else breaks.

## 3. Triage mode
Steps through untriaged deals one at a time. Keys: **P** pursue, **W** watch, **X** pass, **S** or
right arrow skip, left arrow back, **U** undo (own decisions only), **R** reason, **Esc** exit.
Letters are ignored while typing in the reason box.

| Decision | Stored as |
|---|---|
| Pursue | `triage_status = live`, no priority |
| Watch | `triage_status = live`, `triage_priority = P3`, note `Watching` or `Watching: <reason>` |
| Pass | `triage_status = dead`, reason as the note |

There is no fifth "watch" state: the existing vocabulary (migration 0014) has none. A real one would be
a one-line change to the `triage_status` CHECK. A decision only lands on a deal that is still
`untriaged`, so two people triaging at once cannot overwrite each other.

## 4. Removing a deal that is gone
Archive, never delete. Remove sits on the opportunity page and on each table row (anyone who can write).

| Reason | Status | Timeline event |
|---|---|---|
| Sold or no longer available | `withdrawn` | `sold` |
| Withdrawn | `withdrawn` | `withdrawn` |
| Lost | `lost` | none |
| We passed | `rejected` | `reiwa_passed` |

An optional note is kept in `source_facts._removal`. Only `active` deals can be removed; Restore puts a
`rejected` / `withdrawn` / `lost` deal back on the board (event `relaunched`).

## Migration 0037
Applied by the runner as normal. If applying by hand in the SQL editor, run the file, then record it:

```sql
insert into app._migrations(name) values ('0037_pipeline_saved_views.sql') on conflict do nothing;
```

Rollback: `supabase/rollback/0037_pipeline_saved_views.down.sql` (drops the table, removes the record).
Saved views are lost on rollback; nothing else depends on them.
