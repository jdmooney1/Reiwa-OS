# 34 · New deal from a teaser (drop, read, review, create)

Drop a broker teaser or IM on **Pipeline → New from Teaser** (also linked from Create Opportunity).
A model reads it into a fixed structure, a person checks every field, and the deal is created as
an **untriaged draft** through the same `seedDeal()` the command-line loader uses (doc 23), with
the teaser filed on it as an internal document.

Staff only (`reiwa_admin`, `reiwa_staff`). Nothing is published and nothing is investor-visible.

## The four steps

| Step | Action | Writes |
| --- | --- | --- |
| Drop | `prepareTeaserUploadAction` mints a single-use upload URL for `intake/<user id>/<uuid>.<pdf/png/jpg>`; the browser PUTs the file straight to the private bucket | the intake object only |
| Read | `readTeaserAction` sniffs the bytes, sends them to the model (`INTAKE_MODEL`, structured output = `TeaserExtractionSchema`), and lists deals with a similar name | **nothing** in the database |
| Review | the person corrects the form: every field shows the teaser's own words and page where the model found it; empty means "not stated" | nothing |
| Create | `createDealFromTeaserAction` re-checks the reviewed reading against the schema, maps it with `toSeedRecord()`, lets `parseDealSeed()` refuse or accept it, then `createIntakeDeal()` in ONE transaction: `seedDeal()` → `deal_load_batches`/`deal_load_rows` (source sheet `teaser-intake`, record verbatim) → copy the file into `opportunities/<id>/` → `opportunity_documents` row (category Broker Brochure, access `internal`) | the draft, its case, its building facts, provenance, the document |

If the deal looks like one already in the pipeline (same building, or a near-identical name) it is
**held** and nothing is written. The person can open the existing deal, **file the teaser on it
instead** (`attachTeaserToDealAction`), or say it is a different building and create it anyway.
Dropping the same teaser twice finds the first deal (reference `IM-<NAME>`) and only fills blanks.

## Rules it keeps

- **The model never writes.** `lib/teaser-intake/extract.ts` takes bytes and returns a typed
  reading; it holds no session or connection. Only the person's reviewed version reaches the
  database, and only through the parser and `seedDeal()`.
- **Null stays null.** The prompt says transcribe, never estimate; the schema has a null for every
  field; `toSeedRecord()` carries or drops values, never derives one. The one conversion is sq m
  to sq ft when the teaser gives no sq ft, and the parser flags it (`size_converted_from_sq_m`)
  and keeps the sq m figure in `source_facts`.
- **No currency is assumed.** Money stays in the teaser's own currency (GBP, EUR, USD, JPY). If
  any figure is present and no currency is chosen, the create step refuses.
- **Evidence travels with the deal.** The model's quotes, the file name and the model id are kept
  in `source_facts.teaser_intake`; tenants, highlights and other facts are kept as read.
- **Files are judged by their bytes.** The direct upload skips the server's MIME check, so every
  read sniffs the signature (`%PDF-`, PNG, JPEG) and the size (22 MB, the reader's limit after
  encoding) before anything else.
- **An intake path is its owner's.** Every step re-derives `intake/<session user>/` and refuses
  any other path; there is never a read URL for an intake object. Abandoned intake files are swept
  after a day, the next time their owner drops a file.

## Parser changes (doc 23)

`parseDealSeed()` now also accepts, without changing anything it already accepted:
`deal_terms.guide_price` / `passing_rent_pa` / `price_psf` and `asset_snapshot.passing_rent_pa` /
`ground_rent_pa` in the record's own currency (the `_gbp` keys still refuse a non-GBP currency);
`asset_snapshot.size_sq_m`; `opportunity.broker_name` / `source_contact_name` stated outright; and
an explicit asset type `other`.

## Configuration

- `ANTHROPIC_API_KEY` (already set for the memo review). Without it the read step says so and the
  person can still fill the form by hand; the file is still filed on the deal.
- The page sets `maxDuration = 300`: a long IM takes the model a minute or two.
- No migration. Uses 0014 (load provenance) and 0032 (deal intake fields).

## Tests

- `tests/unit/teaser-intake.test.ts`: mapping into the seed, null handling, currency and sq m,
  file signatures, intake paths.
- `tests/unit/teaser-intake-boundaries.test.ts`: the model call cannot write, every action is
  staff-only, nothing touches a publication or investor table, the deal is made by `seedDeal()`,
  a held deal writes nothing, the browser loads nothing server-only.
- `tests/teaser-intake.test.ts` (integration): the draft, its case, the internal document and the
  provenance land together; a held deal and a failed file copy leave no trace; a re-drop updates;
  staff cannot write into an organisation they are not a member of.
