# 12 · P1 — Investment Portal data foundation

The persistent backend for the Reiwa Capital Investment Portal. **Data only** —
no admin screens (P2), no investor sign-in flow (P3) and no investor-facing UI
(P4). What exists here is the schema, the authorisation model, the server-side
data layer those phases will call, and the tests that pin the boundary down.

Builds on [11 · Supabase P0](11-supabase-p0.md); nothing in the internal model
changed.

## The separation

Two tenancy models that never touch:

| | Internal Reiwa OS | Investment Portal |
| --- | --- | --- |
| Tenant | `organizations` | `investor_organizations` |
| Person | `profiles` + `organization_members` | `investor_contacts` |
| Identity | Supabase Auth user | Supabase Auth user |
| Authorisation | claims assembled server-side (`org_ids`, `global_role`) | derived in the database from `auth.uid()` |

A portal investor is a Supabase Auth user with an `investor_contacts` row and
**nothing else** — no `profiles` row, no `organization_members` row. So
`app.current_org_ids()` is empty and `app.is_admin()` is false, and every P0
policy (`app.has_org(org_id)`) denies them without a line of new code. The
denial is structural, not a rule someone has to remember to write.

`investor_organizations.linked_internal_organization_id` exists for admin
reporting and is read by no policy anywhere.

## Tables

```
investor_organizations ──< investor_contacts ──< investor_saved
        │                          │              investor_activity_events
        │                          └───────────< investor_requests
        └──< publication_entitlements >── investor_publications ──< publication_versions ──< publication_documents
                                                     │                      ▲
                                                     └── active_version_id ─┘
```

`investor_publications` holds one publication identity per internal opportunity.
`publication_versions` holds the investor-facing content; the publication points
at exactly one of them. Neither carries an internal identifier — those live in
the admin-only provenance tables:

```
publication_sources          (publication_id → opportunity_id, unique)   ADMIN ONLY
publication_version_sources  (version_id → source fingerprint)           ADMIN ONLY
```

## Investor authorisation is derived, never asserted

`withInvestorSession(authUserId)` opens a transaction, becomes `authenticated`
and installs claims that contain **only** the Supabase user id:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": <user id>, "role": "authenticated", "app_metadata": {}}', true);
```

No organisation, no entitlement, no document tier. There is nothing in the token
for the application — or a tampered cookie — to get wrong. Everything else is
resolved by `SECURITY DEFINER` helpers in migration `0005`, each anchored on
`auth.uid()` and each running with an empty `search_path`:

| Helper | Answers |
| --- | --- |
| `app.current_investor_contact_id()` | which active contact is this, of an active organisation |
| `app.current_investor_org_id()` | which active investor organisation |
| `app.investor_can_read_publication(pub)` | is there a *visible* entitlement to a *published* publication |
| `app.investor_active_version_id(pub)` | the one version they may read |
| `app.investor_can_read_document(version, level)` | active version, tier at or below entitlement, never `internal` |

They are `SECURITY DEFINER` so they can resolve membership without recursing
through the policies they support. Their arguments only ever *name* the object
being tested; no argument can widen the answer past the caller's own contact and
entitlement.

Audited, and asserted by test:

- exactly five functions are `SECURITY DEFINER`, all in `app`, all pinning
  `search_path = ''`; nothing in `public` is `SECURITY DEFINER`
- handed any other organisation's publication id, the helpers return
  `false` / `null`; handed `'internal'`, the document helper returns false for
  every published version in the database
- `EXECUTE` is revoked from `PUBLIC` (which `CREATE FUNCTION` grants by default)
  and held by `authenticated` alone; `anon` has neither `USAGE` on the schema nor
  `EXECUTE` on any function
- `app` is not one of PostgREST's exposed schemas, so no helper is reachable as
  an HTTP RPC — they are callable only over the server-side Postgres connection
- `anon` holds no privilege on any portal table or view; Supabase's default
  privileges are revoked in this migration
- the two mutating functions refuse a non-admin caller outright rather than
  no-opping through RLS

An investor may read:

- publications their organisation holds a **visible** entitlement to
- the **active published version** only — never a draft, in-review or superseded one
- documents at or below their entitlement's tier; `internal` never, at any tier
- their own saved state, activity and requests

Everything else is denied, including the internal tables and (deliberately
narrowed in this migration) `fx_rates`.

### Two structural guarantees

`document_access_level` on an entitlement accepts only `standard` or
`diligence`, so the `internal` tier is not merely refused — it is unreachable.
And a partial unique index enforces **one visible featured opportunity per
investor organisation**:

```sql
create unique index publication_entitlements_single_featured
  on publication_entitlements(investor_org_id)
  where is_visible and placement = 'featured';
```

Entitlements are default-deny: `is_visible` defaults to false, so a granted row
shows nothing until someone makes it visible.

## The publication boundary

```
internal opportunity ──one-way prefill──> publication version (independent)
```

The whitelist lives in SQL, as `app.opportunity_publication_source()`, so it is
enforced at the boundary rather than by convention at each call site:

| Carried over | Deliberately not carried over |
| --- | --- |
| name → title, market, submarket, city, country | broker, vendor, source (counterparty confidential) |
| asset type, strategy, currency | probability, internal stage and status |
| target price → headline price | capex budget, passing rent, ERV |
| NIY, target IRR, equity multiple | reference, owner/creator ids, org id |
| size (sqft / sqm), summary → overview | |

After the prefill the version is an **independent record**. Editing the internal
opportunity cannot reach it — there is no view, no trigger and no join that
would carry a change across.

The function is `SECURITY INVOKER`, so reading it is gated by the caller's own
RLS on `opportunities`: an investor calling it gets null.

## Provenance is private

No investor-readable row carries an internal Reiwa OS identifier. The
relationship lives in two admin-only tables that no investor policy mentions,
so an investor's `SELECT` matches no permissive policy and returns nothing:

| Table | Key | Holds |
| --- | --- | --- |
| `publication_sources` | `publication_id` | `opportunity_id` (**unique**), who linked it and when |
| `publication_version_sources` | `version_id` | the `md5` source fingerprint and when it was captured |

`publication_sources.opportunity_id` being unique is what now preserves **one
publication identity per internal opportunity** — the rule moved with the
column. `publicationSourceDrift()` resolves the opportunity through the mapping
and compares digests; `getPublicationProvenance()` and `getVersionProvenance()`
expose the mapping to admin callers. All of it is denied to investors by RLS.

`investor_publications`, `publication_versions` and the `investor_feed` view
contain no internal id, no property id, no org id and no source digest. This is
enforced, not merely intended: a test enumerates every column of every
investor-readable surface for every seeded investor, extracts every uuid, and
asserts none of them is an internal identifier.

## Version lifecycle

```
draft ──submit──> in_review ──publish──> published ──(next publish)──> superseded
  ▲                   │
  └────return─────────┘
```

- **draft** — freely editable.
- **in_review** — content frozen; only the status and its stamps may move.
- **published** — the whole row is frozen. The single exception is the supersede
  stamp applied when the next version goes live.
- **superseded** — frozen absolutely.

Documents belong to a version and are part of that frozen snapshot: they must be
attached while the version is still editable, and cannot be added, changed or
removed once it is published.

Publishing is one database function, `app.publish_publication_version()`, which
locks the rows, supersedes the outgoing version and repoints
`active_version_id` in a single transaction — so a publication is never briefly
pointing at nothing or at two live versions. A partial unique index
(`publication_versions_single_published`) makes the two-live-versions state
unrepresentable even by direct statement.

`app.supersede_active_version()` withdraws a live publication: the version is
superseded and the pointer cleared, so it leaves every investor's portal at once.

## Data layer

`src/lib/data/investor-portal.ts` — the server-side surface P2 will call. Every
function runs inside `withSession()`, holds no privilege of its own, and never
touches the privileged connection; the portal write policies require
`app.is_admin()`.

Investor organisations and contacts · `createPublicationFromOpportunity` ·
`updateDraftVersion` · `submitVersionForReview` · `returnVersionToDraft` ·
`publishVersion` · `supersedeActiveVersion` · documents ·
`grantEntitlement` / `updateEntitlement` / `revokeEntitlement` ·
`setEntitlementPlacement` · `listPublicationsForInvestorOrg` ·
`publicationSourceDrift` · `getPublicationProvenance` / `getVersionProvenance`.

No screens are built on it.

## Fixtures

`npm run db:seed` provisions three investor organisations and four contacts
(fictional people at fictional firms — no real client information), four
publications drawn from the Meiji pipeline, and deliberately unequal
entitlements:

| Organisation | Featured | Secondary | Documents | Also holds |
| --- | --- | --- | --- | --- |
| Kitano Family Office | 58 Queens Gate | 120 Fenchurch Street | diligence / standard | a visible entitlement to a publication that was never published |
| Sakura Capital Partners | 120 Fenchurch Street | — | standard | a **hidden** entitlement to Old Bond Street Retail |
| Hanabi Ventures | Old Bond Street Retail | — | standard | |

58 Queens Gate is published twice, so version 1 is superseded, version 2 is live
and version 3 is an open draft. Every published version carries one document per
tier, `internal` included. Portal accounts use the same demo password as the
staff accounts.

## Tests

`tests/investor-rls.test.ts` and `tests/publication-lifecycle.test.ts` execute
through `withInvestorSession()` against the real Supabase Postgres. No
permission function is mocked and no query is routed around a policy.

They assert: cross-organisation isolation of entitlements, publications and
contacts; zero investor access to all fifteen internal tables; that a
publication's internal opportunity id is inert; unentitled and hidden
entitlements are invisible; only the active published version is readable;
draft, in-review and superseded versions are not; the standard/diligence tier
split and that `internal` is never readable; saved state is per contact;
activity is append-only; one visible featured entitlement per organisation;
atomic version swap; immutability of published versions and their documents;
that editing an internal opportunity does not mutate a published snapshot (and
is reported as drift); and that a deactivated contact, a suspended organisation,
a revoked entitlement and a withdrawn version each end access immediately.

## Not in this phase

P2 admin screens, P3 investor authentication flow, P4 investor-facing UI.

## Technical debt

- **Helper calls are per-row.** The derivation helpers are `STABLE` but are
  evaluated inside policy predicates; at portal scale the entitlement lookup
  should be folded into an indexed join or a per-transaction cache.
- **Documents are version-scoped with no carry-forward.** Publishing a new
  version means re-attaching its documents. A "copy documents from the active
  version" step in the data layer would make the admin flow less repetitive.
- **Storage is modelled, not wired.** `publication_documents.storage_path` names
  a private Supabase Storage object; minting signed URLs (and the bucket policy
  behind them) is P4 work.
- **Activity events are written but never read.** No retention policy and no
  admin view yet.
