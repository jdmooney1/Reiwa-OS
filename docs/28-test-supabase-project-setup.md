# 28 · Setting up the disposable TEST_* Supabase project

docs/24 Session 4 cannot be switched on (`deal_room_enabled`) until the
integration suite passes against a real, disposable Supabase project. This is
the exact, step-by-step runbook for creating that project — docs/19 explains
*why* each step exists; this page is only the *how*, in order.

Nothing here touches `reiwa-dev` or production. This is a brand-new, separate
Supabase project, created once and reused by every future `npm test` run.

---

## 1. Create the project

In the [Supabase dashboard](https://supabase.com/dashboard), create a new
project — any name that makes it obviously a test project to a future reader
(e.g. `reiwa-os-test`). Any region is fine; it holds no real data, ever.

Wait for provisioning to finish before continuing.

## 2. Mark the database as test + destroyable

Open the new project's **SQL Editor** and run:

```sql
ALTER DATABASE postgres SET app.environment = 'test';
ALTER DATABASE postgres SET app.destructive_reset_allowed = 'true';
```

Per docs/19: **neither marker is inferred from anything else** — not the
project name, not "test" appearing anywhere in the URL. This SQL is the only
thing that makes `npm test` and `npm run db:reset -- --yes` willing to touch
this database at all. Run it on this project and nowhere else.

## 3. Collect the four values

From the new project's dashboard:

- **Settings → Database → Connection string → Transaction pooler** (port
  `6543`) → this is `TEST_DATABASE_URL`. Fill in the password you set when the
  project was created.
- **Settings → API → Project URL** → this is `TEST_SUPABASE_URL`.
- **Settings → API → Project API keys → `anon` / publishable** →
  `TEST_SUPABASE_PUBLISHABLE_KEY`.
- **Settings → API → Project API keys → `service_role` / secret** →
  `TEST_SUPABASE_SECRET_KEY`. Treat this exactly like the production secret
  key — it is a service-role credential, just for a disposable project.

## 4. Write them into `.env.local`

Open `.env.local` (copy from `.env.example` first if you don't have one yet)
and fill in the four `TEST_*` lines — leave every other variable
(`DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, etc.) pointing at your own
development project, untouched:

```
TEST_DATABASE_URL=postgresql://postgres.<test-project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
TEST_SUPABASE_URL=https://<test-project-ref>.supabase.co
TEST_SUPABASE_PUBLISHABLE_KEY=<the anon/publishable key>
TEST_SUPABASE_SECRET_KEY=<the service_role key>
```

The harness checks that `TEST_SUPABASE_URL`'s project ref matches
`TEST_DATABASE_URL`'s — copy both from the *same* project, or the suite
refuses with a clear mismatch error rather than running against the wrong one.

## 5. Run the suite

```powershell
ALLOW_TEST_DATABASE_RESET=true npm test
```

First run: expect it to take a little longer, since it is migrating and
seeding a brand-new database from scratch (all migrations, 0001 through the
latest — currently 0059 — plus the `doc_type` seed). Every run after that
re-resets and re-seeds the same project, so it is safe to run repeatedly.

If anything refuses, the error names exactly which check failed (missing
variable, mismatched project ref, missing destructive-reset marker) — docs/19
has the full explanation for each one.

## 6. What this unlocks

Once this passes clean, the Session 4a integration suite
(`tests/deal-document-investor-access.test.ts`, plus the existing
`tests/investor-rls.test.ts` and `tests/publication-lifecycle.test.ts`) has
actually run against real Postgres RLS, not just been read for correctness.
That is the precondition — stated in docs/24 Session 4 — for ever setting
`deal_room_enabled` to `true` anywhere real investors can reach.
