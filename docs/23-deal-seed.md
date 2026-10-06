# 23 · Seeding structured deals (broker IMs already read)

A pragmatic first pass: get real, already-structured deal records into the system as **draft
opportunities** without waiting for the full extract-from-raw-text feature. Migration `0032` adds
the fields these records carry; `scripts/load-deal-seed.ts` loads a JSON file of them.

## Running it

```
npm run db:load-deal-seed -- --file deals.json --org "<organisation>" --user <email|profile id>           # dry run
npm run db:load-deal-seed -- --file deals.json --org "<organisation>" --user <email|profile id> --write    # commit
```

- **Dry by default.** It parses the whole file first (refusing it, with every problem listed, if
  anything is malformed), resolves everything inside a transaction, prints a reconciliation
  report, and rolls back. Only `--write` commits.
- **Idempotent.** Each deal gets a stable reference (`SEED-<NAME>`), unique per organisation.
  Re-running only fills fields that are still **empty**; it never overwrites something a person
  has since edited (a deal moved from `guided` to `under_offer` in the app stays there).
- **A deal already in the pipeline is held, not duplicated.** If another opportunity is bound to
  the same property, or has a near-identical name, the deal is reported with that record's broker
  and price and **not written**. `--allow-existing` writes it anyway.

## What a loaded deal is

A **draft**: stage `new`, status `active`, triage `untriaged`, owned by nobody, with a "first seen"
event. No publication, entitlement, photograph or memo is created, and an investor can only see a
deal through a publication (0005), so nothing loaded is investor-visible. The script prints the
count of publications referencing the loaded deals (it must be 0) and a test asserts none of the
new columns appears in any function or view.

## Where each field goes

| Source | Lands in |
| --- | --- |
| heritage, tenure, unexpired term, ground rent, WAULT (expiry, breaks), covenant, rent review, EPC, transport | `properties` (the building's facts) |
| ground rent as an amount / as words (e.g. "Peppercorn") | `ground_rent_pa` / `ground_rent_note`; a peppercorn is **not** zero |
| deal stage (`early_dialogue` / `guided` / `under_offer`) | `opportunities.deal_stage` (separate from Reiwa's own `stage`) |
| picture reference | `opportunities.photo_reference_type` (`attachment_not_retrieved` / `external_url` / `none_found` / NULL = not looked at), `photo_url`, `source_attachments`; a stored photograph is a gallery row and takes precedence |
| guide price, NIY, passing rent | the version-1 **investment case** (never the opportunity row); a pre-pricing deal gets no case |
| size, broker, source line, off-market flag | the existing columns (`size_sqft`, `broker_name`, `source`, `source_type`) |
| how complete the source was | `opportunities.data_completeness` (verbatim) |
| every other source fact (tenant, lease expiry, rent steps, price per sq ft, amenities...) | `opportunities.source_facts`, kept as given |

**NULL stays NULL.** An absent or null field becomes null: nothing is defaulted, computed or
inferred. NIY is the broker's quoted figure (net of costs), not a recomputation.

**Flags, not fixes.** A record that disagrees with itself (price vs its own price per sq ft), or
carries a note that it conflicts with another record, gets a flag in `source_facts._loader_flags`
and in the report. The loader never picks a winner.

## Not yet

No admin screen reads the new building facts: they are in the database, and the Asset Snapshot
composer does not yet read them. The opportunity page shows the money, source and broker as it
always has. Extraction from raw text is the next, separate piece of work.
