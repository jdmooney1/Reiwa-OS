# 27 - What an investor reads: one figures line, no internal voice, no placeholder rate

Code only. No migration, no stored record changed.

## The two decisions
1. **FX.** A rate that is still a demonstration value is never shown to an investor, not even labelled
   "indicative". A number that looks live but is not is worse than no number. A rate is a stand-in when
   its source is empty or matches the placeholder test in `src/lib/fx.ts` (`isPlaceholderFxSource`: demo,
   static, placeholder, TBC, TBD, n/a, unknown). The seeded "Demo static rates" rows match; the ECB
   sync's "ECB reference rate (auto)" and a manager-typed rate with a real source do not.
2. **Underwriting disclaimer.** One line, `Indicative, subject to final underwriting`, defined once in
   `src/lib/investor-copy.ts`, drawn by one component (`FigureDisclaimer`), and shown with every figure
   an investor reads, whatever state the underwriting is in. It replaces every description of how a
   figure was produced.

## Which FX surfaces were demo and which were real
| Surface | Who sees it | Before | Now |
|---|---|---|---|
| ECB daily sync (`fx-sync.ts`, cron) | writes `fx_rates` | real source, already wired | unchanged |
| Asset Snapshot: JPY equivalent, value-allocation yen, rate line | investors (print, prospect link) | used whatever `fx_rates` held, **including seeded demo rows** | demo rates are treated as absent at compose time, and dropped at render for memos already finalised |
| Memo "FX Sensitivity" section | internal IC memo only | flagged "demonstration value" | unchanged (staff-only, already honest) |
| Portfolio dashboard (GBP totals) | staff only | uses `fx_rates` as held; flags a **stale** rate but does not flag a **demo** one | unchanged: not investor-facing. Worth a follow-up, since until the first ECB sync its GBP totals rest on demo rates unflagged |
| Investor portal, comparison, publication preview | investors / admins | **no FX conversion at all** (figures are in the deal's own currency) | unchanged, and a test asserts none is introduced |

So the real source was already there; only the Snapshot used it without checking what it was. Until the
first ECB sync has run (or a manager has typed rates), the Snapshot simply has no yen figures, and the
workspace's "Not yet captured" list says why.

## Wording found, and what changed
| Where | Was | Now |
|---|---|---|
| Investor teaser (print, prospect link, Japanese translation source), every section drawn from the case | flag `Based on unapproved underwriting` printed under the section | no flag in any external format; sections that show figures carry the standard line |
| Same flag on a section that was **empty** | printed under an empty box | empty sections are left out of an investor copy altogether |
| Asset Snapshot footer line | `Source: Reiwa underwriting v3 (working version, not yet approved)` | `Figures as at <date> · Indicative, subject to final underwriting` |
| Asset Snapshot rate line | `... · Source: <underwriting label>` | rate details only when the rate is real, then the standard line |
| Prospect link and printed teaser header | `Investor Teaser, finalised <date>` / `Version 3, finalised <date>` | `prepared <date>` |
| Printed and prospect footers | targets disclaimer only | standard line, then targets disclaimer |
| Portal home | "presented from the approved investment publication" | "presented from the investment materials Reiwa Capital has prepared for you" |
| Portal comparison | "figures approved for release", "Approved investment metrics" | "figures released to your organisation", "Investment metrics" |
| Portal figures: featured, each card, opportunity page, comparison | targets disclaimer (opportunity page only) | the standard line under every figure group |
| Admin publication preview ("investor view") | no line | the standard line, as the portal shows it |

Left as they were, on purpose, because they are staff-only: the banner above the memo workspace
("Based on unapproved underwriting: version N is the working version..."), the same flag on the
**internal IC memo**, the AI review prompt, and the draft banner on a printed draft.

## Existing finalised memos
A finalised memo is immutable, so nothing stored was edited. The rules are applied where every reader
passes (`resolveSection`, `withoutPlaceholderFx`), so old memos print and share clean. Two things a
render-time rule cannot reach, and a read-only query to find them:

```sql
-- Final memos whose stored Snapshot rests on a placeholder rate (cleaned at render; listed for awareness)
select memo_id, opportunity_id, version, status,
       content->'snapshot'->'fx'->>'jpySource'  as jpy_source,
       content->'snapshot'->'fx'->>'dealSource' as deal_source
  from memos
 where content->'snapshot'->'fx' is not null
   and (coalesce(content->'snapshot'->'fx'->>'jpySource', '')  ~* '(^|\W)(demo|static|placeholder|tbc|tbd|n/?a|unknown)(\W|$)'
     or coalesce(content->'snapshot'->'fx'->>'dealSource', '') ~* '(^|\W)(demo|static|placeholder|tbc|tbd|n/?a|unknown)(\W|$)');

-- Accepted Japanese text (shown to investors as written) that may have translated the removed flag
select memo_id, opportunity_id, version, status
  from memos
 where ja_overrides::text ~ '未承認|承認されていない|アンダーライティング'
   and status = 'final';
```

The second query is the one that matters: Japanese text a person accepted earlier was translated from a
source that still carried the flag, and accepted text cannot be changed in a final memo. Any hit needs a
new memo version (Create version N+1, recompose, translate again).

## Decisions left for review
- **Japanese twin of the line.** The Snapshot is bilingual; the standard line is English only, because the
  wording was specified in English. A Japanese rendering needs your wording, not mine.
- **Stale rates.** A real-source rate older than 30 days still prints, with the existing "This rate is N
  days old." note. By the same principle ("looks live but is not") you may prefer it hidden too. One
  condition in `composeSnapshot`.
- **Granularity of "every figure".** The line sits under each figure group (a card, a table, a section),
  not under each number. Hand-typed section text is not inspected; the document footer covers it.
- **Empty sections** are now omitted from an investor copy (as the Snapshot already omitted empty cells).
  The staff warning before finalising is unchanged.
