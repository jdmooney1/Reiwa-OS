# 13 · P2 — Investment Portal admin experience

The internal Reiwa Capital screens that run the portal:

```
internal opportunity → prepare investor publication → review → publish → assign to investor
```

Built entirely on the frozen [P1 data foundation](12-investor-portal-p1.md) — no
new database objects, no migration, no change to the P0/P1 schema, policies or
privilege matrix. Everything an admin screen does runs through `withSession()`
under the signed-in admin's own claims; the P1 write policies
(`app.is_admin()`) remain the enforcement.

## Routes

All under the authenticated Reiwa OS shell, `reiwa_admin` only. The `(app)/admin`
layout answers non-admin staff with a **404** (they should not learn the surface
exists), and every server action re-checks the role before touching the data
layer. The sidebar shows the Investment Portal section to admins alone —
presentation, not the control.

| Route | Purpose |
| --- | --- |
| `/admin` | operational counts + queues: awaiting review, published-but-unassigned, investors with no visible opportunity |
| `/admin/investors` | searchable directory of investor organisations, create |
| `/admin/investors/[investorOrgId]` | the control centre for one investor: overview, contacts, assigned opportunities |
| `/admin/publications` | workflow list with Draft / In Review / Published / Withdrawn / Source Changed filters, create from eligible opportunity |
| `/admin/publications/[publicationId]` | the core page: Publication · Source · Documents · Investor Access · Versions |

Entry point from the internal side: **Prepare for Investors** on
`/opportunities/[id]` (admins only). If a publication already exists it opens it
— `publication_sources.opportunity_id` being unique means there is never a
second one to create.

## The boundary, on screen

The publication detail page renders the investor side under a dark navy header
("Investor Publication — an independent snapshot… it never mirrors the internal
opportunity"), and confines everything internal to the **Source** tab, which is
labelled admin-only: the linked opportunity, its internal stage/status, the
captured-at date and the fingerprint comparison. When the internal record has
moved on, a banner states:

> Internal opportunity has changed since this publication version was created.

and nothing else happens — refreshing is always the explicit *Start New Draft
From Current Internal Data* action, which re-prefills through the P1 whitelist
into a **new draft** for review. The live version is never touched.

## Lifecycle in the UI

`Draft → In Review → Published`, exactly the P1 model:

- a draft is edited in place; submitting freezes content (trigger-enforced);
- a reviewer publishes or returns it to draft;
- publishing supersedes the outgoing version and repoints the live pointer in
  one transaction (P1 `publishVersionOn`), which the version history tab shows
  as v*N* `LIVE` above its superseded predecessors;
- **editing a published publication creates a new draft version** —
  `createDraftFromVersion` copies the published content *and its documents* into
  the next version number and carries the *captured* source fingerprint forward,
  so drift keeps being reported against the snapshot the content actually came
  from. One editable version at a time, enforced with a clear message;
- withdrawing supersedes the live version and clears the pointer (P1
  `supersedeActiveVersionOn`) — the publication leaves every investor's portal
  at once.

## Entitlements

The investor detail page shows the portal as the investor experiences it:
**Featured** (one slot), **Also Available** (ordered, reorderable), and
**Hidden / Revoked** (record kept, investor sees nothing). Featuring an
opportunity states that it replaces the current featured one and the data layer
demotes it in the same transaction — the partial unique index remains the
guarantee, the UI just never trips it. Restore after a revocation deliberately
returns as *Also Available*, never straight back to featured. Document access is
a per-entitlement Standard/Diligence toggle; `internal` remains structurally
unreachable.

## P2 additions

| Layer | Files |
| --- | --- |
| Data (read models + helpers) | `src/lib/data/admin-portal.ts` |
| Gate | `src/lib/auth/admin.ts` |
| Actions | `src/app/actions/admin-portal.ts` |
| Screens | `src/app/(app)/admin/**`, `src/components/admin/**`, `src/lib/portal-labels.ts` |
| Tests | `tests/admin-access.test.ts`, `tests/admin-workflow.test.ts` |
| Dev harness | `scripts/local-db.ts`, `scripts/local-auth.ts` (below) |

`admin-access` pins that non-admin staff read empty results and cannot execute
any admin mutation — at the guard *and* directly against RLS. `admin-workflow`
walks the whole lifecycle end to end against the real database: whitelist
prefill, one-publication-per-opportunity, draft editability, the in-review
freeze, published immutability (documents included), new-draft-from-published,
the atomic version swap with history preserved, drift surfaced without
mutation, the single-featured rule, revocation taking effect on the investor's
next query, and document-tier changes verified from an actual investor session.

## Documents

Metadata only, exactly what P1 models: title, category,
Standard / Diligence / Internal, a reserved private storage path. Storage
upload/download was deliberately not invented here — signed URLs and the bucket
policy behind them remain P4 work, and the Documents tab says so.

## Local integration harness

Some development environments (HTTPS-only egress) cannot reach the hosted
Supabase Postgres over TCP. `scripts/local-db.ts` prepares a local PostgreSQL
with what Supabase provisions (the `anon`/`authenticated`/`service_role` roles,
`auth.users`, `auth.uid()`/`auth.jwt()`, and Supabase's default grants on
`public`, so the migrations' revokes keep meaning something), and
`scripts/local-auth.ts` is a minimal GoTrue-compatible Auth stand-in over the
same `auth.users` table. The application, migrations, seed and tests run against
it **unchanged**; both scripts refuse to run against anything but 127.0.0.1.

## Not in this phase

Investor OTP authentication and invitations (P3), the investor-facing `/portal`
(P4), storage wiring, activity analytics.

## Technical debt

- Reordering secondary entitlements issues one UPDATE per row; fine at this
  scale, batch it if lists grow.
- `startDraftFromSourceAction` guards and creates in two transactions; a race
  between two admins is caught by review, not by a lock.
- The publications list computes drift per row via
  `app.opportunity_publication_fingerprint()`; at hundreds of publications the
  digest comparison should be materialised.
- P1 debt unchanged: per-row helper evaluation, `anon` default privileges on
  future `public` tables, activity events written but unread.
