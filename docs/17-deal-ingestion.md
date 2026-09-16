# 17 · Deal Input / Opportunity Ingestion System

> **Status: Phase 1 delivered. Phases 2-6 remain proposals.**
> This document is both the analysis that preceded implementation and the
> record of what was built. See **§J Phase 1 as built** at the foot for what
> now exists; everything above it is the original proposal, left unedited so
> the decisions behind the build stay legible.
>
> Decisions taken: **D2 three axes**, **deterministic extraction first**, and
> **the split test suite** (§H).

The objective: turn messy broker material (spreadsheets, emails, brochures)
into a structured, deduplicated, provenance-tracked Opportunity Intelligence
database that accumulates market history, while the Investment Portal remains a
deliberately curated subset.

---

## A · Existing state

Reiwa OS is considerably further along than a greenfield build. The following
is live and database-backed.

### Runtime and security

| Layer | State |
| --- | --- |
| Framework | Next.js 14 App Router, TypeScript, Tailwind, server actions |
| Database | Hosted Supabase PostgreSQL, accessed only through `src/lib/db/client.ts` |
| Auth | Supabase Auth; `getSession()` re-validates the token server-side |
| Authorisation | Row Level Security on every table; `app.*` helpers read `auth.jwt()` |
| Access modes | `adminQuery` (privileged, BYPASSRLS) vs `withSession` (RLS-gated transaction) |
| Migrations | `supabase/migrations/0001`–`0006`, ledger in `app._migrations` |

Two **separate tenancy models**, with no permission-level bridge:

- internal: `organizations` / `organization_members` / `profiles`
- investor: `investor_organizations` / `investor_contacts`

An investor has no `profiles` row and no `organization_members` row, so
`app.current_org_ids()` is empty and every internal policy denies them by
construction. This is the single most valuable property of the existing
codebase and the ingestion layer must inherit it unchanged.

### Domain model that exists today

```
property ─┬─ opportunity ─┬─ investment_case (approved ⇒ immutable)
          │               └─ transaction (immutable)
          └─ asset ───────┬─ business_plan (v1 underwriting immutable)
                          ├─ performance_period (append-only)
                          ├─ asset_risk / asset_decision / valuation
                          └─ portfolio
```

- `opportunities` carries the deal facts as flat columns: `target_price`,
  `passing_rent`, `erv`, `niy`, `reversionary_yield`, `capex_budget`,
  `target_irr`, `equity_multiple`, `size_sqft`, `size_sqm`, `broker_name`,
  `vendor_name`, `source`, `summary`, `market`, `submarket`, `asset_type`,
  `strategy`, `currency`, plus `stage` and `status`.
- `properties` carries `name`, `address`, `city`, `country`, `market`,
  `asset_type`, `latitude`, `longitude`.
- Immutability is enforced by database triggers, not application code.

### Investment Portal (fully built, do not redesign)

`investor_publications` → `publication_versions` (snapshot, immutable once
published) → `publication_documents` (tiered: standard / diligence / internal)
→ `publication_entitlements` (default deny, per investor organisation).

The **only** bridge from internal data to investor data is
`app.opportunity_publication_source(uuid)` — an explicit field whitelist in
migration 0005. Broker, vendor, source, passing rent, ERV, capex, probability,
internal stage and status are deliberately excluded. Provenance lives in
`publication_sources` / `publication_version_sources`, which no investor can
read at all.

Admin UI exists at `/admin` (overview, investors, publications, activity), and
`preparePublicationAction` is already wired into the opportunity detail page.

### Ingestion-adjacent code that exists but is not real

| Item | Reality |
| --- | --- |
| `src/lib/documents/ingest.ts` | Canned, deterministic mock. Returns a hardcoded "extraction" keyed off a document category and a mock `Deal`. No file is read. |
| `src/lib/documents/catalog.ts` | 15 document categories mapped to icons and DD sections. Useful taxonomy, but typed against the mock layer. |
| `src/components/deal/tabs/documents-tab.tsx` | Renders the vault against `src/lib/mock-data.ts`. Not database-backed. |
| `src/types/database.ts` | A **second, legacy** type universe (`Deal`, `DealStage`, `DocCategory`, DD/score/memo). Feeds `/deals/*` and the mock components only. |
| Supabase Storage | **Not wired anywhere.** `publication_documents.storage_path` reserves a path; no bucket, no upload, no signed URL. There is not one `<input type="file">` in the application. |

### Test harness

15 test files, all **integration** tests against the live Supabase instance
configured in `.env.local`. `tests/global-setup.ts` drops, migrates and seeds
the database once per run; `fileParallelism: false`. There are **no unit
tests** and no test that runs without network access to Supabase.

---

## B · Gap analysis

Everything the brief asks for is new. Nothing in the repository ingests a file.

| Brief section | Exists | Gap |
| --- | --- | --- |
| 2 · Deal Inbox | — | No queue, no upload, no staging tables |
| 3 · Excel/CSV import | — | No parser, no mapping UI, no saved templates |
| 4 · Email ingestion | — | No `.eml`/`.msg` parsing, no attachment pipeline |
| 5 · Inbound address | — | Not built; schema must anticipate it |
| 6 · Document extraction | Mock only | No PDF text extraction of any kind |
| 7 · Field provenance | — | Values are bare columns with no source |
| 8 · Confidence scores | — | No concept |
| 9 · Duplicate matching | — | No normalisation, no matching, no postcode column |
| 10 · Longitudinal history | Partial | `property` exists as the durable identity, **but see debt item D1 - it is duplicated on every create**. No event table. |
| 11 · Opportunity record | Partial | Detail page exists; no documents, communications, timeline, tenancy, distribution |
| 12 · Quick entry | Partial | `/opportunities/new` is a full form, not a 20-second capture |
| 13 · Status system | Partial | Two-axis `stage`+`status` exists; no market status, no watchlist |
| 14 · Review queue | — | Nothing |
| 15 · Bulk actions | — | Nothing |
| 16 · Search/filter | — | Pipeline lists all rows, no filters, no text search |
| 17 · Portal publishing | **Built** | Add an `investor_ready` gate in front of the existing flow |
| 19 · Document storage | — | No bucket, no upload, no library |
| 20 · Audit trail | — | Updates overwrite in place, silently |
| 21 · Conflict handling | — | Nothing |
| 22 · Security | **Built** | Extend the existing RLS pattern to new tables |

---

## C · Proposed data model

### C.1 The central decision: projection + ledger

The brief wants per-field provenance, confidence and conflict history. The
naive reading is to move every value into an entity-attribute-value table.
**Do not do this.** It would break `app.opportunity_publication_source()` (the
investor whitelist), every existing query, the pipeline UI, and filtering
performance at several hundred to several thousand rows.

The proposal is a hybrid:

- **`opportunities` keeps its flat columns** as the *accepted current value*.
  Fast to filter, sort and aggregate; the investor whitelist and all existing
  code keep working untouched.
- **`field_observations`** is an append-only ledger: every value ever asserted
  for a field, by whom or by what, with confidence and a link to the source
  document, email or import row.
- **`field_state`** records which observation is currently accepted for each
  field, and whether the field is **locked** (a Reiwa-verified value that no
  automated extraction may overwrite).

Writing a value becomes: insert observation → compare with accepted → if it
differs and the field is locked or high-trust, raise a **conflict** for review
rather than overwriting. This delivers sections 7, 8, 20 and 21 at once, and
the audit trail is a byproduct of the ledger rather than a separate mechanism.

```sql
field_observations (
  observation_id, org_id,
  subject_type   text,      -- 'opportunity' | 'property' | 'lease' | 'tenancy'
  subject_id     uuid,
  field_key      text,      -- 'asking_price', 'passing_income', 'niy', ...
  value_text     text,      -- canonical string form, always populated
  value_numeric  numeric(18,4),
  value_date     date,
  currency       text,
  source_kind    text,      -- 'broker_email'|'brochure'|'spreadsheet'|'reiwa_manual'
                            -- |'reiwa_assumption'|'underwriting'|'public_record'
  source_document_id uuid,  -- → source_documents
  source_email_id    uuid,  -- → source_emails
  ingestion_item_id  uuid,  -- → ingestion_items
  source_page     int,      -- brochure page, or spreadsheet row
  source_excerpt  text,     -- the literal text the value came from
  confidence      numeric(4,3),  -- 0.000–1.000, null for human entry
  extractor       text,          -- which extractor/version produced it
  observed_at     timestamptz,   -- when the SOURCE asserted it
  recorded_at     timestamptz,   -- when Reiwa recorded it
  recorded_by     uuid
)

field_state (
  org_id, subject_type, subject_id, field_key,   -- PK
  accepted_observation_id uuid,
  is_locked   boolean default false,
  locked_by   uuid,
  locked_at   timestamptz,
  updated_at  timestamptz
)

field_conflicts (
  conflict_id, org_id, subject_type, subject_id, field_key,
  incumbent_observation_id, challenger_observation_id,
  status text,   -- 'open'|'kept_existing'|'accepted_new'|'kept_both'
  resolved_by, resolved_at, note
)
```

`field_key` is a controlled vocabulary in TypeScript (`src/lib/ingestion/fields.ts`),
mapped to the physical column it projects onto. Not every field needs a column:
lease-level and tenancy-level facts live only in the ledger and in the
structured tenancy tables below.

**Confidence is never stored on the `opportunities` row.** It lives only on
observations, so it is structurally impossible for it to reach the investor
whitelist (brief section 8).

### C.2 Property identity and longitudinal history

This is the strategically important part (brief section 10) and it needs a fix
to existing behaviour before it can work at all.

```sql
alter table properties
  add column postcode            text,
  add column submarket           text,
  add column country_code        text,        -- ISO-3166-1 alpha-2
  add column address_normalised  text,        -- lowercased, abbreviations expanded,
                                              -- punctuation stripped
  add column identity_key        text,        -- normalised address + postcode digest
  add column first_seen_at       timestamptz default now(),
  add column last_seen_at        timestamptz;

create unique index properties_identity_key
  on properties(org_id, identity_key) where identity_key is not null;
create index properties_postcode on properties(org_id, upper(replace(postcode,' ','')));
create index properties_name_trgm on properties using gin (name gin_trgm_ops);
```

`pg_trgm` is required for fuzzy name matching. It is available on Supabase.

The event spine hangs off **property**, not opportunity, which is what makes
the 2027 relaunch of a 2025 deal part of the same history:

```sql
property_events (
  event_id, org_id,
  property_id     uuid not null,     -- the durable spine
  opportunity_id  uuid,              -- nullable: which marketing campaign
  event_type      text not null,
  -- first_seen | price_quoted | price_changed | broker_changed | brochure_received
  -- | rent_revised | tenancy_revised | market_status_changed | withdrawn
  -- | relaunched | sold | failed_sale | bid_submitted | reiwa_passed
  -- | investor_approached | note
  occurred_at     timestamptz not null,   -- when it happened in the market
  recorded_at     timestamptz default now(),
  headline        text not null,
  detail          text,
  numeric_value   numeric(18,2),     -- e.g. the new guide price
  previous_value  numeric(18,2),
  currency        text,
  source_kind     text,
  source_document_id uuid, source_email_id uuid, ingestion_item_id uuid,
  observation_id  uuid,              -- the ledger entry that produced this event
  created_by      uuid
)
```

The opportunity page shows this filtered to its own `opportunity_id` by
default, with a toggle for the **full property history** across all campaigns.
That toggle is the product. It is the difference between a CRM and Reiwa
Opportunity Intelligence.

### C.3 Ingestion staging

Nothing writes to `opportunities` until a human approves it.

```sql
ingestion_batches (
  batch_id, org_id,
  channel      text,   -- 'upload'|'email_inbound'|'manual'|'api'   ← section 5 seam
  kind         text,   -- 'spreadsheet'|'documents'|'emails'|'mixed'
  label        text,
  status       text,   -- 'received'|'parsing'|'ready_for_review'|'partly_promoted'
                       -- |'completed'|'failed'
  file_count   int, item_count int, promoted_count int, rejected_count int,
  mapping_template_id uuid,
  received_at, created_by, error text
)

ingestion_items (
  item_id, org_id, batch_id,
  item_kind    text,   -- 'spreadsheet_row'|'document'|'email'|'manual'
  sequence     int,    -- row number / attachment order
  raw_payload  jsonb not null,   -- THE ORIGINAL, VERBATIM. Every spreadsheet
                                 -- column including unmapped ones. Never discarded.
  extracted    jsonb not null default '{}',   -- normalised candidate fields
  extraction_status text,  -- 'pending'|'extracting'|'extracted'|'failed'|'skipped'
  review_status     text,  -- 'new'|'needs_review'|'approved'|'merged'|'rejected'|'passed'
  confidence_overall numeric(4,3),
  missing_fields     text[],
  errors             jsonb not null default '[]',
  matched_opportunity_id uuid,   -- set on promotion or attach
  matched_property_id    uuid,
  promoted_at timestamptz, reviewed_by uuid, reviewed_at timestamptz,
  source_document_id uuid, source_email_id uuid
)

match_candidates (
  candidate_id, org_id, item_id,
  property_id uuid, opportunity_id uuid,
  score       numeric(5,4),      -- 0.0000–1.0000
  signals     jsonb,             -- {"postcode":1.0,"address":0.91,"broker":1.0,...}
  decision    text,              -- 'pending'|'attached'|'new_opportunity'|'dismissed'
  decided_by uuid, decided_at timestamptz
)

import_mapping_templates (
  template_id, org_id, name,
  source_hint text,                -- e.g. 'Knight Frank weekly list'
  header_signature text,           -- digest of the header row, for auto-suggest
  mappings jsonb not null,         -- {"Guide Price":"asking_price", ...}
  defaults jsonb not null default '{}',   -- e.g. {"currency":"GBP","country":"GB"}
  created_by, created_at, last_used_at, use_count int
)
```

`ingestion_items.raw_payload` is the answer to "never silently discard an
unrecognised column" and "keep the original source data available". The
unmapped columns survive forever, queryable, whether or not anyone mapped them.

### C.4 Source material

```sql
source_documents (
  document_id, org_id,
  property_id uuid, opportunity_id uuid,      -- both nullable until matched
  batch_id, item_id,
  category     text,    -- brochure|rent_roll|lease|financials|valuation|legal
                        -- |photos|floorplans|email_attachment|other
  title, file_name, mime_type, size_bytes,
  storage_path text not null,     -- PRIVATE Supabase Storage bucket
  content_hash text,              -- sha256; dedupes identical re-sends
  page_count   int,
  extracted_text text,            -- full text, for search
  text_search  tsvector generated,
  extraction_status text, extraction_error text,
  received_at, uploaded_by
)

source_emails (
  email_id, org_id, batch_id, item_id,
  property_id uuid, opportunity_id uuid,
  message_id   text,              -- RFC 5322 Message-ID; dedupes forwards
  in_reply_to text, thread_key text,
  from_name, from_email, from_domain,
  to_emails text[], cc_emails text[],
  subject, sent_at timestamptz,
  body_text text, body_html text,
  signature_block text,
  raw_storage_path text not null, -- the ORIGINAL .eml/.msg, unmodified
  content_hash text,
  attachment_count int,
  received_at, uploaded_by
)
```

Attachments become `source_documents` rows with `source_email_id` set, and are
queued into the same extraction pipeline. A Knight Frank email plus
`Mayfair_Asset_IM.pdf` becomes one opportunity carrying both.

### C.5 Tenancy (brief section 6, occupancy/leasing)

Flat columns cannot hold a tenant schedule.

```sql
tenancies (
  tenancy_id, org_id, property_id, opportunity_id,
  unit_reference, tenant_name, tenant_covenant,
  area_sqft numeric, area_sqm numeric,
  passing_rent numeric, erv numeric, currency text,
  lease_start date, lease_expiry date, break_date date,
  next_review date, review_basis text,
  is_vacant boolean default false,
  source_kind text, source_document_id uuid, confidence numeric(4,3),
  as_of_date date
)
```

WAULT and occupancy are **derived** from this where a schedule exists, and
stored as observations where a brochure states them directly. Never invent one
from the other.

### C.6 Counterparties

`opportunities.broker_name` / `vendor_name` / `source` are free text. At
several hundred opportunities that stops being workable: you cannot answer
"what has CBRE shown us in the last 18 months" reliably.

```sql
counterparty_organisations (org_id, name, name_normalised, kind, domains text[], ...)
counterparty_contacts (contact_id, org_id, counterparty_org_id, name, email,
                       email_domain, phone, title, ...)
```

Add `broker_org_id` / `broker_contact_id` / `vendor_org_id` to `opportunities`
as nullable FKs, **keeping the existing text columns** as the fallback and as
what the whitelist already ignores. Email ingestion populates these naturally
from the sender domain. Phase 3, not Phase 1.

### C.7 Internal notes and investor distribution

```sql
opportunity_notes (note_id, org_id, opportunity_id, body, pinned, created_by, created_at)
```

Investor distribution is **already modelled** by
`publication_entitlements` + `investor_activity_events` + `investor_requests`.
The opportunity page should read those through the admin data layer rather than
create a parallel table.

---

## D · Schema decisions that would create technical debt

These are the calls worth making deliberately now.

**D1 · `createOpportunity` duplicates the property on every create.**
`src/lib/data/opportunities.ts` inserts a fresh `properties` row for every new
opportunity. The property-centric model documented in `docs/10` is therefore
not actually true in the data today, and requirement 10 cannot work until this
is fixed. It must become resolve-or-create against `identity_key`. This is a
bug fix, not a new feature, and it belongs in Phase 1 before any bulk import
lands 500 rows and creates 500 orphan properties.

**D2 · The flat 13-status taxonomy collapses axes that are load-bearing.**
The brief lists NEW, NEEDS REVIEW, SCREENING, UNDERWRITING, WATCHLIST, PASS,
INVESTOR READY, PUBLISHED, UNDER OFFER, ACQUIRED, SOLD, WITHDRAWN, ARCHIVED as
one list. Those are actually three independent things:

- **Reiwa stage** — how far *we* have taken it (drives conversion to asset)
- **Reiwa disposition** — active / watchlist / passed / archived
- **Market status** — what happened to the *asset in the market*, independent
  of us: available, under offer, sold, withdrawn

Collapsing them loses real intelligence. "Withdrawn" as a single status cannot
distinguish "we passed" from "the vendor pulled it", and that distinction is
exactly the proprietary history the brief's section 26 is asking for.
"UNDER OFFER" is worse: it silently conflates *Reiwa* being under offer with
*someone else* being under offer.

**Recommendation** — keep the existing two columns, extend them, and add a
third:

| Brief status | Proposed representation |
| --- | --- |
| NEW | `stage = 'inbox'` (new value) |
| NEEDS REVIEW | not an opportunity status; it is `ingestion_items.review_status` |
| SCREENING / UNDERWRITING | `stage` (exists) |
| WATCHLIST | `status = 'watchlist'` (new value) |
| PASS | `status = 'rejected'` (exists) |
| INVESTOR READY | `stage = 'investor_ready'` (new value) |
| PUBLISHED | derived from `investor_publications.status` (exists — do not duplicate) |
| UNDER OFFER | `market_status = 'under_offer'` + `reiwa_position` if it is us |
| ACQUIRED | `stage = 'acquired'` (exists) |
| SOLD / WITHDRAWN | `market_status` (new column) |
| ARCHIVED | `archived_at` (exists) |

A single `displayStatus(opp)` helper renders one flat label in the UI, so it
*feels* like the brief's list while the data keeps its structure. Every
`market_status` change writes a `property_events` row automatically. If you
would rather have the literal flat enum, say so - but it is a one-way door and
I would not take it.

**D3 · Confidence must never reach an opportunity column.** Keep it on
observations only. The investor whitelist is the bridge, and a column that does
not exist cannot be accidentally added to it.

**D4 · The legacy mock layer is a trap.** `src/types/database.ts` (`Deal`,
`DocCategory`, DD/score/memo types) and `src/lib/mock-data.ts` are a second
type universe feeding `/deals/*` and the mock document vault. New ingestion
code must **not** import from them, or the real document model becomes
entangled with a fixture. The 15-category taxonomy in
`src/lib/documents/catalog.ts` is worth keeping, but it should be re-declared
against the real schema. Recommend deleting the mock vault once Phase 2 lands.

**D5 · Every write must go through the ledger, or the audit trail has holes.**
`updateOpportunity` currently writes columns directly. Once Phase 2 lands it
must record an observation and update `field_state`. Leaving a second write
path open means the timeline silently lies, which is worse than not having one.

**D6 · Currency must be captured per import, not assumed.** Multi-currency is
already real (`fx_rates`, GBP/EUR/USD/JPY). A spreadsheet of Amsterdam deals
imported as GBP corrupts every yield derived from it. The importer needs a
per-batch default plus per-row override, and the preview must show it.

**D7 · Storage is genuinely new surface.** A private bucket, server-side signed
URLs only, and the path convention `org/{org_id}/property/{property_id}/...`.
Investor-facing documents keep their existing separate path and tiering. Do not
let one bucket serve both.

**D8 · Ingestion tables get no investor policy at all.** Following the
migration 0005 pattern: admin/org policies only, so an investor's SELECT
matches no permissive policy and returns nothing. Plus
`revoke all ... from anon, public` on every new table, because Supabase grants
`anon` rights on new `public` tables by default.

---

## E · Ingestion architecture

```
                 upload / (later) inbound email
                              │
                    ingestion_batches  ── channel: upload | email_inbound | manual | api
                              │
                    ┌─────────┴─────────┐
                    │                   │
            spreadsheet parse      file parse
            (xlsx / csv)           (pdf / eml / msg)
                    │                   │
            header detection       text extraction
            mapping suggest        + attachments spawn
            (+ saved template)       child items
                    │                   │
                    └─────────┬─────────┘
                              │
                      ingestion_items  (raw_payload preserved verbatim)
                              │
                       field extraction
                    (deterministic → optional LLM)
                              │
                      match_candidates   (address / postcode / name / broker / price)
                              │
                       REVIEW QUEUE  ← human decision, always
                              │
              ┌───────────────┼───────────────┐
         attach to        create new        reject /
         existing         opportunity        pass
              │               │
              └───────┬───────┘
                      │
        field_observations → conflict check → field_state → opportunities columns
                      │
               property_events (timeline)
```

### Parsing

| Format | Library | Notes |
| --- | --- | --- |
| `.xlsx` / `.xls` | `xlsx` (SheetJS) | Read-only; sheet selection; header row detection |
| `.csv` / `.tsv` | `papaparse` | Delimiter sniffing, quoted fields, BOM |
| `.pdf` | `unpdf` (pdfjs under the hood) | Text + per-page offsets, needed for page provenance |
| `.eml` | `postal-mime` | Pure JS, no native build, runs on serverless |
| `.msg` | `@kenjiuno/msgreader` | Outlook OLE format; degrade gracefully if it fails |

All server-side. None require a native toolchain, which matters for Vercel.

### Column mapping (brief section 3)

A synonym dictionary in `src/lib/ingestion/synonyms.ts` maps header text to
canonical `field_key`s:

```
asking_price    ← price, asking price, guide, guide price, value, quoting, ask, £, offers over
passing_income  ← rent, income, passing rent, passing income, gross rent, current rent, NOI (flagged)
niy             ← yield, niy, net initial yield, cap rate, initial yield
```

Matching is normalise → exact → synonym → fuzzy (trigram) → unmapped. Every
suggestion is shown with its confidence and is overridable. Unmapped columns
are listed explicitly in the preview as "kept, not mapped" and remain in
`raw_payload`. A confirmed mapping can be saved as a template keyed by a
`header_signature`, so the next Knight Frank list auto-suggests itself.

`NOI` mapping to `passing_income` is deliberately flagged rather than silent -
they are not the same number, and conflating them quietly corrupts yields.

### Extraction (brief section 6)

Two tiers behind one interface:

1. **Deterministic** — regex and heuristics for UK/EU postcodes, currency
   amounts, percentages, dates, tenure keywords, area units, plus label
   proximity ("Guide Price" within N characters of a currency amount).
   Fast, free, testable offline, and it produces real page/excerpt provenance.
2. **LLM** — optional, behind `DocumentExtractor`, invoked per document with
   the page text and a strict JSON schema. Confidence per field. Every value it
   returns must carry the excerpt it came from, or it is dropped.

```ts
interface DocumentExtractor {
  name: string;          // recorded as field_observations.extractor
  version: string;
  extract(input: ExtractionInput): Promise<ExtractedField[]>;
}
```

**Never invent a value.** An extractor that cannot ground a field in an excerpt
returns nothing, and the field stays unknown. `missing_fields` on the item is
how the review queue shows what is absent.

### Matching (brief section 9)

Weighted signal score, computed in TypeScript so it is unit-testable without a
database:

| Signal | Weight | Notes |
| --- | --- | --- |
| Postcode exact (normalised) | 0.35 | Strongest single UK signal |
| Address normalised exact | 0.30 | After abbreviation expansion |
| Address trigram similarity | 0.20 | Sliding, if not exact |
| Property name similarity | 0.10 | "Mayfair Asset" vs "16 Conduit Street" |
| Broker match | 0.03 | Weak on its own |
| Price within 10% | 0.02 | Weak; prices move |

Bands: `≥ 0.90` strong (pre-selected, still confirmed), `0.60–0.90` shown as a
candidate, `< 0.60` treated as new. **Auto-merge never happens.** The only
exception worth considering later is an identical `content_hash` or
`message_id`, which is a genuine re-send rather than a similar deal.

### Inbound email seam (brief section 5)

No mail infrastructure now. The seam is `ingestion_batches.channel` and a thin
`POST /api/ingest/inbound` route that is not built yet. When `deals@` is added,
the webhook writes exactly the same `ingestion_batches` + `source_emails` +
`ingestion_items` rows that a drag-and-drop upload writes today. Nothing
downstream changes. Authenticity (SPF/DKIM checks, shared secret) is the
webhook's job when it lands.

---

## F · UI plan

Preserving the existing visual language: navy sidebar, warm-white surfaces,
single muted gold accent, serif headings, dense tables, minimal chrome. No new
design system, no cards where a table works, no animation.

### Navigation

Insert one new sidebar section above **Investment**:

```
OPPORTUNITIES
  Deal Inbox        (badge: items awaiting review)
  Pipeline          (existing /pipeline, extended with filters)
  Properties        (market intelligence: every property ever seen)
  Imports           (batch history, saved mapping templates)
```

### Screens

**`/inbox` — Deal Inbox.** A dense table, not a card grid. Columns: source,
received, sender/broker, extracted property, confidence (bar, not a number),
suggested match, extraction status, review status, issues. Filter chips across
the top; a persistent drop zone that accepts multiple files of mixed type at
once. Selecting rows reveals the bulk action bar (brief section 15).

**`/inbox/import/[batchId]` — Mapping and preview.** Three steps on one page,
not a wizard with pages: detected headers with suggested mappings (each a
select), a preview table of the first 20 rows *after* mapping with unmapped
columns shown greyed and labelled "kept", and a duplicate panel listing rows
with candidate matches. "Save as template" next to Import.

**`/inbox/[itemId]` — Review.** Left: extracted fields with the source excerpt
inline under each, low-confidence rows flagged with a gold left rule (no
numbers shouted at you). Right: the source document/email preview. Bottom bar:
Approve · Edit · Merge into… · Reject · Pass. Keyboard-driven — `J`/`K` to move
between items, `A` to approve, `M` to merge - because the brief's real test is
twenty deals in a morning.

**`/opportunities/[id]` — extended.** Keep the existing header and lifecycle
control. Add tabs alongside the current content: Overview · Financials ·
Tenancy · Documents · Communications · Timeline · Notes · Underwriting ·
Investor Distribution. Every displayed value gets a small provenance affordance
on hover: source, page, date. Conflicts appear inline as a two-column
"existing / new" choice, never as a modal.

**Quick entry.** Not a page - a command-palette-style overlay on `N` from
anywhere: name, location, broker, price, income, yield, note. Save creates the
opportunity at `stage = 'inbox'` and returns you to what you were doing.
Target: under 30 seconds, no navigation.

**Pipeline filters.** A filter rail: country, city, submarket, type, broker,
stage, status, market status, price band, yield band, date received, investor
ready, published. Plus one search box backed by a Postgres `tsvector` across
addresses, brokers, descriptions, notes and email bodies.

**Publishing gate.** The existing "Prepare for Investors" button becomes
disabled until `stage = 'investor_ready'`, with the reason shown. Everything
downstream of that is already built and should not be touched.

---

## G · Implementation phases

Broadly the brief's sequence, with one correction: the property identity fix
must come first, or bulk import writes 500 duplicate properties and the
longitudinal model is dead on arrival.

| Phase | Contents | Migration |
| --- | --- | --- |
| **1** | Property identity (normalisation, postcode, `identity_key`, resolve-or-create, **D1 fix**), `property_events`, status extension (**D2**), ingestion staging tables, xlsx/csv parser, mapping + templates, preview, review queue, bulk actions | `0007`, `0008` |
| **2** | Supabase Storage bucket, `source_documents`, PDF text extraction, deterministic field extractors, `field_observations` / `field_state` / `field_conflicts`, provenance UI, conflict resolution, audit timeline | `0009` |
| **3** | `.eml` / `.msg` parsing, attachment pipeline, `source_emails`, counterparty entities (**C.6**), communications tab | `0010` |
| **4** | Match scoring, `match_candidates`, merge UX, full property history view, `tenancies` | `0011` |
| **5** | `investor_ready` gate, publishing guardrails, distribution tab reading existing portal tables | none |
| **6** | Inbound webhook route against the existing `channel` seam | none |

Each phase ends with a clean `tsc --noEmit`, `next lint`, `vitest` and
`next build`, matching the existing repository standard.

---

## H · Testing — and a blocker worth raising now

The brief asks for tests covering spreadsheet import, mapping, malformed rows,
duplicate detection, email parsing, attachments, extraction, conflicts,
provenance, permissions, publishing and bulk operations.

**The current harness cannot express most of those.** All 15 existing test
files are integration tests that drop, migrate and seed a live Supabase
database; there is no `.env.local` in this environment, so `npm test` cannot
run here at all. Writing parser and matcher tests into that harness would make
them slow, network-dependent and unrunnable in CI without production
credentials.

**Proposal:** split the suite.

- `tests/unit/**` — no database. Header mapping, synonym resolution, malformed
  rows, address normalisation, match scoring, currency and area parsing, email
  parsing, extraction grounding, conflict decision logic. These are the ones
  that actually catch regressions, and they run anywhere in milliseconds.
- `tests/integration/**` — the existing harness, unchanged. RLS and permissions
  on the new tables, promotion into `opportunities`, provenance round-trip,
  investor isolation, bulk operations.

This needs a second vitest project (or split `include` + a `test:unit` script).
It is a small change but it should be agreed, because it changes what `npm test`
means.

Representative fixtures live in `tests/fixtures/` — a messy broker spreadsheet
with merged headers, blank rows, mixed currencies and junk columns; two
brochure PDFs; an `.eml` with a PDF attachment; a near-duplicate of an existing
seeded property. Built before anything touches the real 500-row dataset.

---

## I · What I need from you before Phase 1

1. **D2, the status model.** Three axes as proposed, or the literal flat enum?
   This is the one decision that is expensive to reverse.
2. **Extraction tier.** Deterministic only to start (free, offline, testable),
   or wire an LLM extractor in Phase 2? There is no model key in
   `.env.example` today.
3. **The test split in section H.**
4. **A sample of the real material** - three or four representative broker
   spreadsheets and brochures, anonymised if you prefer. The synonym dictionary
   and the extractors are only as good as the inputs they were built against,
   and guessing at header names is how importers end up rigid.


---

## J · Phase 1 as built

Delivered on `claude/reiwa-deal-ingestion-n8ut39`. Everything above this section
is the original proposal and has not been rewritten.

### Schema

| Migration | Contents |
| --- | --- |
| `0007_property_identity.sql` | `properties` gains postcode, submarket, country_code, address_normalised, identity_key, first/last seen. Partial unique index on `(org_id, identity_key)`. `pg_trgm` for fuzzy lookup. `property_events` table. Status axes: `stage` gains `inbox` and `investor_ready`, `status` gains `watchlist`, `market_status` and `reiwa_position` added. Backfills existing rows and opens a timeline for every existing opportunity. |
| `0008_deal_ingestion.sql` | `ingestion_batches`, `ingestion_items`, `match_candidates`, `import_mapping_templates`. `raw_payload` frozen by trigger. `channel` seam for the future inbound address. |

Both follow the 0002/0005 posture exactly: org-scoped RLS, **no investor policy
of any kind**, `anon`/`PUBLIC` revoked, trigger functions not granted.

### Modules

```
src/lib/ingestion/
  fields.ts        canonical field vocabulary + column projection
  parse-values.ts  money / percent / area / date, each with confidence + notes
  normalise.ts     postcode, address, name, identity key, similarity
  synonyms.ts      header dictionary, incl. flagged near-synonyms
  mapping.ts       four-pass header mapping, templates, summaries
  rows.ts          raw row + mapping -> typed draft, issues, missing fields
  match.ts         weighted signal scoring, banding, disposition
  status.ts        three axes -> one display label; the publish gate
  spreadsheet.ts   xlsx/csv parsing and header-row detection (server only)

src/lib/data/
  properties.ts       resolveProperty (the D1 fix), candidate lookup
  property-events.ts  the longitudinal spine
  ingestion.ts        batches, items, candidates, promotion, bulk actions
```

### Screens

`/inbox` (queue, filters, search, bulk actions) · `/inbox/import` (upload,
mapping, preview, save template) · `/inbox/[itemId]` (review with per-value
provenance and match candidates) · Quick Opportunity (`N` from anywhere) ·
the timeline on `/opportunities/[id]` with its **this campaign / whole
property** toggle · the investor-ready gate in front of the existing portal
flow.

### Decisions taken during the build

- **exceljs, not `xlsx`.** The npm build of `xlsx` carries two high-severity
  advisories with no fix available on npm (prototype pollution, ReDoS), both of
  which apply directly to parsing untrusted input. `uuid` is pinned forward with
  an override rather than accepting npm's suggested major downgrade of exceljs.
  The ingestion dependency path reports no advisories.
- **`npm run db:verify`.** Applies the whole migration chain to a throwaway
  local PostgreSQL cluster and asserts 53 claims - RLS isolation, investor
  denial, no `anon` privileges, identity uniqueness, raw-payload immutability,
  status constraints, event survival, the D1 fix, promotion, attach-fills-blanks,
  and the publish gate. Needs no Supabase credentials, so it runs on a fresh
  clone and in CI. It complements `tests/integration`, which still exercises the
  real Supabase runtime and Supabase Auth.

### Verification

`168 unit tests` · `53 live-database assertions` · `tsc --noEmit` ·
`next lint` · `next build` - all clean.

### Carried into later phases

- Field provenance is currently per-item (`ingestion_items.extracted` carries
  value, confidence, notes, excerpt and source column). The
  `field_observations` / `field_state` / `field_conflicts` ledger in §C.1 lands
  in Phase 2 with document extraction, and **D5 applies from that point**: every
  write must route through the ledger or the audit trail has holes.
- Pipeline filtering and cross-entity search (§16) beyond the inbox.
- Counterparty entities (§C.6), tenancy (§C.5), documents and storage (§19).
