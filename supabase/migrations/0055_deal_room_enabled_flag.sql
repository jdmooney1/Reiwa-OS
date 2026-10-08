-- ============================================================================
-- 0055 — deal_room_enabled: the kill switch, OFF by default
-- ----------------------------------------------------------------------------
-- Session 4 scope item 8: while this is false, no deal_document content
-- reaches the investor tenancy, under any entitlement, exemption or status.
-- Enforced in RLS (0056 reads this on every investor-facing deal_document/
-- document_version row), not in application code, for the same reason every
-- other investor boundary in this codebase is a database fact rather than a
-- UI convention.
--
-- platform_settings (0051) already restricts reads to an explicit staff
-- allowlist (0052) that does NOT include an investor identity — an investor
-- session has no profiles row at all, so app.current_global_role() resolves
-- to nothing in that list. A SECURITY DEFINER reader is therefore required
-- for an investor-facing RLS policy to consult this flag at all, the same
-- shape as app.doc_type_applies' platform-setting read (0051) and
-- app.is_staff() (0035) — the function sees the row; the investor session
-- still cannot read platform_settings directly.
-- ============================================================================

insert into platform_settings (key, value)
  values ('deal_room_enabled', 'false'::jsonb)
  on conflict (key) do nothing;

create or replace function app.deal_room_enabled() returns boolean
  language sql stable security definer
  set search_path = ''
  as $fn$
    select coalesce(
      (select value = 'true'::jsonb from public.platform_settings where key = 'deal_room_enabled'),
      false)
  $fn$;

revoke execute on function app.deal_room_enabled() from public, anon;
grant execute on function app.deal_room_enabled() to authenticated;

comment on function app.deal_room_enabled() is
  'Reads platform_settings.deal_room_enabled on behalf of a caller who cannot read platform_settings directly (an investor session) — SECURITY DEFINER, same shape as the 0035 staff-role claim reader. Defaults false on a missing row.';

-- ROLLBACK:
--   drop function if exists app.deal_room_enabled();
--   delete from platform_settings where key = 'deal_room_enabled';
