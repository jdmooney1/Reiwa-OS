# 11 · P0 — Supabase runtime, Supabase Auth, database-enforced RLS

This phase replaced the embedded development stack with the production one: hosted
**Supabase PostgreSQL** for data and **Supabase Auth** for staff identity. The
domain model, the data-layer interfaces and the RLS policies are unchanged — only
the runtime beneath them and the source of the request context changed.

Supersedes the runtime described in [10 · Persistence Gate](10-persistence-gate.md);
the property-centric lifecycle model documented there still stands.

## What changed

| Before (persistence gate) | After (P0) |
| --- | --- |
| PGlite, embedded and file-backed | Hosted Supabase PostgreSQL over the transaction pooler |
| `users` table with scrypt password hashes | `auth.users` (Supabase Auth) + a `profiles` table |
| Custom HS256 JWT in a `reiwa_session` cookie (`jose`) | Supabase Auth session cookies, verified via `getUser()` |
| RLS helpers read `app.*` GUCs | RLS helpers read the standard Supabase claims via `auth.jwt()` |
| Migrations ran on app boot | `npm run db:migrate`, explicit and out of the request path |

## The RLS seam

`withSession()` opens a transaction, becomes the `authenticated` role, and installs
the request context as Supabase's own claims GUC:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', $1, true);
--   { "sub": <user id>,
--     "role": "authenticated",
--     "app_metadata": { "global_role": …, "org_ids": [...], "can_write": … } }
```

Because both the role and the claims are `SET LOCAL`, they are discarded at
`COMMIT`/`ROLLBACK` and never leak to the next borrower of a pooled connection —
which matters on a transaction pooler. `tests/isolation.test.ts` asserts exactly this.

The policies from the persistence gate are untouched; only the helper bodies in
migration `0001` changed, from `current_setting('app.*')` to `auth.jwt()`:

```sql
create or replace function app.current_org_ids() returns uuid[]
  language sql stable set search_path = '' as $$
    select coalesce((select array_agg(value::uuid)
      from jsonb_array_elements_text(auth.jwt() -> 'app_metadata' -> 'org_ids') as t(value)),
      array[]::uuid[]) $$;
```

**The claims are assembled server-side, never accepted from the client.** Supabase
Auth establishes *who* the user is; the global role and organisation scope are then
read from `profiles` / `organization_members` on the privileged connection for every
request. A tampered cookie cannot widen scope, because the cookie never carries scope.

## Two credentials, two jobs

| Credential | Used by | For |
| --- | --- | --- |
| `DATABASE_URL` | `src/lib/db/client.ts` | All application reads/writes, RLS-gated via `withSession`; privileged reads via `adminQuery` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `src/lib/supabase/server.ts` | Supabase Auth sign-in / session verification |
| `SUPABASE_SECRET_KEY` | `src/lib/supabase/admin.ts` | Auth **Admin API only** — provisioning the seeded staff accounts |

The secret key never reads application data, and the database credential is never
used for HTTP API calls. `src/lib/supabase/` and `src/lib/db/` do not share a secret.

TLS to the pooler is verified against Supabase's own root CA, shipped at
`supabase/prod-ca-2021.crt` (its certificate does not chain to a public root).
Verification is never disabled.

## Commands

```bash
npm run db:migrate        # apply pending migrations
npm run db:seed           # provision Auth accounts + demonstration data (no-op if seeded)
npm run db:reset -- --yes # DESTRUCTIVE: drop the app schema, re-migrate, re-seed
npm test                  # integration tests against the real database
```

Integration tests run against the configured Supabase project: a vitest
`globalSetup` drops, migrates and seeds once per run, and files execute serially
against that one database.

## Demo accounts (password `reiwa2026`)

Unchanged from the persistence gate, but they are now real Supabase Auth users
created through the Admin API; `profiles` carries their Reiwa role.

## Technical debt

- **Transient pooler resets.** A cold connection to the transaction pooler
  occasionally fails with `ECONNRESET`; it was seen once during migration and
  succeeded on retry. There is no retry/backoff on connection acquisition yet.
- **Claims are app-assembled, not Supabase-issued.** Moving `global_role` /
  `org_ids` into the access token via a custom access-token hook would let
  PostgREST enforce the same policies without the app in the loop.
- **`has_org()` trusts the assembled claim** rather than re-deriving membership in
  the database. Adding a `SECURITY DEFINER` membership lookup would make the
  policies self-contained; it was left out of P0 to keep the seam identical.
- **Session assembly costs two privileged queries per request** (profile +
  memberships), memoised only within a single React render.
- FX still uses labelled demo static rates; portfolio assembly is still per-asset.
- Legacy `deals` / DD / score / memo / document modules remain mock and are not
  org-scoped.
