// ============================================================================
// Local integration database harness — development environments without raw
// TCP access to the hosted Supabase PostgreSQL (e.g. HTTPS-only egress).
// ----------------------------------------------------------------------------
// Prepares a LOCAL PostgreSQL so the unchanged migrations, seed and integration
// tests run against it faithfully. It recreates what hosted Supabase provisions
// and the migrations assume: the `anon` / `authenticated` / `service_role`
// roles, the `auth` schema with `auth.users`, `auth.uid()` / `auth.jwt()`, and
// Supabase's default grants on `public` (so the migrations' explicit revokes
// stay meaningful). Identity is served by scripts/local-auth.ts, a minimal
// GoTrue-compatible Auth server over the same `auth.users` table.
//
// The application code, migrations and tests are exactly the ones that run
// against hosted Supabase; nothing here weakens or replaces any policy. The
// `auth._local_shim` marker exists so tooling can tell this harness apart from
// a real Supabase database — nothing in this script ever runs against one:
// every statement below targets DATABASE_URL, which the operator points at
// 127.0.0.1 before invoking it, and the script refuses any other host.
//
// Usage:
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres?sslmode=disable \
//     npx tsx scripts/local-db.ts
// then start scripts/local-auth.ts and run db:reset / vitest with the same
// DATABASE_URL and the local NEXT_PUBLIC_SUPABASE_URL.
// ============================================================================
import "./env";
import { getPool, closePool } from "@/lib/db/client";

const SHIM_SQL = `
-- Roles hosted Supabase provisions (0001 fails loudly if they are missing).
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;
grant anon, authenticated, service_role to postgres;

-- The auth schema: what the migrations reference, plus the demo credential
-- columns the local Auth server (scripts/local-auth.ts) needs. On hosted
-- Supabase none of this exists — GoTrue owns the schema there.
create schema if not exists auth;
create table if not exists auth.users (
  id              uuid primary key default gen_random_uuid(),
  email           text unique,
  password_sha256 text,
  user_metadata   jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create table if not exists auth._local_refresh_tokens (
  token      text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- Email OTP codes issued by the local Auth stand-in. On hosted Supabase these
-- are emailed by GoTrue; locally they sit here so a developer (or a test on
-- the privileged connection) can read the code that "was sent".
create table if not exists auth._local_otp (
  email      text primary key,
  code       text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
-- Marker so tooling can recognise the local harness (absent on hosted Supabase).
create table if not exists auth._local_shim (created_at timestamptz not null default now());

-- Supabase's claim readers, verbatim semantics: transaction-local
-- request.jwt.claims, exactly what withSession()/withInvestorSession() install.
create or replace function auth.jwt() returns jsonb
  language sql stable
  as $fn$
    select coalesce(
      nullif(current_setting('request.jwt.claim', true), '')::jsonb,
      nullif(current_setting('request.jwt.claims', true), '')::jsonb)
  $fn$;
create or replace function auth.uid() returns uuid
  language sql stable
  as $fn$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      auth.jwt() ->> 'sub')::uuid
  $fn$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;

-- Supabase's stock grants on public: new tables are handed to every API role
-- unless a migration revokes them. Reproduced so the migrations' explicit
-- revokes (and the tests pinning them) exercise the same starting point.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;
`;

async function main(): Promise<void> {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error(
      `scripts/local-db.ts prepares a LOCAL database only; DATABASE_URL points at ${url.hostname}`,
    );
  }

  const pool = getPool();
  await pool.query(SHIM_SQL);
  console.log("[local-db] Supabase shim (roles, auth schema, default grants) in place");
  await closePool();
}

main().catch((e) => {
  console.error("[local-db] failed:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
