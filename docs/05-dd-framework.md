# 05 · Due Diligence Framework

The DD Tracker is an **investment risk-control system**, not a task list. It encodes
Reiwa Capital's standing diligence frameworks for London and Amsterdam and tracks every
workstream from request to clearance, surfacing issues to the investment committee.

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

## Behaviour

- **Apply template** — a deal with no DD shows the framework chooser (recommended
  template pre-selected from `deal.market`); applying instantiates all 21 sections as
  live, Not-Started workstreams (`applyTemplate`).
- **Progress by category** — each section shows a proportional, status-coloured bar and
  cleared/in-scope count; the control header rolls these up to an overall completion %.
- **Critical Open Items** — a dedicated panel lists open workstreams that are flagged
  issues or high/critical priority, ranked by severity.
- Status is editable inline; the model excludes *Not Applicable* from completion maths.
