-- ============================================================================
-- 0029 - Deal shares: a named, expiring, revocable link to two finalised documents
-- ----------------------------------------------------------------------------
-- A THIRD surface. It shares nothing with the investor portal: no investor_* table,
-- no investor session, no entitlement. A prospect who has not signed a mandate is a
-- lower trust level than an investor with one, so they get a narrower thing: one link,
-- named to one person, that shows the FROZEN Asset Snapshot and Investor Teaser of one
-- opportunity and nothing else.
--
-- Posture is investor_invites (0006) almost exactly:
--   * Only the SHA-256 hash of the token is stored (64 lowercase hex, enforced). The raw
--     token exists in the admin's browser once and in the link itself.
--   * RLS enabled; the only policies are admin (app.is_admin()). No prospect-facing
--     policy exists at all: an unauthenticated visitor has no database role, and the
--     token lookup runs on the privileged server-side connection, like OTP sign-in
--     support in P3. Nothing new in schema `app`: the EXECUTE matrix is unchanged.
--   * anon/PUBLIC revoked; authenticated granted explicitly.
--
-- Where it is NARROWER than investor_invites, on purpose:
--   * deal_shares: an admin may insert, read and REVOKE. The only column that can be
--     updated is revoked_at, so a link cannot be quietly extended, re-pointed at other
--     memos or re-addressed after it was sent; to change one, revoke it and issue another.
--     No delete: a share is a record of what was sent to whom.
--   * deal_share_views: SELECT only. Rows are written by the server on the privileged
--     connection, and nobody can edit or delete one through the application. "Who saw this,
--     and when" is only worth having if it cannot be tidied afterwards.
--
-- The memo columns are nullable (a share may cover one document) and a CHECK requires
-- at least one. That each memo belongs to the opportunity and is FINAL is checked in the
-- application at creation (it needs a lookup) and re-checked in the read join on every
-- access. A memo is a VERSION, not a format: the snapshot and the teaser are two renderings
-- of memo content, so both columns may point at the same final version or at different ones.
--
-- Opportunity and memo references are NOT cascading: deleting an opportunity that was
-- shared is refused rather than silently erasing the record of what a prospect was shown.
-- (A final memo already cannot be deleted, app.guard_memo, so this is the backstop.)
-- ============================================================================

create table if not exists deal_shares (
  share_id         uuid primary key default gen_random_uuid(),
  opportunity_id   uuid not null references opportunities(opportunity_id),
  snapshot_memo_id uuid references memos(memo_id),
  teaser_memo_id   uuid references memos(memo_id),
  prospect_name    text not null check (char_length(btrim(prospect_name)) between 1 and 200),
  prospect_email   text not null check (char_length(prospect_email) between 3 and 320 and position('@' in prospect_email) > 1),
  -- SHA-256 hex of the raw token. Never the token.
  token_hash       text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  created_by       uuid references profiles(user_id),
  created_at       timestamptz not null default now(),
  constraint deal_shares_has_a_document check (snapshot_memo_id is not null or teaser_memo_id is not null),
  constraint deal_shares_expires_after_creation check (expires_at > created_at)
);
create index if not exists idx_deal_shares_opportunity on deal_shares(opportunity_id, created_at desc);

comment on table deal_shares is
  'Named, expiring, revocable links showing a prospect (not an investor) the frozen Asset Snapshot and/or Investor Teaser of one opportunity. Only the SHA-256 of the token is stored. Revocation is the only permitted update.';

create table if not exists deal_share_views (
  view_id   uuid primary key default gen_random_uuid(),
  share_id  uuid not null references deal_shares(share_id) on delete cascade,
  viewed_at timestamptz not null default now()
);
create index if not exists idx_deal_share_views_share on deal_share_views(share_id, viewed_at desc);

comment on table deal_share_views is
  'One row per successful open of a deal share. Deliberately no IP, user agent or location: the prospect is already named on the share.';

alter table deal_shares enable row level security;
alter table deal_share_views enable row level security;

drop policy if exists deal_shares_admin on deal_shares;
create policy deal_shares_admin on deal_shares for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

drop policy if exists deal_share_views_admin_read on deal_share_views;
create policy deal_share_views_admin_read on deal_share_views for select to authenticated
  using (app.is_admin());

-- Supabase's default privileges hand `anon` rights on every new table in `public`;
-- take them back and grant only what is used (same posture as 0005 and 0006).
revoke all on deal_shares, deal_share_views from anon, public;
revoke all on deal_shares, deal_share_views from authenticated;
grant select, insert on deal_shares to authenticated;
grant update (revoked_at) on deal_shares to authenticated;
grant select on deal_share_views to authenticated;
