# 30 - An investor can no longer read their own investor_organizations row

One migration, `0038_investor_org_no_self_read.sql`. It removes one policy. No column, grant or data changes.

## What was wrong
0005 let an investor read their own organisation row and granted `select` on the whole table to
`authenticated`. A row policy filters rows, not columns, so an investor session (or a PostgREST call made
with their own JWT) could read every column of that row:

| Column | Why it should not reach an investor |
|---|---|
| `notes` | Reiwa's internal notes about the investor |
| `linked_internal_organization_id` | A raw internal organisation id. 0005's own invariant is that no investor-readable row carries one |

Confirmed on a seeded database before the fix: an investor session read `notes` back verbatim.

## Mechanism chosen, and what was rejected
- **Column-level grants: rejected.** Admins and investors both connect as `authenticated`; only the claims differ.
  Taking columns away from `authenticated` takes them from admins too and breaks every admin query on the table.
- **Moving `notes` and the link to a new table: not needed.** It means a data move on hosted databases and
  changes to every admin query, to protect columns nothing on the investor side reads.
- **Dropping the investor policy: chosen.** Nothing an investor does needs the row: identity resolution is
  `security definer`, and the portal's own organisation lookups run on the server-side privileged connection.
  With no investor policy an investor gets zero rows whichever columns they ask for. Admins keep `app.is_admin()`.

## Apply
Run the migration file. If applying by hand, also record it:
```sql
insert into app._migrations(name) values ('0038_investor_org_no_self_read.sql') on conflict do nothing;
```
Rollback: `supabase/rollback/0038_investor_org_no_self_read.down.sql` (re-creates the policy, and with it the leak).

## Tests
`tests/investor-rls.test.ts`: an investor reads no rows from `investor_organizations` through four query shapes
(with `notes` populated); the only policy on the table is the admin one; identity resolution still works.
`tests/publication-lifecycle.test.ts`: a suspended organisation is asserted through identity resolution, since
there is no row to read.

## Same class, not fixed here
The same catalog check finds other investor-readable columns that point at internal staff profiles:
`investor_publications.created_by`, `publication_versions.created_by/published_by/submitted_by`,
`publication_documents.created_by`, `publication_entitlements.granted_by`, `investor_requests.handled_by`.
Those are internal staff user ids on rows an investor is entitled to read, so a policy cannot remove them.
They need the investor to read through a view (or an attribution table) instead of the base table. Separate piece of work.
