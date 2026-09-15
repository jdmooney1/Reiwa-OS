# 05 · Due Diligence Framework

The DD Tracker is an **investment risk-control system**, not a task list. It encodes
Reiwa Capital's standing diligence frameworks for London and Amsterdam and tracks every
workstream from request to clearance, surfacing issues to the investment committee.

> **Status after Phase 0.**
>
> | | |
> | --- | --- |
> | **Exists today** | Nothing. There is no DD screen and no DD table. |
> | **Reusable domain logic** | The frameworks themselves — `src/lib/dd/templates.ts` (both market templates, jurisdiction-branched) and `src/lib/dd/progress.ts` (completion and critical-item computation). Both are pure, tested by nothing yet, and depend on no removed code. |
> | **Phase 1 must build** | A `due_diligence_items` table scoped to `opportunity_id`, the server actions to apply a template and update a status, and the tracker screen. |
>
> The DD tracker previously rendered at `/deals/[dealId]/due-diligence` against
> `src/lib/mock-data.ts`. Statuses changed in React state and were never written
> anywhere. That screen was removed in Phase 0; the frameworks below survived it,
> which is the point — **the firm's diligence IP was the valuable part, not the
> screen.**

## Framework sections (21)

Both market templates share one section spine, in investment-memo order:

Executive Summary · Submarket Overview · Location and Micro Situation · Asset
Description · Tenure and Ownership · Income Profile and Tenancy · Tenant Covenant
Review · Planning and Heritage · ESG and Compliance · Market Commentary · Valuation
Metrics · Insurance and Reinstatement Cost · Capex Plan · Business Plan Scenarios ·
Exit Strategy · Vendor and Deal Dynamics · SWOT · Japan Rationale · Cross Border Tax
and Holding Structure · Currency Risk and Hedging · Further DD Required

## Item shape

Each workstream carries: **item title, question, section, jurisdiction**
(UK / Netherlands / Japan / Cross-border), **priority, status, owner, due date, risk
level, notes, linked documents**.

Typed as `DueDiligenceItem` in `src/types/database.ts`. The parent key is
`opportunity_id` — diligence happens **before** acquisition, on the canonical
pre-acquisition object. (It was `deal_id` until Phase 0.)

## Status model (8)

`Not Started → Requested → In Progress → Received → Reviewed → Resolved`, with
`Issue Identified` (flag) and `Not Applicable` (excluded from totals) off the main path.
A workstream is **cleared** when *Reviewed* or *Resolved*.

## London vs Amsterdam

The section spine and the cross-border / Japan lines are shared; jurisdiction-specific
lines branch to the local regime:

| Theme | London (UK) | Amsterdam (NL) |
| --- | --- | --- |
| Tenure | Freehold/leasehold, Land Registry, ground rent | Eigendom vs **erfpacht** (canon, expiry), Kadaster |
| Planning | Use class, **listed building** / conservation, CIL/s106 | **Bestemmingsplan**, **rijksmonument**, omgevingsvergunning |
| ESG | EPC / **MEES** (EPC B by 2030) | Energy label, office label-C, **Paris-Proof** |
| Tax | **SDLT** & surcharges | **Overdrachtsbelasting** (RETT 10.4%) |
| Valuation | RICS **Red Book** | TEGoVA / RICS |
| Covenant | Companies House, CVA/administration | KvK, faillissement/surseance |
| Areas | RICS IPMS | NEN 2580 (VVO/BVO) |

Defined in `src/lib/dd/templates.ts` (`buildTemplate`).

## Preserved logic

**`src/lib/dd/templates.ts`**

- `DD_TEMPLATES` — both market frameworks, 21 sections each.
- `defaultTemplateId(market)` — recommends a template from the opportunity's market.
- `applyTemplate(templateId, opportunityId, now)` — instantiates every template
  line as a live, Not-Started, unowned workstream.

**`src/lib/dd/progress.ts`** (moved here in Phase 0 from the deleted deal-file tree,
because it is firm logic rather than screen logic)

- `computeProgress(items)` — totals, in-scope count, cleared, open, issues, and a
  completion percentage. Two rules are deliberate and should survive any rewrite:
  *Not Applicable* is excluded from the denominator, so progress measures work in
  scope rather than being flattered by lines that were never required; and an
  opportunity with nothing in scope is 100%, not 0%.
- `criticalOpenItems(items)` — open workstreams that are flagged issues or
  high/critical priority, ranked by severity.

## Behaviour Phase 1 should build

- **Apply template** — an opportunity with no DD shows the framework chooser
  (pre-selected from `opportunity.market`); applying persists all 21 sections.
- **Progress by section** — proportional, status-coloured bars and cleared/in-scope
  counts, rolled up to an overall completion percentage.
- **Critical Open Items** — a panel over `criticalOpenItems`.
- **Inline status editing**, written through a server action under RLS.

Nothing here needs new logic — it needs a table, actions and a screen. The
computation is done.
