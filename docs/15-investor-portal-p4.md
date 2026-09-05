# P4 — Investor-Facing Investment Portal

The portal an investor actually sees: a curated selection, one opportunity at a
time, saved and compared, with documents and a way to ask for more.

```
Login → Curated opportunities → Open opportunity → Save → Compare
      → Review documents → Request information
```

Built entirely on the P1 publication/entitlement model and the P3 investor
session. **No migration was added.** Everything P4 needs already existed in
`0005_investor_portal.sql`, and nothing in the P0–P3 security architecture was
changed.

## The one rule

The investor sees approved publication data and nothing else.

`src/lib/data/portal-feed.ts` is the only data source the portal reads, and it
touches exactly four investor surfaces: `investor_feed`,
`publication_documents`, `investor_saved`, `investor_requests` (plus
`investor_activity_events` for writes). The internal tables — `opportunities`,
`investment_cases`, `assets`, `business_plans`, `transactions`,
`organizations` — appear nowhere in it, and neither do the provenance tables
`publication_sources` / `publication_version_sources`.

Every function takes a Supabase Auth user id and runs inside
`withInvestorSession()`. There is no filtering decision in any page: the
database decides, from `auth.uid()`, through the P1 policies.

| Concern | Enforced by |
| --- | --- |
| Which publications are visible | `investor_feed` + `investor_publications_entitled` |
| Which version is readable | `publication_versions_active` (active pointer only) |
| Which documents are readable | `publication_documents_tiered` (`internal` refused at every tier) |
| Whose saved list this is | `investor_saved_own_*` (per contact, not per organisation) |
| Who may submit a request | `investor_requests_own_insert` (re-tests entitlement) |
| Contact / organisation status | `app.current_investor_contact_id()` — active contact, active org |

## Routes

| Route | What it is |
| --- | --- |
| `/portal` | Selected For Your Review (one featured) + Also Available (secondary, in configured order) |
| `/portal/opportunities/[publicationId]` | The opportunity, from the active published version |
| `/portal/saved` | This contact's own saved opportunities |
| `/portal/compare` | Up to three opportunities side by side |

Navigation is Opportunities / Saved / Compare, plus the signed-in identity and
Sign Out. No internal Reiwa OS navigation appears, and every internal route
still redirects an investor away.

## Decisions worth recording

**A publication id is not a capability.** Every id that arrives from a URL or
the browser is treated as a request. `loadPortalOpportunity` returns `null` for
anything unentitled, hidden, withdrawn, superseded or simply unknown, and the
page renders a calm "not available" state rather than an error.

**Compare is a client-side selection, resolved server-side.** The browser keeps
the set in `localStorage`; `/portal/compare` re-resolves every id through
`investor_feed` and caps the list at three. Sending four ids, or an id belonging
to another organisation, changes nothing — the extra entries simply do not come
back. A selection that has since been revoked is dropped from the browser too.

**Saved state is personal and self-cleaning.** `investor_saved` is keyed on the
contact, and `/portal/saved` joins through `investor_feed`, so a revoked
entitlement removes the opportunity from the list without touching the saved
row. Nothing needs tidying up when access changes.

**No equity-requirement field is shown.** P1 carries no such column, and a
figure is never inferred or interpolated to fill a gap: an unreleased metric
renders as an em dash, on the opportunity page and in the comparison table
alike. `src/lib/portal/metrics.ts` is the single definition of what a metric is
called and how it renders, so the two surfaces cannot drift.

**"Reiwa Assessment" is the entitlement's `investor_note`** — the admin's own
per-investor note, shown as *Note from Reiwa Capital*. It is approved, curated
content. Nothing on the portal claims suitability, recommends, or implies a
guarantee; targets are labelled as estimates with capital at risk.

**Documents are presented, not delivered.** Secure Supabase Storage delivery is
not built. Rather than mint an insecure link or open a bucket, each permitted
document is listed with its title, category, tier and size, marked "Secure
delivery pending". `storage_path` is not part of the projection that reaches
the component, so it cannot leak into the HTML.

## Activity

P4 emits only the factual P1 events the product needs: `opportunity_viewed`,
`saved`, `unsaved`, `compared`, `information_requested`. `recordPortalEvent`
never throws — an activity write must not take a page down. There is no
duration, score, ranking or inferred suitability anywhere. **P5 owns the
engagement layer; none of it exists here.**

## Defect fixed during P4

`saveOpportunity` and `submitRequest` let a row-level-security refusal escape
as an exception, which would have returned a 500 from the portal when an
investor acted on something they could no longer see. Both now recognise
SQLSTATE `42501` and report it as a refusal (`false` / `null`), which the UI
turns into a quiet no-op or an explanatory message. Every other failure still
surfaces.

## Tests

`tests/portal-experience.test.ts` — 28 tests on a self-contained fixture (its
own opportunities, investor organisations, contacts and Auth users), so the
P0–P3 suites are untouched. It covers the twenty required cases: entitlement
visibility, featured placement, secondary ordering, direct-URL access to
unentitled / hidden / withdrawn publications, superseded versions, contact-
specific saved state, revocation, the comparison cap and its entitlement
filter, both document tiers, internal-document exclusion, request binding and
forgery, suspended organisations, deactivated contacts, staff identities, and
the internal-route boundary.

## Not in P4

Secure document download (**mandatory before UAT**, alongside the outstanding
P3 real-email/custom-SMTP item), engagement analytics and dashboards (P5), and
production hardening (P6).
