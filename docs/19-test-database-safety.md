# Destructive Reset Safety

**The automated suites destroy a database every time they run, and so does
`npm run db:reset`.** This document is how to give them a database that is safe
to destroy, and why they refuse to run until you do.

> ### A test environment is not a database
>
> It is a database **and** a Supabase project. The suites reset Postgres, and
> they also **create Auth users, delete Auth users, create a Storage bucket, and
> upload and delete objects in it**.
>
> Only the first of those was gated originally, which made the whole arrangement
> look safe while every identity and every object the suite created went to the
> *application's* project. Both halves are now armed together, by one call, and
> neither can be armed without the other — §2.1.
>
> **Automated tests must never provision Auth users or Storage resources in
> `reiwa-dev`.**

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

### What was found next: the database was only half the blast radius

The Postgres gate was correct, complete, and — this is the part worth
remembering — it made the whole arrangement *look* safe. It was not.

A Supabase project is not only a database. The seeder creates Supabase Auth users
for every staff account and every seeded investor contact;
`tests/document-delivery.test.ts` uploads real bytes to a Storage bucket and
deletes them again; the E2E suite creates an Auth user and an investor
organisation of its own. All of that went through `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SECRET_KEY` — the *application's* project.

So a fully-gated run could reset a disposable test Postgres while creating and
deleting accounts and objects in `reiwa-dev`, and report success. Nothing would
look wrong until somebody noticed accounts they had not created, or a document
that had gone.

A second leak sat beside it: the Playwright **runner** process was never
redirected at all. Only the server it started was. So `e2e/helpers.ts` and
`e2e/investor-session.spec.ts` — which reach the Admin API and the database
directly — used `.env.local` and wrote to `reiwa-dev` on every UAT run.

Both were found during the Phase 1B hardening audit, before any harm was done.
Auth and Storage now have their own dedicated credentials with the same
no-fallback rule, and every process that executes a test arms both halves
together.

---

## 2. Environment variables

| Variable | Purpose |
|---|---|
| `TEST_DATABASE_URL` | The **only** connection string the automated suites will touch. A separate, disposable Supabase project. Never the same database as `DATABASE_URL`. There is no fallback: if it is absent, the suite stops before opening a connection. |
| `TEST_SUPABASE_URL` | The **same** project's API URL. Every Auth call and every Storage call a test makes goes here. |
| `TEST_SUPABASE_PUBLISHABLE_KEY` | That project's publishable (anon) key. |
| `TEST_SUPABASE_SECRET_KEY` | That project's secret key — the Admin API credential the seeder uses to create Auth users. |
| `ALLOW_TEST_DATABASE_RESET` | Must be exactly `true` to authorise a **destructive** run. It authorises *destroying* the database, not connecting to it — so Vitest needs it and Playwright does not. Set it per-run on the command line. **Do not export it in your shell profile or put it in `.env.local`.** |

The four application variables keep their existing meaning and are never read by
the harness:

| Normal application | Automated test environment |
|---|---|
| `DATABASE_URL` | `TEST_DATABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_URL` | `TEST_SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `TEST_SUPABASE_PUBLISHABLE_KEY` |
| `SUPABASE_SECRET_KEY` | `TEST_SUPABASE_SECRET_KEY` |

**There is no fallback across that line, in either direction.** Naming the
application's database in `TEST_DATABASE_URL` is a hard refusal, and so is
reusing any of its API credentials under a `TEST_` name. Being configured to
reach a project has never been authorisation to write to it.

### 2.1 Auth and Storage are *declared*, not overwritten

The two halves are redirected by different mechanisms, and the difference is
deliberate.

**Supabase is declared.** `src/lib/supabase/env.ts` lets a process state which
project it is talking to, and the harness does exactly that once, at startup,
after the gate has passed. `NEXT_PUBLIC_SUPABASE_URL` and friends are left
completely alone — they keep meaning the development project, in the test
process as everywhere else. That is what keeps the question *"is the test
project the same as the application project?"* answerable at all: a gate that
compares a value with itself always passes.

**The database is redirected**, by overwriting `DATABASE_URL` inside the test
process, because `createPool()` reads `DATABASE_URL` and the alternative is a
"which database am I talking to?" branch inside production code. The pre-redirect
value is preserved and every later authorisation is decided against *that*.

Both are armed by a single call — `useTestEnvironment()` in
`tests/test-environment.ts` — so no caller can obtain an isolated database and
accidentally get the application's Supabase project along with it. Both gates run
to completion before anything is mutated or declared, so a refusal leaves the
process exactly as it found it.

### 2.2 Proving the four variables describe one project

A mismatch between them is worse than any one of them being missing: seeding one
project's Postgres while provisioning identities in another produces a broken
fixture *and* writes somewhere nobody chose.

A hosted Supabase project is identified by its **project ref**, and it appears in
two of the four variables in a form that can be compared exactly, offline, with
no secret leaving the process:

```
TEST_SUPABASE_URL   https://<ref>.supabase.co
TEST_DATABASE_URL   postgresql://postgres.<ref>:...@...pooler.supabase.com:6543/postgres
```

Those refs must match. They must also *differ* from the application project's
ref, so pointing the test variables at `reiwa-dev` cannot be spelled at all.

The keys are the honest part of the problem. A modern `sb_publishable_…` /
`sb_secret_…` key is an opaque random string carrying no ref, so **no offline
check can prove a key belongs to the test project** — and a check that cannot
fail is worse than no check, because people trust it.

What makes a stray key *safe* rather than merely unchecked is that **a key is
only ever sent to the URL declared beside it**. The URL and the keys resolve as
one unit, so a `reiwa-dev` key configured here by mistake is sent to the *test*
project, where it is rejected. It never reaches `reiwa-dev`, so it cannot write
there. The URL selects the project; the URL's ref is checked exactly.

Everything that *can* be contradicted offline still is: a legacy JWT key carries
its ref as a claim and it is compared; a test key identical to its application
counterpart is refused; swapped or unrecognisable keys are refused. And one live
check runs before the first Auth user is created — that the secret key
authenticates against the test project — so a wrong key is a named refusal rather
than an authorisation error half way through seeding.

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

And a fifth condition, which is not about the database at all:

5. **The dedicated test Supabase project is configured** — all three
   `TEST_SUPABASE_` variables present, none of them borrowed from the
   application, and all agreeing with `TEST_DATABASE_URL` about which project
   they describe (§2.2).

It is checked *first*, before the database gate, and it is pure. So a run with no
test Supabase project configured is refused before a connection is opened and
before any client exists — **no Auth user is created, no Auth user is deleted, no
bucket or object is touched, and nothing is reset or seeded.**

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

4. **Put the same project's API credentials in the three `TEST_SUPABASE_`
   variables**, from that project's dashboard:

   ```
   TEST_SUPABASE_URL=https://<test-project-ref>.supabase.co
   TEST_SUPABASE_PUBLISHABLE_KEY=<the TEST project's publishable key>
   TEST_SUPABASE_SECRET_KEY=<the TEST project's secret key>
   ```

   The seeder provisions Supabase Auth users through the Admin API, and the
   suite uploads real bytes to a Storage bucket. Both use these, and neither
   falls back to `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SECRET_KEY`.

   **Leave the four application variables exactly as they are**, pointing at your
   development project. Nothing in the harness reads them, and the gate needs
   them unchanged in order to check that the test project is not the application
   project.

   The `<test-project-ref>` in all of these must be the same one that appears in
   `TEST_DATABASE_URL`, or the run is refused.

5. **The Storage bucket is provisioned for you** by the integration suite's
   global setup, on the test project, inside the gate. To create it by hand —
   for a brand-new test project, or to run Playwright before the first
   `npm test` — use `npm run db:storage:test`. That is a *different command*
   from `npm run db:storage`, which remains the operator path and still targets
   `NEXT_PUBLIC_SUPABASE_URL`: an operator who types the command they have always
   typed must get the project they meant.

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
`TEST_DATABASE_URL`, and creates Auth users and a Storage bucket in the test
project:

```bash
ALLOW_TEST_DATABASE_RESET=true npm test
```

On PowerShell, set it for the one command and then remove it — the flag is meant
to be typed per run, never inherited:

```powershell
$env:ALLOW_TEST_DATABASE_RESET="true"
npm test
Remove-Item Env:ALLOW_TEST_DATABASE_RESET
```

**End-to-end suite (Playwright).** Reads and writes rows against an
already-seeded test database; it does **not** reset, and must **not** be given
the destructive flag:

```bash
npm run test:e2e
```

Playwright arms the test environment in **both** processes that matter, and the
second one used to be missed:

* **The server under test** is started with `DATABASE_URL` and the three
  Supabase variables overridden to the test project's values, so it can only
  reach the test database and can only create Auth users and Storage objects in
  the test project. This is the one place the application's variable *names*
  carry test values — it is the environment of a throwaway server process the
  harness itself starts, not a rewrite of anyone's `.env.local`.
* **The runner**, where the specs themselves execute. `e2e/helpers.ts` mints
  one-time codes through the Auth Admin API and `e2e/investor-session.spec.ts`
  creates Auth users, investor organisations and contacts directly. That process
  was never redirected, so every UAT run wrote fixture identities into
  `reiwa-dev`. Arming happens at config module scope, which Playwright loads in
  the runner and in each worker.

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
| `src/lib/db/test-supabase.ts` | The Supabase-project isolation gate: presence, no-fallback, and the project-identity comparison. Pure. |
| `src/lib/supabase/project-ref.ts` | Reads a project ref out of an API URL, a connection string or a legacy JWT. Pure, and never returns a key. |
| `src/lib/supabase/env.ts` | Resolves the Supabase credentials, and lets a process *declare* which project it is talking to. |
| `tests/test-environment.ts` | Arms both halves — database redirect and Supabase declaration — in one call. |
| `tests/supabase-preflight.ts` | The one live check: that the test project accepts its own secret key, before any user is created. |
| `tests/global-setup.ts` | The destructive reset and the Storage bucket, behind the gate. |
| `tests/unit/test-database-guard.test.ts` | The database guard's own tests. No database required. |
| `tests/unit/test-supabase-guard.test.ts` | The Supabase guard's own tests. No project required. |
| `tests/unit/playwright-discovery.test.ts` | Proves a normal Playwright run cannot discover production-smoke tooling. |
| `playwright.discovery.ts` | The never-discover rule, shared by the config that enforces it and the test that proves it. |
| `vitest.unit.config.mts` | Runs those tests without any global setup. |

---

## 9. Manual production smoke

`scripts/manual-production-smoke/` drives a **real deployment**: it signs in,
triggers one-time-code emails that really arrive, and — for
`provision-contact.ts` — writes a real investor contact and a live invitation
token.

It was previously three untracked specs inside `e2e/` with the production
hostname compiled into them. Playwright discovers everything under its
`testDir`, so `npm run test:e2e` would have driven production; and because they
overrode `baseURL`, the test-database redirect that protects every other spec did
not apply to them.

Two properties are now inverted, and both are asserted by
`tests/unit/playwright-discovery.test.ts`:

* **Not discoverable.** The tooling is outside `testDir`, and the main config
  ignores those names besides. A file dropped into `e2e/_anything.spec.ts` fails
  the unit suite rather than reaching a deployment.
* **No hard-coded origin.** There is no default target. Running anything there
  requires `ALLOW_PRODUCTION_SMOKE=true`, an explicit
  `PRODUCTION_SMOKE_BASE_URL`, its own config named on the command line, and — to
  write anything — a second opt-in, `PRODUCTION_SMOKE_WRITE=true`.

See `scripts/manual-production-smoke/README.md`.
