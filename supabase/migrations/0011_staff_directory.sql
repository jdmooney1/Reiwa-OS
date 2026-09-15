-- ============================================================================
-- 0011 — Internal staff directory (Phase 1B)
-- ----------------------------------------------------------------------------
-- The Opportunity Workspace has to say who owns an opportunity, who wrote an
-- underwriting version, who is carrying a diligence workstream, who a risk sits
-- with, who recorded a committee minute and who added a document. Those are the
-- questions an investment file exists to answer years later; a file that says
-- "—" in every one of them is not a record of anything.
--
-- It could not answer them. `profiles_self` (0001) restricts a user to their own
-- profile row, which is the right rule for a table carrying a global role and an
-- email address — so every `left join profiles` in the workspace resolved to
-- null for a COLLEAGUE, silently, with no error to notice. The Phase 1B tests
-- passed only because the author in them was the test user itself.
--
-- The two obvious repairs are both wrong:
--
--   * Broadening `profiles_self` would hand every internal user every
--     colleague's email and global role in order to render a name.
--   * Resolving names in the application over the privileged connection would
--     move an access decision out of the database, which is the one thing this
--     system's design says it will not do.
--
-- So: the smallest possible capability, in the database, returning the smallest
-- possible answer. `app.staff_names()` maps user ids to display names and
-- nothing else. No email, no global role, no created_at, no auth metadata. A
-- caller learns what a colleague is called, which is what the screen needs, and
-- learns nothing it did not already know about who that colleague is.
--
-- AUTHORISATION, stated plainly. A row is returned only when ALL of these hold:
--
--   1. The caller is internal staff — it has a `profiles` row of its own. A
--      portal investor never does (see the seeder: investor contacts get an Auth
--      user and an `investor_contacts` row and NOTHING else), so this single
--      clause denies them the directory entirely, by construction rather than by
--      rule. `auth.uid()` is null for an unauthenticated caller, so the same
--      clause denies anon.
--   2. The caller is `reiwa_admin`, OR the caller and the subject share an
--      organisation. Administrators are checked with the existing
--      `app.is_admin()` helper rather than a second rule, which is also why an
--      administrator needs no `organization_members` row — exactly as
--      `app.has_org()` has always behaved.
--   3. The subject has a name recorded. A subject with no name yields no row
--      rather than a fallback to their email address.
--
-- Co-membership is read from `organization_members` keyed on `auth.uid()`
-- rather than from the JWT's `org_ids` claim. The table is the authority the
-- claim is derived from, so this is the same organisation model and never a
-- wider one: a membership revoked in the database stops resolving names
-- immediately instead of at the next token refresh.
--
-- SECURITY DEFINER, so the function reads `profiles` and `organization_members`
-- past RLS. That is the whole point, and it is why every clause above is inside
-- the function rather than left to a policy. `search_path` is pinned empty and
-- every reference is schema-qualified, so nothing in the body can be captured by
-- a caller-controlled schema. EXECUTE is granted to `authenticated` only;
-- PUBLIC and `anon` are revoked explicitly, and `anon` cannot enter schema `app`
-- in any case.
--
-- NOT broadened by this migration: no policy is created, altered or dropped,
-- `profiles_self` is untouched, and no table grant changes. The only new
-- privilege in the database is EXECUTE on one function for `authenticated`.
-- ============================================================================

-- ---- The directory ---------------------------------------------------------
-- A set-returning batch resolver, not one call per user. A 51-line diligence
-- framework owned by six people is one round trip, and the workspace already
-- fetches per screen rather than per row.
create or replace function app.staff_names(user_ids uuid[])
  returns table (user_id uuid, display_name text)
  language sql
  stable
  security definer
  set search_path = ''
  as $$
    select p.user_id, p.name
      from public.profiles p
     where p.user_id = any (coalesce(user_ids, array[]::uuid[]))
       -- (3) a name exists to be given; never fall back to the email address.
       and p.name is not null
       and p.name <> ''
       -- (1) the caller is internal staff. Null auth.uid() matches nothing.
       and exists (select 1
                     from public.profiles caller
                    where caller.user_id = auth.uid())
       -- (2) an administrator, or a colleague in a shared organisation.
       and (
         app.is_admin()
         or exists (select 1
                      from public.organization_members caller_orgs
                      join public.organization_members subject_orgs
                        on subject_orgs.org_id = caller_orgs.org_id
                     where caller_orgs.user_id = auth.uid()
                       and subject_orgs.user_id = p.user_id)
       )
  $$;

comment on function app.staff_names(uuid[]) is
  'Internal staff display names for the given user ids. Returns user_id and name '
  'only — never email, global role or auth metadata. Denies portal investors and '
  'anon by requiring the caller to hold a profiles row; otherwise an administrator '
  'resolves anyone and every other caller resolves only colleagues sharing an '
  'organisation. See migration 0011.';

-- ---- Privileges ------------------------------------------------------------
-- Enumerated, in the style 0001 set and 0007/0008 hardened: PUBLIC and anon are
-- revoked explicitly even though 0008 already fixed the default for schema app,
-- because a function that depends on a default privilege having been set
-- correctly elsewhere is a function whose privileges nobody can read off its own
-- migration.
revoke execute on function app.staff_names(uuid[]) from public, anon;
grant execute on function app.staff_names(uuid[]) to authenticated;
