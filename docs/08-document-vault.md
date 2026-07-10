# 08 · Document Vault & AI Document Ingestion

The vault turns uploaded files into **structured deal memory**, not a file dump. Every
document is categorised, linked to a deal, and run through an AI ingestion step that
extracts structured findings — from which DD tasks and risks can be created.

## Categories (15)

Broker Brochure · Rent Roll · Lease · Title · Valuation · Technical DD · Planning ·
EPC · Capex Quote · Tax Memo · Legal Memo · Photos · Floorplans · Financial Model ·
Investor Presentation.

Each category maps to an icon and to the DD section a finding-derived task belongs to
(`src/lib/documents/catalog.ts`) — e.g. Rent Roll / Lease → *Income Profile and
Tenancy*, EPC → *ESG and Compliance*, Title → *Tenure and Ownership*.

## Ingestion workflow

1. **Upload** — adds a document in `uploaded` status.
2. **Assign category** — from the drawer (drives the DD-section mapping).
3. **Link to deal** — documents are deal-scoped.
4. **Extract key information** — `generateExtraction()` composes structured findings
   grounded in the deal's own figures (placeholder for a document-AI backend).
5. **Generate summary** — an AI summary heads the extraction.
6. **Flag missing information** — captured as its own finding list.
7. **Create DD tasks / risks from findings** — one click on a finding creates a linked
   DD workstream or risk.

Status lifecycle: `uploaded → processing → extracted → reviewed`.

## Extraction shape (structured deal memory)

Each ingested document captures: **summary, key facts, financial figures, lease terms,
risks, missing information, suggested follow-up questions**. Stored in
`document_extractions` (1:1 with `documents`), arrays per field.

## Creating DD tasks & risks

- *Missing information* and *follow-up questions* → **Create DD task** (`ddItemFromFinding`)
  — a `requested` DD item in the mapped section, jurisdiction from the deal market,
  linked back to the source document.
- *Risks* → **Create risk** (`riskFromFinding`) — an open risk (P3×I3) linked to the
  document.

## UI (Deal → Documents)

- **Vault control bar** — document count, reviewed, pending ingestion, open findings;
  Upload button.
- **Filters** — by category and ingestion status.
- **Document grid** — cards showing icon, category, ingestion status, and finding
  counts (figures / risks / gaps / follow-ups) with linked-DD count.
- **Document detail drawer** — metadata (editable category, status, deal link), the
  **AI Ingestion** action, the **extracted-data panel** (six finding groups, each risk
  or gap actionable), and **Linked DD Items** / **Linked Risks** panels.

## Wiring a real backend later

Replace `generateExtraction()` with a document-AI / LLM call (OCR + extraction) and
persist to `document_extractions`. The UI already wraps ingestion in a simulated
processing delay, so swapping in the network call needs no UI change. Uploads currently
add placeholder rows client-side; wire these to Supabase Storage + a signed-URL upload
when the backend lands.
