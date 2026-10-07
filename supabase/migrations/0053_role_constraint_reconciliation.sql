-- ============================================================================
-- 0053 — reconcile profiles.global_role after two branches both added a value
-- ----------------------------------------------------------------------------
-- THE DEFECT. This branch's 0033_ic_member_role.sql and the product-polish branch's
-- 0035_staff_role.sql each do a full `drop constraint` / `add constraint` on
-- `profiles_global_role_check` instead of an additive change, each listing only its
-- own new role value (`ic_member`, `reiwa_staff`) alongside the pre-existing three.
-- Whichever migration a given environment happened to apply last silently dropped
-- the other's value from the allowed set — see docs/24 §12 for the two different
-- outcomes this produced (production lost `reiwa_staff`; a fresh database applying
-- every file in one alphabetical pass loses `ic_member` instead). Neither case
-- raised an error, because no `profiles` row held the dropped value at the time.
--
-- THE FIX. Numbered after every migration either branch defines, so it is always
-- the last to touch this constraint, on every environment, regardless of which of
-- the two orderings above that environment happened to apply: re-assert the full
-- union of all five values. Nothing is granted and no row is touched — same as
-- 0033 and 0035, this only makes every value legal to store.
-- ============================================================================

alter table profiles drop constraint if exists profiles_global_role_check;
alter table profiles
  add constraint profiles_global_role_check
    check (global_role in ('reiwa_admin', 'org_user', 'investor_viewer', 'ic_member', 'reiwa_staff'));

comment on column profiles.global_role is
  'reiwa_admin: full admin incl. Investment Portal. org_user: internal staff, read/write own org. investor_viewer: internal staff, read-only own org (NOT a portal investor — see investor_contacts). ic_member: internal staff, read/write own org, plus authority to approve a gate override or record an IC decision (docs/24). reiwa_staff: internal staff, pre-publication pipeline work only (0035) — no investor-portal or publication access, no platform_settings access (not added to that allowlist; see docs/24 §12).';

-- ROLLBACK:
--   alter table profiles drop constraint if exists profiles_global_role_check;
--   alter table profiles add constraint profiles_global_role_check
--     check (global_role in ('reiwa_admin', 'org_user', 'investor_viewer', 'ic_member'));
--   -- Only safe if no row has been set to 'reiwa_staff' in the meantime; the
--   -- forward migration raises on apply if the constraint can't validate.
