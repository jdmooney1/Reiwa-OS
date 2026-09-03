-- ============================================================================
-- 0006 — Investor access invitations (P3)
-- ----------------------------------------------------------------------------
-- The smallest table the access layer needs. An invitation NEVER grants any
-- database access by itself: it only identifies the intended access context
-- (which investor contact this link was minted for). Actual access requires a
-- successful Supabase Auth OTP to the contact's authorised email, after which
-- everything the investor can see is still derived database-side from
-- auth.uid() by the P1 helpers — nothing here appears in any resolution path.
--
-- Only the SHA-256 hash of the invitation token is stored. The raw token is
-- generated server-side, shown to the Reiwa admin once, and never persisted or
-- logged. Expiry and revocation are enforced server-side on every lookup.
--
-- Privilege posture (nothing relies on Supabase defaults):
--   * RLS enabled; the only policy is the admin policy (app.is_admin()).
--   * No investor-facing policy exists at all: an investor session matches no
--     permissive policy on this table and reads nothing, their own invites
--     included. Unauthenticated token validation runs on the privileged
--     server-side connection (sign-in support, like session assembly in P0).
--   * anon/PUBLIC privileges revoked; authenticated granted explicitly.
--   * No new function in schema `app` — the enumerated EXECUTE matrix from
--     P1 is unchanged.
-- ============================================================================

create table if not exists investor_invites (
  invite_id           uuid primary key default gen_random_uuid(),
  investor_contact_id uuid not null references investor_contacts(investor_contact_id) on delete cascade,
  -- SHA-256 hex of the raw token. The raw token exists only in the admin's
  -- browser at creation time and in the invitation link itself.
  token_hash          text not null unique,
  expires_at          timestamptz not null,
  revoked_at          timestamptz,
  accepted_at         timestamptz,
  created_by          uuid references profiles(user_id),
  created_at          timestamptz not null default now()
);
create index if not exists idx_investor_invites_contact
  on investor_invites(investor_contact_id, created_at desc);

alter table investor_invites enable row level security;

drop policy if exists investor_invites_admin on investor_invites;
create policy investor_invites_admin on investor_invites for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- Supabase's default privileges hand `anon` rights on every new table in
-- `public`; take them back and grant only what is used (same posture as 0005).
revoke all on investor_invites from anon, public;
grant select, insert, update, delete on investor_invites to authenticated;
