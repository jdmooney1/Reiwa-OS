# Test Database Safety

**The automated suites destroy a database every time they run.** This document
is how to give them one that is safe to destroy, and why they will refuse to run
until you do.

---

## 1. What went wrong, and what changed

`tests/global-setup.ts` calls `resetDatabase()`, which drops every application
table and the `app` schema, re-migrates and reseeds. It used to do that to
whatever `DATABASE_URL` pointed at.

That meant the only thing standing between `npm test` and a development,
staging or production Supabase project was which value happened to be in
`.env.local` at the time. Being configured to talk to a database is not
authorisation to destroy it, and this was found during Phase 1B acceptance
before any harm was done.

The harness no longer reads `DATABASE_URL` at all. It reads `TEST_DATABASE_URL`,
**with no fallback**, and four independent conditions must hold before a single
statement is issued.

---

## 2. Environment variables

| Variable | Purpose |
|---|---|
| `TEST_DATABASE_URL` | The **only** connection string the automated suites will touch. A separate, disposable Supabase project. Never the same database as `DATABASE_URL`. There is no fallback: if it is absent, the suite stops before opening a connection. |
| `ALLOW_TEST_DATABASE_RESET` | Must be exactly `true` to authorise a **destructive** run. It authorises *destroying* the database, not connecting to it — so Vitest needs it and Playwright does not. Set it per-run on the command line. **Do not export it in your shell profile or put it in `.env.local`.** |

`DATABASE_URL` keeps its existing meaning: the application's own database. It
is never reset by the test harness, and naming it in `TEST_DATABASE_URL` is a
hard refusal.

---

## 3. The four conditions

A destructive reset happens only if **all** of these hold:

1. **An explicit test runtime** — `NODE_ENV === "test"`. Vitest sets this
   itself; nothing in the application or a deployment does.
2. **`TEST_DATABASE_URL` is set.** No fallback to `DATABASE_URL`, ever.
3. **`ALLOW_TEST_DATABASE_RESET=true`** — a deliberate opt-in for this run.
4. **The target is a disposable test database**, established two ways:
   - it is not the same database as `DATABASE_URL`, `PRODUCTION_DATABASE_URL`,
     `PROD_DATABASE_URL`, `STAGING_DATABASE_URL`, `DEV_DATABASE_URL` or
     `DEVELOPMENT_DATABASE_URL`; **and**
   - the database itself reports `app.environment = 'test'`.

Conditions 1-3 and the URL comparison are decided from environment variables
alone — no connection is opened, so a misconfigured run is refused before it can
reach any database. The marker check is a single `SELECT`. **No `DROP` is
reachable from a refused run.**

### Why a database-level marker rather than a name

A name containing "test" is a naming convention, and a convention is a property
of whoever typed the name — not of the database. `reiwa-test-restore` could
easily be a production restore. The marker is set once, deliberately, on the
database itself, and survives the `drop schema` it guards.

### How database identity is compared

Connection strings are reduced to `user@host/database`, ignoring the password
and the port:

- **The username matters** because on hosted Supabase every project in a region
  shares the pooler hostname and the database name `postgres`. The project ref
  lives in the username (`postgres.<project-ref>`). Comparing on host and
  database alone would refuse a perfectly good separate test project.
- **The port does not matter** because the same database reached through the
  transaction pooler (6543) and directly (5432) is the same database.

---

## 4. Provisioning a disposable test database

> **Never use `reiwa-dev`, staging or production.** Not "carefully", not "just
> this once". The suite drops every application table on every run.

1. **Create a separate Supabase project.** Name it so nobody mistakes it for
   anything else, e.g. `reiwa-test-throwaway`. It needs no custom domain, no
   real data and no backups — everything in it is recreated by the seeder.

2. **Mark the database as disposable.** In the project's SQL editor, connected
   as the database owner:

   ```sql
   ALTER DATABASE postgres SET app.environment = 'test';
   ```

   This is a per-database setting, so it survives `drop schema` and cannot be
   inherited by accident from a connection string or a checked-in file. Confirm
   it, **in a new session** — the setting applies to sessions opened after it:

   ```sql
   SELECT current_setting('app.environment', true);   -- expect: test
   ```

3. **Put its connection string in `TEST_DATABASE_URL`**, in `.env.local`:

   ```
   TEST_DATABASE_URL=postgresql://postgres.<test-project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```

   Leave `DATABASE_URL` pointing at your development project. The two must name
   different databases.

4. **The Supabase Auth users are seeded for you.** The seeder provisions them
   through the Admin API using `SUPABASE_SECRET_KEY`, so that key must belong to
   the *test* project for a test run.

> **Reversing the marker.** If a database should no longer be resettable:
> `ALTER DATABASE postgres RESET app.environment;`

---

## 5. Running the suites safely

**Non-destructive checks — no database needed, run these first:**

```bash
npm run typecheck
npm run lint
npm run build
npm run test:unit      # includes the guard's own tests
```

**Destructive integration suite (Vitest).** Drops and reseeds
`TEST_DATABASE_URL`:

```bash
ALLOW_TEST_DATABASE_RESET=true npm test
```

**End-to-end suite (Playwright).** Reads and writes rows against an
already-seeded test database; it does **not** reset, and must **not** be given
the destructive flag:

```bash
npm run test:e2e
```

Playwright starts the application itself with `DATABASE_URL` overridden to
`TEST_DATABASE_URL`, so the server under test can only reach the test database.
It never reuses a server already running on the port, because that server was
started by somebody else and may point anywhere.

If a browser-version mismatch appears, name the browser explicitly rather than
downloading one:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:e2e
```

**Order matters:** run Vitest first (it seeds), then Playwright (it expects a
seeded database).

---

## 6. What a refusal looks like

Every refusal leads with the same line, then says exactly which condition failed
and how to fix it:

```
Refusing destructive test reset: TEST_DATABASE_URL is not an approved disposable test database.

  Reason: TEST_DATABASE_URL names the same database as DATABASE_URL
  (postgres.liveproj@aws-0-ap-northeast-1.pooler.supabase.com/postgres).
  A test database must be a separate, disposable database.
```

**Never "fix" a refusal by copying `DATABASE_URL` into `TEST_DATABASE_URL`.**
That is the exact accident this exists to prevent, and it is refused too.

---

## 7. `npm run db:reset` is a different thing

`npm run db:reset -- --yes` resets **`DATABASE_URL`** — your own development
database — because a person asked for it at a terminal. That path is unchanged
and is not covered by this gate: the confirmation is the authorisation.

The automated suites cannot reach it. They have no way to pass `--yes`, and
`resetDatabase()` now requires an authorisation token that only the
test-database gate or an operator confirmation can mint.

Be as careful with `db:reset` as you always were. It will happily destroy
whatever `DATABASE_URL` names.

---

## 8. Where the code lives

| File | Role |
|---|---|
| `src/lib/db/test-database.ts` | The gate. Pure environment checks plus the marker rule. |
| `src/lib/db/reset.ts` | `resetDatabase()` requires a `ResetAuthorization`; mints them via `authorizeTestDatabaseReset()` or `authorizeOperatorReset()`. |
| `src/lib/db/client.ts` | `probeDatabaseSetting()` — the read-only marker probe. |
| `tests/test-database-env.ts` | Points a test process at `TEST_DATABASE_URL`. |
| `tests/global-setup.ts` | The destructive reset, behind the gate. |
| `tests/unit/test-database-guard.test.ts` | The guard's own tests. No database required. |
| `vitest.unit.config.mts` | Runs those tests without any global setup. |
