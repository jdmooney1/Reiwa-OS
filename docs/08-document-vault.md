# 08 · Documents

Two different document stories live under this heading. Phase 0 separated them,
because conflating them was how an unbuilt feature borrowed the credibility of a
built one.

> **Status, corrected.** This status block previously listed the opportunity-scoped
> vault as something "Phase 1 must build." That became stale once migration `0008`
> shipped `opportunity_documents`, and stayed stale — uncorrected — until the docs/24
> audit caught it. Three document stories now live under this heading, not two.
>
> | | |
> | --- | --- |
> | **Exists today, in production** | **Investor document delivery** — private bucket, tier-gated entitlements, 60-second signed URLs, append-only download trail. Described in §1. |
> | **Exists today, built** | **The opportunity document vault** — `opportunity_documents` (migration `0008`), `org_id`-scoped, real Storage upload, the vault screen at `/opportunities/[opportunityId]/documents`. §2, corrected below. |
> | **Exists today, built, a third system** | **The deal document catalogue** (`deal_document`, docs/24) — catalogue-driven, versioned, gated documents, deliberately kept separate from the ad-hoc vault above. See §2a. |
> | **Reusable domain logic** | `src/lib/documents/catalog.ts` — the 15-category taxonomy and its mapping to DD sections. Pure, kept intact, used by §2. |
> | **Deleted, deliberately** | The "AI document ingestion" engine. §3. |

---

## 1. Investor document delivery (built)

The only path from an investor to a byte. An investor never receives a storage
path, a bucket name or a public URL: they present a document id and receive a
short-lived signed URL, **but only after the database has agreed**.

- **One private bucket**, `publication-documents`. Never public.
- **Signed URLs live 60 seconds** — short enough that a link copied into a chat
  message, a browser history or a proxy log is already dead.
- **Authorisation is in the database**, not in the delivery module. The
  `publication_documents_tiered` policy (migration `0005`) decides from
  `auth.uid()` alone:
  - *standard* entitlement → standard documents
  - *diligence* entitlement → standard and diligence
  - `internal` → refused at every tier, unconditionally
  - a revoked entitlement, deactivated contact, suspended organisation,
    withdrawn publication or superseded version makes the row simply not exist

  `src/lib/documents/secure-delivery.ts` therefore holds no tier comparison, no
  status check and no organisation id. **A defect there cannot widen access,
  because the row never arrives.** A guessed or tampered document id selects zero
  rows and is refused exactly like a revoked one.
- **`document_downloaded` is written only after a URL is successfully minted**, so
  the activity trail records deliveries, never attempts.
- Contract constants (`DOCUMENT_BUCKET`, `SIGNED_URL_TTL_SECONDS`,
  `MAX_DOCUMENT_BYTES`) live in `src/lib/documents/constraints.ts`, which imports
  nothing — the admin publication screen is a client component, and any import
  there would pull the Supabase admin client, and its secret key, into the browser
  bundle.

Phase 1 must not touch any of this.

---

## 2. Opportunity document vault (built)

### Categories (15) — preserved

Broker Brochure · Rent Roll · Lease · Title · Valuation · Technical DD · Planning ·
EPC · Capex Quote · Tax Memo · Legal Memo · Photos · Floorplans · Financial Model ·
Investor Presentation.

Each category maps to an icon and to **the DD section a finding-derived task would
belong to** (`src/lib/documents/catalog.ts`) — Rent Roll and Lease → *Income Profile
and Tenancy*, EPC → *ESG and Compliance*, Title → *Tenure and Ownership*, and so on.

That mapping is the genuinely valuable part and survived Phase 0 intact. It is what
turns a folder of files into structured diligence memory rather than a file dump.

### What was built (migration `0008`, `src/lib/data/opportunity-documents.ts`)

- `opportunity_documents`, keyed on `opportunity_id`, `org_id`-scoped, the standard
  RLS policies: `storage_path`, `category` (free text, the 15-category taxonomy
  above is an app-layer convention, not a DB enum), `file_name`, `mime_type`,
  `size_bytes`, `access_level` (`standard`/`diligence`/`internal`), `uploaded_by`,
  `created_at`. (No `version` column — this table is for ad-hoc, single-shot
  uploads; a document that needs real versioning belongs in `deal_document` instead,
  §2a.)
- Real upload to Supabase Storage, in the **same** private bucket as investor
  document delivery (`publication-documents`) — a relationship, not a second storage
  system.
- The vault screen at `/opportunities/[opportunityId]/documents`, filtered by
  category, linked to the DD section its category maps to.

Reuses the delivery discipline from §1, exactly as planned — private bucket,
server-minted short-lived signed URLs, authorisation decided by a policy rather than
by application code.

## 2a. The deal document catalogue — a deliberately separate third system

`opportunity_documents` is for a stray file with no catalogue entry, no gate, no
version history. `deal_document` (docs/24) exists only for rows that name a
`doc_type` catalogue entry: it is versioned (`document_version`), stage-gated, and
investor/counterparty-scoped where the catalogue says so. The two are enforced apart,
not left to convention — `deal_document.doc_type_key not null references
doc_type(key)` makes a catalogue type unable to live anywhere else, and a trigger on
`opportunity_documents` (migration `0039`) refuses a new row whose free-text category
collides with a catalogue key or name. See `24-deal-document-system.md` §9 for the
full reasoning.

---

## 3. AI document ingestion (deleted)

`src/lib/documents/ingest.ts` was removed in Phase 0 and should not be
reintroduced in its previous form.

`generateExtraction(category, deal)` returned **hardcoded strings selected by a
`switch` on the document category**, interpolating a few figures from the deal for
plausibility. It never read a file. It presented its output under headings —
*summary, key facts, financial figures, lease terms, risks, missing information,
follow-up questions* — and the UI wrapped it in a simulated processing delay so it
appeared to be analysing the upload. One click then turned those invented
"findings" into live DD workstreams and risks.

So a lease nobody had read produced a confident list of lease terms, and a risk
register could be populated from a document that was never opened. This is the
same failure mode as the memo generator ([`07`](07-memo-generator.md)), and worse,
because the output was actionable.

**If document intelligence is built later:** it must run against the actual file
(OCR plus extraction), persist what it found alongside a reference to the source
document and page, and tag every statement with provenance — the discipline already
used in [`09-asset-intelligence.md`](09-asset-intelligence.md). Findings must remain
distinguishable from human-entered diligence at every point, including after they
have been turned into DD items.

The extraction **shape** was sound and can be reused: summary, key facts, financial
figures, lease terms, risks, missing information, follow-up questions. It was the
fabricated content, not the structure, that had to go.
