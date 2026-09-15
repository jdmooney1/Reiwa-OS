# 08 · Documents

Two different document stories live under this heading. Phase 0 separated them,
because conflating them was how an unbuilt feature borrowed the credibility of a
built one.

> **Status after Phase 0.**
>
> | | |
> | --- | --- |
> | **Exists today, in production** | **Investor document delivery** — private bucket, tier-gated entitlements, 60-second signed URLs, append-only download trail. Described in §1. |
> | **Reusable domain logic** | `src/lib/documents/catalog.ts` — the 15-category taxonomy and its mapping to DD sections. Pure, kept intact. |
> | **Phase 1 must build** | An opportunity-scoped document vault: a `documents` table keyed on `opportunity_id`, upload through Storage, and the vault screen. §2. |
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

## 2. Opportunity document vault (to build)

### Categories (15) — preserved

Broker Brochure · Rent Roll · Lease · Title · Valuation · Technical DD · Planning ·
EPC · Capex Quote · Tax Memo · Legal Memo · Photos · Floorplans · Financial Model ·
Investor Presentation.

Each category maps to an icon and to **the DD section a finding-derived task would
belong to** (`src/lib/documents/catalog.ts`) — Rent Roll and Lease → *Income Profile
and Tenancy*, EPC → *ESG and Compliance*, Title → *Tenure and Ownership*, and so on.

That mapping is the genuinely valuable part and survived Phase 0 intact. It is what
turns a folder of files into structured diligence memory rather than a file dump.

### What Phase 1 must build

- A `documents` table keyed on `opportunity_id`, `org_id`-scoped, with the standard
  RLS policies: `storage_path`, `category`, `file_name`, `mime_type`, `size_bytes`,
  `version`, `uploaded_by`, `uploaded_at`.
- Real upload to Supabase Storage. The previous vault added placeholder rows in
  client state and uploaded nothing.
- A vault screen: filters by category, and the link from a document to the DD
  section its category maps to.

Reuse the delivery discipline from §1 — private bucket, server-minted short-lived
signed URLs, authorisation decided by a policy rather than by application code.

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
