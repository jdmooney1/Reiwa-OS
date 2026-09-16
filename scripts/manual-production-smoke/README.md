# Manual production smoke

**Nothing in this directory runs automatically, and nothing in it is part of
`npm run test:e2e`.** It drives a *real deployment*: it signs in, triggers
one-time-code emails that really arrive, downloads real documents, and — for
`provision-contact.ts` — writes a real investor contact and a live invitation
token.

## Why it is here and not in `e2e/`

These began as three untracked scratch specs (`_prod.spec.ts`, `_prod2.spec.ts`,
`_diag.spec.ts`) sitting inside `e2e/`, with `https://portal.reiwa-capital.com`
compiled into them. Playwright discovers everything under its `testDir`, so
`npm run test:e2e` would have run all three against production — overriding the
`baseURL`, and therefore untouched by the test-database redirect that protects
every other spec.

Two properties are inverted here:

| | Before | Now |
|---|---|---|
| Discovery | inside `e2e/`, picked up by a normal run | outside `testDir`, and the main config's `testIgnore` rejects these names besides |
| Target | production hostname hard-coded | no default; the origin must be named on the command line |

`tests/unit/playwright-discovery.test.ts` asserts both, without a browser or a
network, so a future file dropped into `e2e/_something.spec.ts` fails the unit
suite rather than reaching a deployment.

## Opting in

Every file here refuses at module scope unless **both** are set:

```
ALLOW_PRODUCTION_SMOKE=true
PRODUCTION_SMOKE_BASE_URL=https://<origin>
```

`provision-contact.ts` needs a **third**, because permitting a read is not
permitting a write:

```
PRODUCTION_SMOKE_WRITE=true
```

## What each one is for

| File | Reads or writes | What it proves that the UAT suite cannot |
|---|---|---|
| `investor-journey.spec.ts` | reads | A deployed build serves what you think you deployed; a one-time code really arrives; a signed document URL points at the storage host with a real token; internal surfaces stay closed to an investor session *on the deployment*. |
| `server-actions.spec.ts` | reads | Server-action POSTs survive the real proxy on each host — the failure where the page renders perfectly and only the POST is rejected. |
| `provision-contact.ts` | **writes** | Creates the investor whose mailbox a person can read, so the journey can be run at all. |

## Running one

The one-time code cannot be read by a machine: hosted Supabase emails it and
keeps only a hash. So the specs **wait** for a human to write the code into
`OTP_FILE`.

```bash
# 1. An investor you can receive mail for (writes real data).
ALLOW_PRODUCTION_SMOKE=true PRODUCTION_SMOKE_WRITE=true \
PRODUCTION_SMOKE_BASE_URL=https://<origin> \
SMOKE_INVESTOR_ORG_ID=<uuid> SMOKE_INVESTOR_EMAIL=you+smoke@example.com \
  npx tsx scripts/manual-production-smoke/provision-contact.ts

# 2. The journey. Paste the emailed code into $OTP_FILE when it waits.
ALLOW_PRODUCTION_SMOKE=true \
PRODUCTION_SMOKE_BASE_URL=https://<origin> \
ACCESS_URL=https://<origin>/access/<token-from-step-1> \
SMOKE_INVESTOR_EMAIL=you+smoke@example.com \
OTP_FILE=/tmp/otp SMOKE_OUT_DIR=.smoke \
  npx playwright test --config scripts/manual-production-smoke/playwright.config.ts \
    investor-journey
```

Findings are written to `SMOKE_OUT_DIR` (default `.smoke/`) as JSON plus
screenshots, continuously, so a run that fails half way still reports what it
learned.

**Afterwards:** deactivate the contact and revoke the invitation. A smoke
fixture left active is a real account in a real portal.
