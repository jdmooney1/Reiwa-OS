# 物件概要書 (Property Summary) — Session 1 Audit

**Read-only.** No code, no migration, no branch work beyond creating
`feature/teaser-generator` (from `claude/quirky-meitner-k4tokb`, current head
at the time of this audit — Session 4a + `0060`). Nothing here has been run
against any database. Stop for approval before Session 2.

---

## 0. Three findings that change the shape of the plan

1. **There is no PDF render pipeline anywhere in this codebase yet.** `grep`
   for `chromium`/`playwright`/`puppeteer`/`pdf-lib` across `src/` finds
   nothing outside Playwright's own E2E test driver. The `/opportunities/
   [opportunityId]/memo/print` route is a browser print stylesheet — the
   person's own browser does the PDF conversion, nothing server-side does.
   docs/24 §7's "deferred Chromium decision" is still fully deferred. **This
   teaser is the first real server-side render pipeline in Reiwa OS**, not an
   extension of one. Session 3 is building infrastructure, not plumbing into
   existing infrastructure — sized accordingly below.

2. **"Teaser" already means something else in this codebase, and it is not
   the blind document.** `src/lib/memo/compose.ts`'s `format: "teaser"` is an
   *audience filter* over the full memo (external-audience blocks only —
   strips financing structure, DD findings, the risk register) — it still
   carries the real address, price and market. It is **not** anonymised. The
   actual redaction the brief wants (strip address/vendor/broker/tenant
   identifiers) is docs/24 §6's `renderInvestorTeaserDoc`, named there and
   explicitly scoped to Session 6 — and **it does not exist yet**. Building
   it is this project's job, not a reuse of something already built. See §3.

3. **The brief's five brand colours are not the app's five tokens.** Only one
   matches exactly. See §6 — this needs a decision before Session 3, not a
   silent assumption either way.

---

## 1. Data contract — field by field

Legend: ✅ exists and is directly usable · 🟡 exists but needs a derived
value or small extension · ❌ does not exist, needs a migration.

### 1.1 所在 / Location

| Field | Status | Where |
|---|---|---|
| Address | ✅ | `properties.address`, `.city`, `.country`, `.postcode` (0002, 0012) |
| Lot number / 地番 | ❌ | no column |
| NL kadastrale aanduiding | ❌ | no column — same slot as lot number, different label by jurisdiction |
| UK HM Land Registry title number | ❌ | no column |
| Lat/long (for maps) | ✅ | `properties.latitude`/`longitude` (0002) |
| Formatted address (geocoder) | ✅ | `properties.formatted_address` (0016) |

### 1.2 交通 / Access

| Field | Status | Where |
|---|---|---|
| Transport connectivity (free text) | 🟡 | `properties.transport_connectivity` (0032) — free text, not a structured station/line/walk-minutes list. The brief's table wants individual rows (station, line, minutes); this column is one paragraph. **Needs either a small structured JSON column or acceptance that this ships as prose in the Remarks-adjacent slot.** |
| Nearest airport / city-centre minutes | ❌ | not derivable from any existing field — would need a static lookup (Schiphol/Heathrow, Amsterdam Centraal/a London terminus) keyed on city, or a geocoding-based distance calc. Cheapest correct option: a small static table, not a geocoding API call, since there are only ever two cities in scope today (London, Amsterdam) |

### 1.3 土地 / Land

| Field | Status | Where |
|---|---|---|
| 地目 / Use | 🟡 | `opportunities.asset_type` exists but is Reiwa's own pipeline vocabulary (`office`/`retail`/etc.), not a legal land-use designation. Different thing, same neighbourhood — don't conflate |
| 権利 / Tenure | ✅ | `properties.tenure` (0032): `freehold \| virtual_freehold \| long_leasehold \| short_leasehold \| other`. Maps cleanly to 所有権/借地権 |
| Unexpired term (leasehold/erfpacht) | ✅ | `properties.unexpired_term_years` (0032) |
| Ground rent | ✅ | `properties.ground_rent_pa` / `.ground_rent_note` (0032) — `ground_rent_note` already exists for exactly the "Peppercorn"-style non-numeric case the brief describes for erfpacht canon |
| Erfpacht canon status (bought off / revision date) | ❌ | `ground_rent_note` is free text and could carry "canon bought off" as prose, but the brief wants it as a **structured fact** (買取済 / 改定予定 + a date). Needs an enum + nullable date |
| 地積 / Site area | 🟡 | No separate site-area column exists. `opportunities.size_sqft`/`size_sqm` is the BUILDING area (GFA), not the LAND area. **Real gap** — a Dutch/UK land area is routinely different from GFA on anything above single-storey |

### 1.4 建物 / Building

| Field | Status | Where |
|---|---|---|
| 種類 / Type | ✅ | `opportunities.asset_type` |
| 構造 / Structure, floors | ❌ | no column anywhere |
| 延床面積 / GFA | ✅ | `opportunities.size_sqft`/`size_sqm` — confirm with you whether this has always meant GFA in practice; the brief also wants NLA separately |
| 賃貸面積 / NLA | ❌ | no separate column — today there is one area figure, not a GFA/NLA pair |
| 竣工 / Completion year | ❌ | **no completion/year-built column anywhere in the schema.** Not even free text. This is the gap most likely to block the sample deal (Session 4's 1921-built, 2022-refurbished fixture) if not added |
| Monument status | ✅ | `properties.heritage_status` (0032, free text) — already exactly this slot; no new column needed, just render it in the 建物 group rather than inventing a second field |

### 1.5 公法規則 / Regulation

| Field | Status | Where |
|---|---|---|
| 用途地域 / Zoning (UK use class, NL bestemmingsplan) | ❌ | no column. `src/lib/dd/templates.ts` already asks this as a DD **question** (`"Zoning (bestemmingsplan)"`, `"Monument status"`) for both jurisdictions — confirms the vocabulary is already established in this codebase, just not yet captured as a stored fact anywhere |
| Conservation area / other restriction (free text) | 🟡 | could reuse `heritage_status` if monument and conservation-area never coexist on one property; they can, so this likely wants its own short free-text column |

### 1.6 公的評価 / Official valuation

| Field | Status | Where |
|---|---|---|
| NL WOZ value + year | ❌ | no column |
| UK rateable value | ❌ | no column |

The brief says omit the row if empty — both sides are new columns regardless
of jurisdiction, so this row is empty for every deal until Session 2 adds
them.

### 1.7 取引形態 / Transaction form

| Field | Status | Where |
|---|---|---|
| Asset deal vs share deal (SPV/BV) | ❌ | no column. `opportunities.deal_stage` (0032: `early_dialogue \| guided \| under_offer`) is a different axis (where the SALE PROCESS is), not this one |

### 1.8 Investment summary (page 2)

| Field | Status | Where |
|---|---|---|
| Asking price | ✅ | `opportunities.target_price` + `.currency` |
| JPY equivalent + FX rate used | 🟡 | `fx_rates` + `convertViaGbp()` (`src/lib/fx.ts`) already compute an arbitrary currency → currency conversion via the GBP cross-rate — **the mechanism exists**, but there is no existing "display this as a single €→¥ cross-rate string" helper. Pure derived-value work, no schema or FX-infrastructure change. `investment_cases`/opportunities also already lock a rate at IC approval (`fx_rate_to_gbp_at_approval` etc., 0026) — reuse that as the "locked" rate rather than a live one, consistent with how the memo Snapshot already does it (`MemoSource.fxLock`) |
| Annual rental income | ✅ | `opportunities.passing_rent` |
| NOI | ✅ | `investment_cases.noi` |
| 表面利回り / gross yield | ✅ | `opportunities.niy` |
| NOI利回り / NOI yield | 🟡 | No direct column — derivable as `noi / target_price`, needs a derived function, not a new column |
| 稼働率 / occupancy | ✅ | `investment_cases.occupancy_pct` / `assets.occupancy_pct` |
| テナント数 / tenant count | ❌ | no column anywhere |
| WALT | ✅ | `properties.wault_to_expiry_years` / `.wault_to_breaks_years` (0032) |
| 建物比率 / building-to-land value ratio | ❌ | no column. The brief is explicit this must be a **stated fact from the record, never computed** — so this is a plain nullable numeric column, not a derived-value function, and it needs the tax disclaimer paired with it wherever it renders |

### 1.9 Everything else the brief names

| Field | Status | Where |
|---|---|---|
| Code name (for blind filenames/labels) | ❌ | no column. `opportunities.reference` (e.g. "RC-LON-0012") exists and is already used as a non-identifying handle in the Snapshot (`MemoAssetFacts.reference`) — **likely reusable as the code name directly**, pending your confirmation it never leaks an address/building name by construction (it doesn't today) |
| Photo | ✅ | `property_photos` (0019), the same diligence-tier-cleared photo the Snapshot already uses (`MemoAssetFacts.photoId`) |
| Map | ✅ | `properties.latitude`/`longitude`, `formatted_address`; `street_view_pano_id` (0017) for a close-in view if wanted |
| KPI badge data (稼働率, 駅徒歩, 築年, WALT, 利回り) | 🟡 | all either exist (occupancy, WALT, yield) or are blocked on the same gaps already listed (walk minutes, completion year → 築年) |

### 1.10 Summary: the smallest migration that covers this

One migration, additive only, nullable throughout (matching 0032's own
posture — "every column is nullable, and NULL means the source did not
say"):

- `properties`: `land_area_sqft`/`land_area_sqm`, `completion_year` (int),
  `floors` (int), `structure_type` (text), `erfpacht_canon_status` (enum:
  `bought_off` / `revision_pending`, nullable, + `erfpacht_canon_revision_at`
  date), `cadastral_reference` / `title_number` (one column, labelled by
  jurisdiction at render time — not two columns for the same fact), `zoning`
  (text), `conservation_area` (text, nullable), `woz_value` (numeric) +
  `woz_value_year` (int), `rateable_value` (numeric).
- `opportunities`: `nla_sqft`/`nla_sqm` (so GFA and NLA can differ),
  `transaction_form` (enum: `asset_deal` / `share_deal`), `tenant_count`
  (int), `building_value_ratio_pct` (numeric — **stated, never computed**,
  per the brief).
- A small static lookup (code, not a migration) for airport/city-centre
  minutes, keyed on city — not worth a table for two cities.

Everything else named in the brief already exists. That is a materially
smaller gap than the brief's own guess list implied — tenure, WALT, heritage
status, ground rent and transport connectivity are **already there** from
0032's broker-intake work.

---

## 2. What's reusable, concretely

- **Anonymisation**: nothing to reuse — build it once, in the place docs/24
  §6 already named (`src/lib/deal-documents/memo-backing.ts`,
  `renderInvestorTeaserDoc`), and make the PDF the first and only caller.
  "One redaction implementation, not two" means this function is also what
  any future on-screen blind preview would call — never a second strip-list
  duplicated in a template.
- **The named variant maps directly onto `pitch_pack`.** Scope=deal,
  `memo_backed`, released by the existing `release_pitch_pack_and_portal_access`
  gate action the moment `deal_investor.status` reaches `nda_signed` — which
  is *exactly* what `0060` (Session 4a) already automates. The blind/named
  split in the brief is not a new access-control problem; it is docs/24's
  existing `investor_teaser` (blind, exempt, always visible) vs `pitch_pack`
  (named, entitlement-gated, unlocked by `0060`) distinction, already built
  and tested. Session 3 needs zero new RLS/entitlement work for *visibility*
  — only the render.
- **FX**: `src/lib/fx.ts`'s `convertViaGbp` + `fx_rates` + the locked-rate
  columns on `investment_cases` (0026) are a complete, tested mechanism for
  exactly the EUR→JPY-via-GBP conversion the brief wants. Needs one new pure
  function (a cross-rate display string, `"€1=¥185"`), not new
  infrastructure.
- **坪**: `src/lib/units.ts`'s `sqmToTsubo`/`areaFrom` already exist and are
  already used by the memo composer. Zero new code for this.
- **Geocoding/maps**: `properties.latitude`/`longitude`,
  `formatted_address`, `street_view_pano_id` are real, populated fields
  (0016/0017). No gap.
- **Design tokens / fonts**: Noto Sans JP + DM Sans are already loaded
  (`src/app/layout.tsx`, docs/24 §8) and already render Japanese correctly
  in the browser — but docs/24 §7 flags, correctly, that a **headless render
  context needs its own font embedding**; `next/font`'s browser-side loading
  does not help a server-side Chromium process. This is real, unresolved
  work for Session 3, not a reuse.
- **Figures/legal copy pattern**: `src/lib/investor-copy.ts` is the
  established "one file, one source of truth" pattern for investor-facing
  wording (`INVESTOR_FIGURES_DISCLAIMER`, `TARGETS_DISCLAIMER`). The brief's
  new disclaimers (tax/depreciation advice, "estimates not guaranteed")
  belong in this same file, not a new one.
- **Versioning/hashing/immutability**: `document_version` (0040) already
  gives SHA-256 + lock-on-final for free; nothing to build.
- **Manual-upload fallback (decision F, `0059`)**: already shippable today —
  staff can upload a drafted PDF against `investor_teaser`/`pitch_pack` right
  now, tagged `is_manual_override`, while the generator doesn't exist yet.
  This is the brief's own stated fallback and it needs no further work to
  use.

---

## 3. Template registry — does not exist

There is no `template_key → renderer` map anywhere in the code. `doc_type
.template_key` (0035) and `document_version.template_key` (0040) are plain
text columns with nothing reading them yet — Session 6 was always going to
need to build the first one. Registering `teaser.jp_property_summary.v1`
means **creating** the registry, not adding to one.

Recommendation: a small, explicit map in
`src/lib/documents/templates/registry.ts` —
`Record<string, (ctx) => Promise<Buffer>>` — with
`teaser.jp_property_summary.v1` as its first and, for now, only entry. This
is intentionally the minimum viable registry; it is not a general templating
engine, and it should not try to be one on the strength of a single caller.

---

## 4. Rendering recommendation

**Server-side Chromium via Playwright, as a standalone render service, not a
Vercel serverless function.**

Reasoning:
- A `@sparticuz/chromium`-on-Vercel-serverless approach exists and works for
  light PDFs, but this template is dense (bordered tables, embedded CJK
  glyphs, map images, a 4–6MB cold Chromium binary) and runs facing-page
  bilingual generation — two full A4 landscape pages × two languages, with a
  font embed step docs/24 §7 already flags as unsolved. Vercel serverless
  functions have a binary size ceiling and a cold-start cost that bites
  exactly this kind of job, repeatedly, in production.
- This project is already running Chromium in this environment for
  Playwright E2E tests (`PLAYWRIGHT_BROWSERS_PATH`, confirmed working) — the
  *browser* isn't the obstacle, the *hosting model* is.
- A small, separate render service (a tiny Node/Express or Fastify process,
  deployed anywhere that isn't serverless-with-a-size-limit — a small
  always-on container is enough) gets a persistent Chromium instance, no
  cold starts, and no fighting Vercel's function size ceiling for a bundled
  Noto Sans JP font file. The main app calls it over HTTP with a short,
  internal-only token.
- Embed Noto Sans JP as a `@font-face` with a `data:` URI or a file the
  render service serves itself — never rely on the OS or a CDN at render
  time, for the same reason docs/24 §7 already distrusts `next/font` here.

This is the single largest infrastructure decision in this project and
should be confirmed with you before Session 3, not defaulted silently.

## 5. Map tiles — licence

Recommend **OpenStreetMap-based tiles (e.g. via MapTiler or Stadia Maps, both
of which offer a paid static-tile API suitable for embedding in distributed
PDFs) with an `© OpenStreetMap contributors` attribution line on every map**,
per OSM's own licence (ODbL) requirement. Google Maps Static/Street View
tiles are explicitly **not licensed for redistribution in a PDF leaving
Google's own surfaces** without a commercial agreement — using them here
would need a confirmed Google Maps Platform contract, not just an API key.
Default to OSM-based unless you tell me such an agreement already exists.

---

## 6. Design tokens — the brief's palette does not match the app's

Checked `tailwind.config.ts` and `globals.css` directly against the five
named colours:

| Brief | Hex | In the app? |
|---|---|---|
| Sumire Purple | `#271430` | ✅ — `purple.DEFAULT` / `ink.DEFAULT` (unnamed "Sumire" in code, same hex) |
| Warm Beige | `#FCFAF1` | ❌ — the app's actual page background is `surface.DEFAULT = #F3EFE7`, a different (slightly darker, less yellow) cream |
| Night Black | `#110A1A` | ❌ — the app has no separate near-black; `ink.DEFAULT` reuses the brand purple `#271430` itself as body text colour |
| Sakura Pink | `#F5CAE0` | ❌ — does not exist anywhere in the codebase |
| (unnamed accent) | `#E89BBF` | ❌ — does not exist anywhere in the codebase |

Only one of five matches. **This needs your decision, not an assumption
either way:**
- If these four new values are confirmed correct (e.g. from a brand guide
  that exists outside the repo), they should be added as **print-only**
  constants scoped to the teaser template — not merged into
  `tailwind.config.ts`'s app-wide theme, which was tuned for on-screen
  admin-portal contrast, not a branded A4 print document. A plain templates
  file (e.g. `src/lib/documents/templates/jp-property-summary/tokens.ts`)
  mirroring Tailwind's own naming is the smallest footprint: one file, no
  risk to any existing page.
- If they are not confirmed, I'd want the real values before Session 3
  rather than build against four invented hex codes that happen to look
  plausible.

---

## 7. File structure (Sessions 2–4, not built yet)

```
supabase/migrations/0061_teaser_property_facts.sql   — §1.10's columns, additive, nullable

src/lib/units.ts                                      — EXTEND: era (和暦) conversion
src/lib/fx.ts                                         — EXTEND: cross-rate display string
src/lib/wareki.ts (new)                               — 西暦→和暦, 明治/大正/昭和/平成/令和, unit-tested at every boundary

src/lib/deal-documents/memo-backing.ts (new)          — docs/24 §6's named file; renderInvestorTeaserDoc
                                                         (blind) + a second function for the pitch_pack/named path
src/lib/documents/templates/registry.ts (new)         — the template_key → renderer map
src/lib/documents/templates/jp-property-summary/
  tokens.ts (new)                                     — pending §6's decision
  layout.tsx or .html (new)                           — the two-page JA/EN facing template
  facts-table.tsx (new)
  cover-email.ts (new)                                — plain text, JA + EN

(separate repo/service, exact shape TBD per §4)        — the render service itself

tests/unit/wareki.test.ts (new)
tests/unit/teaser-facts-guard.test.ts (new)           — every numeric token traces to a source field
tests/unit/teaser-redaction.test.ts (new)             — blind render contains no redacted value, incl. alt text/map labels/PDF metadata
tests/unit/teaser-cross-rate.test.ts (new)
```

---

## 8. Open questions for you (before Session 2)

1. **Rendering**: standalone render service (recommended, §4) vs. accepting
   Vercel serverless's size/cold-start cost — confirm before Session 3's
   scope is fixed.
2. **Design tokens**: confirm the four new hex values (§6) are real, or give
   me the real ones.
3. **GFA vs NLA**: confirm `opportunities.size_sqft`/`size_sqm` has always
   meant GFA in this dataset, so the new NLA columns are genuinely additive
   and not a rename.
4. **Code name**: confirm `opportunities.reference` is safe to reuse as the
   blind code name (it already is, by construction — reference strings
   carry no address/building-name component today).
5. **Transport access list**: a short paragraph in
   `transport_connectivity` (reusing the existing column) vs. a real
   structured list of station/line/minutes rows — the brief's table implies
   the latter; the schema today only has the former.
6. **Migration number**: `0061`, confirmed against both branches — the live
   branch (`claude/reiwa-os-phase-1b-product-polish`, unchanged at `d25d024`
   since the last merge) tops out at `0035`, already fully reconciled into
   this branch via `0053`.

Stopping here, per Session 1's scope. `feature/teaser-generator` has been
created from `claude/quirky-meitner-k4tokb`; this file is the only thing on
it so far.
