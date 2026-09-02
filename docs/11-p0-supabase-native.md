# 11 · P0 — Supabase-native backend (PostgreSQL + Supabase Auth)

P0 converted Reiwa OS from the self-contained persistence gate (embedded PGlite +
custom scrypt/JWT auth) to the **approved Supabase-native model**: hosted
PostgreSQL via the transaction pooler, Supabase Auth for email+password staff
sign-in, and database RLS driven by the verified JWT. The application data-layer
interfaces (`Queryable`, `withSession`, `adminQuery`, and every `data/*` function)
were preserved, so screens and server actions above the DB seam did not change.

## What changed

| Layer | Before (persistence gate) | After (P0) |
| --- | --- | --- |
| Runtime DB | PGlite (embedded WASM, file-backed) | PostgreSQL via `pg` Pool on `DATABASE_URL` (Supabase transaction pooler) |
| Identity of caller | `app.user_id` GUC set from a signed cookie | `auth.uid()` — the verified JWT `sub` claim in `request.jwt.claims` |
| Role / org scope | GUCs (`app.role`, `app.org_ids`) set by the app | Derived **inside the database** from the staff profile via `SECURITY DEFINER` helpers |
| Credentials | `users.password_hash` (scrypt) in app DB | Supabase Auth (`auth.users`); staff `users` row references `auth.users(id)` |
| Auth session | Custom HS256 cookie (`jose`) | Supabase Auth cookies via `@supabase/ssr` + `middleware.ts` refresh |
| Privileged API | superuser PGlite connection | `DATABASE_URL` (Postgres) **and**, separately, `SUPABASE_SECRET_KEY` (Auth Admin API) |

## The approved RLS transaction model (`withSession`)

Per request, inside one transaction on a pooled connection:

```
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<user-id>","role":"authenticated","aud":"authenticated"}', true);
-- ... data-layer queries run here, gated by RLS ...
commit;
```

This is exactly the execution context Supabase's own stack (PostgREST) gives
queries, so the policies behave identically on the hosted transaction pooler.
All state is transaction-local (`set local`, `set_config(..., true)`), which is
required for pooler safety.

RLS helpers (migration `0001`) now resolve identity from `auth.uid()` and read
the staff profile / memberships with `SECURITY DEFINER` (the standard Supabase
pattern that also avoids policy recursion). `has_org` / `can_write` / `is_admin`
are unchanged in meaning.

## Separation of privileged access

Two privileged credentials are kept conceptually and structurally separate:

- **`DATABASE_URL`** — the privileged Postgres connection (migrations, seeding,
  staff-profile lookup, and the `withSession` transactions). Used only by
  `src/lib/db/client.ts`.
- **`SUPABASE_SECRET_KEY`** — the Auth Admin **API** credential, used only by
  `src/lib/auth/admin.ts` to create auth users during seeding on a hosted
  project. Never used as a database connection; never sent to the browser.

## Local development & tests (no hosted project required)

The same migrations run on plain PostgreSQL because the migration runner applies
`supabase/local/auth_shim.sql` when the `auth` schema is absent — recreating the
minimal Supabase surface (`auth.users`, `auth.uid()`, `auth.jwt()`,
`auth.role()`) with definitions identical to Supabase's built-ins. On a real
Supabase project the schema already exists, so the shim never runs.

- **Tests** (`tests/`) run against real PostgreSQL: `freshDb()` creates a
  throwaway database per suite, applies the migrations + seed, and drops it on
  close. Sessions are derived from the seeded users. 12/12 pass.
- **Dev** can point `NEXT_PUBLIC_SUPABASE_URL` at `scripts/dev-auth-stub.mjs`
  (`npm run auth:stub`), a GoTrue-compatible stub over the shim's `auth.users`,
  exercising the real `@supabase/ssr` code path without a hosted project.

## Verified

`tsc --noEmit` clean · `next lint` clean · `vitest` 12/12 · `next build` succeeds.
End-to-end (browser-driven, real PostgreSQL + Supabase Auth code path): sign-in,
pipeline, opportunity creation, persistence across reload, stage progression,
opportunity→asset conversion, asset overview (underwriting baseline carried),
performance-period entry, portfolio aggregation, cross-org isolation, and
wrong-password rejection.

## Not done in P0 (out of scope)

Investor organisations/contacts, publications, entitlements, investor OTP, portal
routes, investor UI, admin investment-portal UI. Existing legacy `deals` /
DD / score / memo / documents modules remain mock and are not org-scoped.

## Deployment note

The transaction pooler requires direct TCP egress to
`*.pooler.supabase.com:6543`; an HTTPS-only network policy is not sufficient for
the `withSession`/RLS model. Set `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` (see
`.env.example`).
