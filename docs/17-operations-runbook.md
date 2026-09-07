# Reiwa Capital Investment Portal — Operations Runbook

Everything needed to run the portal in production, and the procedures for the
things that will actually come up: onboarding an investor, granting diligence,
revoking access in a hurry, and rolling back.

> **Never seed demonstration data into production.** `npm run db:reset` and
> `npm run db:seed` create fictional investors, opportunities and Auth users.
> They are development commands. See [Seed and test data](#seed-and-test-data).

---

## 1. Environment variables

All four are required. The application refuses to start without them and names
what is missing — there is no default and no local fallback.

| Variable | Where it may go | What it is |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | The publishable ("anon") key. RLS is what protects the data. |
| `SUPABASE_SECRET_KEY` | **server only** | Service key. Provisions Auth users and signs document URLs. Never expose. |
| `DATABASE_URL` | **server only** | Pooler connection string, port 6543. |

Optional: `SUPABASE_DB_CA_CERT` (PEM or path; the root ships at
`supabase/prod-ca-2021.crt`), `DATABASE_POOL_MAX` (default 8).

Only the two `NEXT_PUBLIC_` values may ever reach a browser. A test asserts
this, and a second test scans every `"use client"` file for the server-only
names.

---

## 2. Supabase project configuration

1. **Auth → Providers → Email**: enabled. **Confirm email** on.
2. **Auth → Providers → Email → "Enable email signups"**: the portal never
   self-registers — every OTP request runs with `shouldCreateUser: false`, and
   the address is checked against `investor_contacts` before Supabase is called.
   Leaving signups on does not open a hole, but turning it off adds a second
   lock. Prefer off.
3. **Auth → Rate limits**: review the OTP send limit. The built-in mailer is
   heavily throttled — see [SMTP](#3-smtp).
4. **Auth → Sessions**: default JWT expiry is fine; the middleware refreshes.
5. **OTP length/expiry**: whatever the project is set to. The application does
   **not** assume six digits — the input accepts what the provider issues.
   Check **Auth → Providers → Email → OTP Expiry** (3600s default; 600s is a
   reasonable production value).

---

## 3. SMTP

**Mandatory before the first real investor.** Without custom SMTP the project
uses Supabase's built-in mailer, which is rate-limited to a few messages an
hour and refuses reserved domains outright.

1. **Auth → SMTP Settings → Enable Custom SMTP.**
2. Provider: Resend, SendGrid, SES or Postmark. Any will do.
3. **Sender**: a Reiwa Capital identity — `no-reply@reiwacapital.com` or
   similar — on a domain with **SPF and DKIM configured**. Investment
   correspondence that lands in spam is worse than none.
4. **Auth → Email Templates → Magic Link / OTP**: set Reiwa wording. The code
   is `{{ .Token }}`.
5. Verify: create an invitation for a real address and complete the flow.

Never paste SMTP credentials into the repository, a ticket or a report.

---

## 4. Storage

One private bucket, `publication-documents`.

```bash
npm run storage:setup     # idempotent; run on every deploy
```

It creates the bucket private, or forces an existing one private. **No Storage
policy grants `anon` or `authenticated` anything** — investors cannot read the
bucket with their own credentials at all.

Delivery: the investor clicks Download → a server action re-checks entitlement
against the database under their own RLS → only then is a signed URL minted,
valid for **60 seconds**. Revoking an entitlement blocks the next download
immediately; there is no standing grant to withdraw.

Limits: 50 MB per file; PDF, Office documents, PNG/JPEG.

---

## 5. Migrations

```bash
npm run db:migrate        # apply pending migrations; never destructive
```

The ledger lives in `app._migrations`, not `public`, so PostgREST never sees
it. Migrations are applied in filename order inside a transaction each; a
failure rolls that migration back and stops.

`0007_production_hardening.sql` is the security baseline: it removes `anon`
privileges, narrows `authenticated`, corrects the project default privileges so
future tables cannot silently leak, and makes the activity record append-only.

> **Dashboard caveat.** `0007` corrects the default privileges for the
> `postgres` grantor, which is what migrations run as. It cannot correct the
> `supabase_admin` grantor from this connection. A table created **from the
> Supabase dashboard SQL editor** may therefore still be granted to `anon`.
> Create tables through migrations, and the privilege regression test will
> catch it if one ever isn't.

---

## 6. Deployment

```bash
npm ci
npm run typecheck && npm run lint && npm test
npm run build
npm run db:migrate
npm run storage:setup
npm start
```

Set the four environment variables in the host. Node 20+.

---

## 7. Seed and test data

`npm run db:reset` **drops the application schema** and reseeds fictional data,
including Auth users on `.example` domains. It is for development and CI only.

**Production rule:** never run `db:reset` or `db:seed` against the production
project. Onboard the first real investor by hand (§8). If demonstration data
has ever been in the production project, delete the fictional investor
organisations and their Auth users before the first real investor is invited.

---

## 8. Onboarding a real investor

All of this is in **Reiwa OS → Investment Portal → Investors** as a Reiwa admin.

**a. Create the organisation**
Investors → *New organisation* → legal name → Active.

**b. Add the contact**
Open the organisation → *Add contact* → name, email (this address is the only
one that will ever receive a code), title.

**c. Provision their Auth identity**
On the contact row → *Provision access*. Creates a passwordless Supabase Auth
user. No password is ever set; OTP is the only route in.

**d. Assign what they may see**
Organisation → *Assign publication* → choose the publication → set
**Featured** or **Also Available**, set the order, and set the document tier
(**Standard** or **Diligence**). An entitlement is invisible until you make it
visible — default deny.

**e. Invite them**
Contact row → *Create invitation*. The link is shown **once**; only its SHA-256
hash is stored. Send it to them. It expires in 14 days, and creating a new one
revokes the previous one.

---

## 9. Granting diligence access

Organisation → the assigned publication → **Document access** → Diligence.

Takes effect on their next request. `Standard` sees standard documents only;
`Diligence` sees standard **and** diligence. `Internal` documents are never
visible or downloadable at any tier — that is structural, not a setting.

---

## 10. Emergency investor deactivation

Fastest first.

| Situation | Action | Effect |
| --- | --- | --- |
| One person must lose access now | Contact row → **Deactivate** | Immediate. Their next request resolves to no identity; documents, portal and API all refuse. |
| A whole firm must lose access now | Organisation → status **Suspended** | Immediate, for every contact at that firm. |
| One opportunity must be pulled from one investor | Entitlement → **Hide** | Immediate. It leaves their portal and saved list; documents refuse. |
| An opportunity must be pulled from everyone | Publication → **Withdraw** | Immediate, all investors. |

All four take effect on the **next request** — there is no session to expire, no
cache to clear and no signed URL that outlives sixty seconds. Revocation is
verified by test at every one of these levels.

To also end their current browser session, delete the user's sessions in
**Supabase → Auth → Users**.

---

## 11. Invitations

- Raw token: 32 random bytes, base64url, generated server-side.
- Only the SHA-256 hash is stored. The raw token is shown to the admin once.
- Default expiry 14 days; expiry and revocation are enforced on every lookup.
- Creating a new invitation revokes any outstanding one for that contact.
- Accepting is one-shot; a used link cannot restart the flow.
- The token is carried to the code screen in an httpOnly cookie, not in the
  URL, so it does not accumulate in access logs or browser history.

To revoke: contact row → the invitation → **Revoke**. Immediate.

---

## 12. Rollback

**Application:** deploy the previous commit. The build is stateless.

**Database:** migrations are forward-only — there are no down-migrations. To
roll back a schema change, write a new migration that reverses it and deploy
that. Take a backup first:

```bash
pg_dump "$DATABASE_URL" --schema=public --no-owner > backup-$(date +%F).sql
```

Supabase also keeps automatic daily backups (**Database → Backups**);
point-in-time recovery is available on paid plans and is worth enabling before
the first real investor.

**Storage:** objects are not versioned. Deleting a document row deletes its
bytes. Keep the source files outside the portal.

---

## 13. Monitoring

- **Supabase → Logs → Auth**: OTP sends, failures, rate limiting.
- **Supabase → Logs → Postgres**: policy violations show as `42501`.
- **Application logs**: database failures are wrapped with the operation and
  SQLSTATE for diagnosis. Users only ever see a generic message and an opaque
  reference — match the reference to the server log.
- **Reiwa OS → Investment Portal → Activity**: what investors have actually
  done. Factual record only; no scoring.
