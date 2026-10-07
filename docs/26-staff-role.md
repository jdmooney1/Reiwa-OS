# 26 - `reiwa_staff`: an internal role below `reiwa_admin`

Migration `0035`, plus `requireStaffSession` / `isInternalStaff` in `src/lib/auth/admin.ts`.

## Scope
Two internal roles, not a permission matrix.

| | `reiwa_admin` | `reiwa_staff` |
|---|---|---|
| Pipeline, opportunities, underwriting, documents, investment cases, memos | yes | yes (client organisations they are a member of) |
| Memo drafting aids (AI review, JA translation draft and accept) | yes | yes |
| Submit, publish, withdraw, revoke a publication; `assertPublishConfirmed` | yes | **no** |
| Entitlements, investor organisations, investor feed, deal shares, FX rates | yes | **no** |
| Users, roles, memberships, organisations (create / rename / delete) | no session role can; privileged connection only | **no** |

"Nothing" is the default for staff on investor-facing data. There is no assignment model yet, so there
is no partial access to build on.

## Where it is enforced
**At the data layer, by the mechanism that already existed.** Every request runs inside `withSession`,
which mints the JWT claims from the database profile and sets the Postgres role. All the investor,
publication, entitlement, deal-share and FX policies are `app.is_admin()`, and `is_admin()` is still
`global_role = 'reiwa_admin'`. A staff session therefore fails those policies with no code in the
actions at all. Nothing parallel was added.

What 0035 changes:
- `profiles_global_role_check` admits `reiwa_staff`. No row changes: every existing internal user stays
  `reiwa_admin`, so nobody's access moves.
- `app.is_staff()` (admin or staff). It is used in **two** places only: the policies on
  `memo_ai_reviews` and `memo_translation_drafts`, each also requiring the memo to be visible under the
  memo's own organisation policy. A unit test pins that list; any other use of `is_staff` fails it.
- `app.has_org()` is unchanged (`is_admin() or org in current_org_ids()`), so staff see client
  organisations only through `organization_members`.
- **Organisation writes are admin-only.** The old `orgs_write` policy let any member with write scope
  rename or delete their own organisation (the delete cascades). That was a hole independent of staff,
  and staff would have inherited it. Closed.
- `organization_members` loses insert/update/delete/truncate from `authenticated`; `profiles` is
  select-only for `authenticated`. Nothing in the app writes either except `src/lib/db/seed.ts` on the
  privileged connection, and a unit test checks that.

The restriction on publishing is therefore enforced twice and independently: RLS refuses the writes, and
`publishVersionAction` still runs `requireAdminSession()` then `assertPublishConfirmed()`. The action
checks are a courtesy (a readable error); the database is the boundary.

## Decisions to be aware of
- **Memo drafting aids widened to staff.** They were deliberately admin-only (0030/0031). Staff do the
  pre-investor memo work, so they need them; the data they touch is the same memo they can already
  edit. Reverting is two policy changes.
- **Staff see client organisations by membership.** A staff user with no memberships sees nothing.
  Widening to all client organisations is a one-line change to `has_org`; it was left out because
  "see everything internal" is the larger grant and is easy to add later, hard to take back.
- **Admin-only surfaces stay admin-only:** the investor Overview editor, "Prepare investor draft",
  FX, deal shares, the `/admin` area, the Investors and Firm sidebar sections.

## Assigning the role
There is deliberately **no UI**. No session role can write `profiles` or `organization_members`, so the
role can only be assigned on the privileged connection (migration, seed, or SQL in Supabase):

```sql
update public.profiles set global_role = 'reiwa_staff' where user_id = '<user id>';
insert into public.organization_members (organization_id, user_id, member_role)
values ('<org id>', '<user id>', 'manager') on conflict do nothing;
```

No re-login is needed: claims are minted per request from the database profile, not from the cookie.

## Tests
- `tests/unit/staff-role-boundaries.test.ts` - structural: every admin action's first `await` is
  `requireAdminSession()`; publish order is admin, `assertPublishConfirmed`, `publishVersion`;
  `is_staff` appears only where intended; no investor/publication policy mentions staff.
- `tests/staff-role.test.ts` - a real `reiwa_staff` session against the database: each of the three
  restrictions attempted directly (not through the UI), the allowed side exercised for false refusals,
  and an admin control run on the same fixtures.
