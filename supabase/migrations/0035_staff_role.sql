-- ============================================================================
-- 0035 - A second internal role: reiwa_staff
-- ----------------------------------------------------------------------------
-- WHY. Until now every internal user was `reiwa_admin`, which is a full superuser: every
-- client's data, the whole investor portal, publishing. Two roles, deliberately, not a matrix:
--
--   reiwa_admin  unchanged. Everything.
--   reiwa_staff  works the pipeline BEFORE anything is investor-facing: opportunities,
--                underwriting, investment cases, diligence, risks, documents, memos, and the
--                two memo drafting aids (AI review, Japanese translation).
--
-- WHAT reiwa_staff CANNOT DO, and where that is enforced. Every restriction is a database
-- policy, not a button that is hidden:
--
--   1. Publish, withdraw, grant or revoke. Every investor-portal table's write policy is
--      `app.is_admin()` (0005, 0006). `reiwa_staff` is not `reiwa_admin`, so the policies
--      match no row and the statements affect nothing or are refused. Nothing in this
--      migration touches them, which is the point: the boundary is a role check that already
--      existed, and staff simply is not on the right side of it.
--   2. Manage users or organisations. `profiles` is select-only and `organization_members` has no write
--      policy, so no session can change a role or a membership; both are privileged-connection
--      operations (scripts, the operations runbook). This migration also withdraws the
--      write PRIVILEGE on `organization_members` underneath the policy, so a future policy
--      added by mistake could not re-open it (the same belt and braces as 0007).
--   3. See investor organisations, entitlements, publications, requests, activity, invitations
--      or prospect links. All of those are `app.is_admin()` for reads too. Until there is a
--      real assignment model, staff see none of it.
--
-- CLIENT ORGANISATIONS. `app.has_org()` is `is_admin() or the org is in the caller's
-- memberships`. Staff is not admin, so a staff user sees exactly the organisations they are a
-- MEMBER of, the same assignment model org_user already uses. No membership, no deal data.
-- (If the firm would rather staff see every client organisation, that is one line in has_org;
-- it was left out because widening later is safe and narrowing later is not.)
--
-- THE ONE WIDENING. The two memo drafting aids, AI review (0030) and Japanese translation
-- (0031), were admin-only because there was no one else internal. They are pre-investor
-- drafting, so staff may use them, but only on memos they can already see: the policy asks the
-- memos table, which applies its own organisation policy to the caller.
--
-- EXISTING USERS. Nothing is converted and nothing is granted: the constraint gains a value,
-- no row is touched, every existing reiwa_admin stays reiwa_admin, and nobody holds the new
-- role until a person with database access assigns it (there is no screen for that yet).
-- ============================================================================

-- 1. The role exists.
alter table public.profiles drop constraint if exists profiles_global_role_check;
alter table public.profiles
  add constraint profiles_global_role_check
  check (global_role in ('reiwa_admin', 'reiwa_staff', 'org_user', 'investor_viewer'));

-- 2. Internal staff, in the sense "a Reiwa employee": admin or staff. NOT an admin check, and
--    used only where a policy deliberately admits staff.
create or replace function app.is_staff() returns boolean
  language sql stable
  set search_path = ''
  as $$ select app.current_global_role() in ('reiwa_admin', 'reiwa_staff') $$;

revoke execute on function app.is_staff() from public, anon;
grant execute on function app.is_staff() to authenticated;

-- 3. The memo drafting aids: administrators everywhere (unchanged), staff on memos they can see.
drop policy if exists memo_ai_reviews_admin_read on public.memo_ai_reviews;
drop policy if exists memo_ai_reviews_staff_read on public.memo_ai_reviews;
create policy memo_ai_reviews_staff_read on public.memo_ai_reviews for select to authenticated
  using (app.is_staff() and exists (
    select 1 from public.memos m where m.memo_id = memo_ai_reviews.memo_id));
drop policy if exists memo_ai_reviews_admin_write on public.memo_ai_reviews;
drop policy if exists memo_ai_reviews_staff_write on public.memo_ai_reviews;
create policy memo_ai_reviews_staff_write on public.memo_ai_reviews for insert to authenticated
  with check (app.is_staff() and exists (
    select 1 from public.memos m where m.memo_id = memo_ai_reviews.memo_id));

drop policy if exists memo_translation_drafts_admin_read on public.memo_translation_drafts;
drop policy if exists memo_translation_drafts_staff_read on public.memo_translation_drafts;
create policy memo_translation_drafts_staff_read on public.memo_translation_drafts for select to authenticated
  using (app.is_staff() and exists (
    select 1 from public.memos m where m.memo_id = memo_translation_drafts.memo_id));
drop policy if exists memo_translation_drafts_admin_write on public.memo_translation_drafts;
drop policy if exists memo_translation_drafts_staff_write on public.memo_translation_drafts;
create policy memo_translation_drafts_staff_write on public.memo_translation_drafts for insert to authenticated
  with check (app.is_staff() and exists (
    select 1 from public.memos m where m.memo_id = memo_translation_drafts.memo_id));
drop policy if exists memo_translation_drafts_admin_accept on public.memo_translation_drafts;
drop policy if exists memo_translation_drafts_staff_accept on public.memo_translation_drafts;
create policy memo_translation_drafts_staff_accept on public.memo_translation_drafts for update to authenticated
  using (app.is_staff() and exists (
    select 1 from public.memos m where m.memo_id = memo_translation_drafts.memo_id))
  with check (app.is_staff() and exists (
    select 1 from public.memos m where m.memo_id = memo_translation_drafts.memo_id));

-- 4. Client organisations are administered by administrators. 0001 let ANY member with write scope
--    update or DELETE their own organisation (`orgs_write ... for all`), and deleting an
--    organisation cascades to every deal it holds. That was reachable by client org users and
--    would have been reachable by staff: renaming or erasing a client is managing access, so it
--    is an administrator act. Nothing in the application writes organisations through a session
--    (they are created by the seed and by scripts on the privileged connection).
drop policy if exists orgs_write on public.organizations;
drop policy if exists orgs_admin_write on public.organizations;
create policy orgs_admin_write on public.organizations for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- 5. Nobody signed in can write membership, whatever policy is added later (as 0007 did for the
--    audit trail). Reads are unchanged.
revoke insert, update, delete, truncate, references, trigger
  on public.organization_members from authenticated;
revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
