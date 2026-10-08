-- ============================================================================
-- 0033 — ic_member global role
-- ----------------------------------------------------------------------------
-- The deal document system (docs/24) needs a role that may authorise a gate
-- override and record an investment-committee decision, without being
-- `reiwa_admin` (which also carries the Investment Portal admin surface,
-- settings, and every other admin-only action).
--
-- `organization_members.role` (owner/manager/analyst/viewer) is NOT extended
-- for this: the audit for docs/24 confirmed it is stored but never read by any
-- permission check in `src/` — `can_write()` is driven entirely by
-- `profiles.global_role`. Reviving a dead enum for a new capability would be
-- two places deciding the same thing. `global_role` is the one place
-- capability already lives, so it gains a fourth value instead.
--
-- `can_write()` (src/lib/auth/session.ts) already returns true for anything
-- other than `investor_viewer`, so `ic_member` can write without any change
-- there. The override-specific check (`ic_member` or `reiwa_admin` may record
-- an override or an IC decision; nobody else may) is Session 3 work — this
-- migration only makes the value legal to store.
-- ============================================================================

alter table profiles drop constraint if exists profiles_global_role_check;
alter table profiles
  add constraint profiles_global_role_check
    check (global_role in ('reiwa_admin', 'org_user', 'investor_viewer', 'ic_member'));

comment on column profiles.global_role is
  'reiwa_admin: full admin incl. Investment Portal. org_user: internal staff, read/write own org. investor_viewer: internal staff, read-only own org (NOT a portal investor — see investor_contacts). ic_member: internal staff, read/write own org, plus authority to approve a gate override or record an IC decision (docs/24).';

-- ---- Helpers --------------------------------------------------------------
-- Same shape as app.is_admin() (0001): a stable, empty-search-path read of the
-- claim, so a policy never queries a table to decide access. Placed here,
-- next to the role they test, rather than in a later migration each needs.
create or replace function app.is_ic_member() returns boolean
  language sql stable
  set search_path = ''
  as $$ select app.current_global_role() = 'ic_member' $$;

-- Gate overrides and catalogue edits need "admin or IC member", repeatedly,
-- from 0035 onward. One named predicate rather than the same OR rewritten in
-- every policy that needs it.
create or replace function app.can_override_gates() returns boolean
  language sql stable
  set search_path = ''
  as $$ select app.is_admin() or app.is_ic_member() $$;

revoke execute on function app.is_ic_member() from public, anon;
revoke execute on function app.can_override_gates() from public, anon;
grant execute on function app.is_ic_member() to authenticated;
grant execute on function app.can_override_gates() to authenticated;

-- ROLLBACK:
--   drop function if exists app.can_override_gates();
--   drop function if exists app.is_ic_member();
--   alter table profiles drop constraint profiles_global_role_check;
--   alter table profiles add constraint profiles_global_role_check
--     check (global_role in ('reiwa_admin', 'org_user', 'investor_viewer'));
--   -- Only safe if no row has been set to 'ic_member' in the meantime; the
--   -- forward migration raises on apply if the constraint can't validate.
