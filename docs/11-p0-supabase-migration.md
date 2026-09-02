# 11 · P0 — Supabase migration status

## Delivered (verified in this environment)

- **Supabase-native migrations** `supabase/migrations/20260901000001–04` replace the
  GUC model: identity = Supabase Auth user id via `auth.uid()`; authorisation =
  `security definer` membership joins (`app.is_admin / is_staff / has_org /
  can_write_org`). Read-only staff is a **membership role** (`viewer`), not a global
  role; `investor_viewer` removed. Approved cases / transactions / underwriting plans
  remain immutable.
- **Access modes** (src/lib/db/client.ts):
  - `withSession` → `SET LOCAL ROLE authenticated` + `request.jwt.claims={"sub":…}` →
    RLS-gated; `auth.uid()` = the session's Supabase Auth user id.
  - `adminQuery` → privileged **direct database** access as the DATABASE_URL role
    (table owner bypasses non-FORCE RLS) — migrations, seeding, identity resolution.
  - Supabase **API-level** privileged operations (Auth Admin) will use
    `SUPABASE_SECRET_KEY` via server-only supabase-js — a separate credential/path.
- **Backend seam**: `pg` Pool against `DATABASE_URL` (Supabase transaction pooler)
  when configured; TRANSITIONAL embedded fallback (PGlite + `supabase/shim/auth_shim.sql`,
  which recreates `auth.users`/`auth.uid()` only where the auth schema is absent)
  otherwise. The data layer (`src/lib/data/*`) is untouched — it consumes the
  `Queryable`/`withSession` seam.
- **Session model**: `{ kind:'internal', userId, role, canWrite }` — `role`/`canWrite`
  are UI hints; tests prove a forged `canWrite` cannot override RLS.
- `scripts/db-migrate.mjs` (`npm run` via node) applies migrations to `DATABASE_URL`
  for environments without Docker/CLI; never applies the shim.
- **Evidence**: 14 automated tests (isolation incl. fabricated-id and forged-flag,
  lifecycle, permissions, restart persistence) + 12 authenticated browser checks
  (analyst write view, viewer read-only, Aoyama isolation) + tsc/lint/build clean.

## Blocked in this environment (not claimed)

The sandbox network policy denies all Supabase egress (`supabase.com`,
`api.supabase.com`, `*.supabase.co`, `*.pooler.supabase.com` → 403 CONNECT), and no
credentials are configured. Therefore still outstanding for P0 completion:

1. Provision **reiwa-dev**; set `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`
   (transaction pooler), `INVITE_TOKEN_PEPPER`; allowlist the domains above.
   Note: `DATABASE_URL` is raw Postgres TCP — verify egress; if TCP is blocked the
   fallback is an approved architecture change, not a workaround.
2. Apply migrations to reiwa-dev (`scripts/db-migrate.mjs`); seed via an Auth-Admin
   identity provider (replaces the transitional password seed).
3. Swap staff sign-in to Supabase Auth email+password (`@supabase/ssr`) behind the
   existing `getSession()` seam; verify live.
4. **Step 12**: delete the transitional pieces — PGlite runtime fallback, auth shim
   usage in runtime, `users.password_hash`, scrypt/jose legacy session — once the
   hosted path is proven.

## Carried forward to P1 (design decision, no code yet)

Investor contacts are **pre-provisioned** as Supabase Auth users at authorisation
time (`auth_user_id` stored immediately); OTP login uses `shouldCreateUser:false`;
first login only activates/stamps the existing contact.
