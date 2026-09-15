# Destructive Reset Safety

**The automated suites destroy a database every time they run, and so does
`npm run db:reset`.** This document is how to give them a database that is safe
to destroy, and why they refuse to run until you do.

---

## 0. Two different questions

These get confused with each other, and the confusion is what destroys data.

| | Setting | Question it answers |
|---|---|---|
| **Classification** | `app.environment` | What is this database *for*? |
| **Permission** | `app.destructive_reset_allowed` | May this database be *destroyed*? |

**Neither implies the other.** A database classified `development` can still be
the one a live-facing preview deployment reads from, still hold the only copy of
a week of manual setup, still be the thing somebody is demonstrating from in an
hour. A project classified `test` is in exactly the same position the moment
anyone starts relying on it.

So permission is separate, is granted per database, and is withdrawable without
changing what the database is for:

```sql
ALTER DATABASE postgres SET app.destructive_reset_allowed = 'true';   -- grant
ALTER DATABASE postgres RESET app.destructive_reset_allowed;          -- withdraw
```

**Nothing else counts as evidence of disposability.** Not the database name, not
the project name, not the hostname, not the word "development" anywhere in the
connection string, not localhost, and not the operator having typed `--yes`.
Every one of those is a statement about what somebody *believes* the database
is. The marker is the database's own answer.

> ### `reiwa-dev` must not carry the destructive-reset marker
>
> Not while it is connected to any live-facing deployment, and not while it
> holds data anyone would miss — which, in practice, is most of the time.
>
> `reiwa-dev` is a development database by classification, and that is exactly
> the trap: "it's only dev" is how a week of work disappears. If it is backing a
> preview deploy, a demo, or a client-facing walkthrough, it is live-facing.
> Leave it unmarked and it cannot be reset by accident, by anyone, ever.
>
> If you genuinely need to rebuild it: grant the marker, run the reset, and
> withdraw the marker again in the same sitting.

| Database | `app.environment` | `app.destructive_reset_allowed` |
|---|---|---|
| Production | `production` | **never set** |
| Staging | `staging` | **never set** |
| `reiwa-dev` | `development` | **not set** (see above) |
| Dedicated test project | `test` | `true` |
| A scratch database you just created | anything | `true`, while it is scratch |

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
4. **The target is a disposable test database**, established three ways:
   - it is not the same database as `DATABASE_URL`, `PRODUCTION_DATABASE_URL`,
     `PROD_DATABASE_URL`, `STAGING_DATABASE_URL`, `DEV_DATABASE_URL` or
     `DEVELOPMENT_DATABASE_URL`; **and**
   - the database reports `app.environment = 'test'` (classification); **and**
   - the database reports `app.destructive_reset_allowed = 'true'` (permission).

Both markers are read in a single round trip. Conditions 1-3 and the URL
comparison are decided from environment variables alone — no connection is
opened, so a misconfigured run is refused before it can reach any database. The
marker check is a single `SELECT`. **No `DROP` is reachable from a refused
run.**

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

2. **Classify it and permit its destruction.** In the project's SQL editor,
   connected as the database owner:

   ```sql
   ALTER DATABASE postgres SET app.environment = 'test';                 -- what it is for
   ALTER DATABASE postgres SET app.destructive_reset_allowed = 'true';   -- may be destroyed
   ```

   Both are needed, and they mean different things (see §0). These are
   per-database settings, so they survive `drop schema` and cannot be inherited
   by accident from a connection string or a checked-in file. Confirm them **in
   a new session** — the settings apply to sessions opened after them:

   ```sql
   SELECT current_setting('app.environment', true),
          current_setting('app.destructive_reset_allowed', true);  -- expect: test, true
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

> **Withdrawing permission.** The moment anyone starts relying on the test
> project — a demo, a shared fixture, a preview deploy — take the permission
> away and leave the classification alone:
> `ALTER DATABASE postgres RESET app.destructive_reset_allowed;`
> The suite then refuses, which is the behaviour that makes two markers worth
> having.

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

## 7. `npm run db:reset` — the operator path

`npm run db:reset -- --yes` resets **`DATABASE_URL`**, and it is gated too.

**`--yes` is necessary and not sufficient.** It records that you meant to type
the command. It says nothing about which database `DATABASE_URL` is pointed at
right now — and that is the failure that costs data: a stale `.env.local`, a
shell that still has last week's export in it, a terminal that is not the one
you think it is. The case that matters is the one where the operator is certain
and wrong.

So the target must also carry `app.destructive_reset_allowed = 'true'`:

```
Refusing destructive database reset: target database is not explicitly marked disposable.

  Reason: app.destructive_reset_allowed is not set on the target database.
  An unmarked database is treated as one whose data matters.
```

Note that the operator path checks **permission only**, not classification: you
may legitimately rebuild a scratch database that is not the test project. What
you may not do is rebuild one that has never said it is disposable.

The automated suites cannot reach this path — they have no way to pass `--yes` —
and `resetDatabase()` requires an authorisation token that only the test-database
gate or an operator confirmation can mint.

---

## 8. Where the code lives

| File | Role |
|---|---|
| `src/lib/db/destructive-reset.ts` | Permission: the `app.destructive_reset_allowed` rule, shared by both paths. |
| `src/lib/db/test-database.ts` | Classification: the test-database environment checks and `app.environment`. |
| `src/lib/db/reset.ts` | `resetDatabase()` requires a `ResetAuthorization`; mints them via `authorizeTestDatabaseReset()` or `authorizeOperatorReset()`. |
| `src/lib/db/client.ts` | `probeDatabaseSettings()` — the read-only marker probe, both settings in one round trip. |
| `tests/test-database-env.ts` | Points a test process at `TEST_DATABASE_URL`. |
| `tests/global-setup.ts` | The destructive reset, behind the gate. |
| `tests/unit/test-database-guard.test.ts` | The guard's own tests. No database required. |
| `vitest.unit.config.mts` | Runs those tests without any global setup. |
