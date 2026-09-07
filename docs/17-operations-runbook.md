# Operations Runbook

How to stand up, run and recover Reiwa OS in production. Written for whoever is
on the end of the phone, not for whoever wrote the code.

Two rules sit above everything else in this document:

- **The production database is never the demonstration database.** The seed is
  designed for a development project and must never touch a real one.
- **An investor sees only what an entitlement says they may see.** Every
  procedure below either grants that entitlement deliberately or removes it
  immediately. Nothing is ever "temporarily" widened.

---

## 1. Environment variables

Four are required. There is no default and no fallback for any of them: the
application refuses to start without all four, and tells you which are missing
and what each is for. That is deliberate — a half-configured deployment that
comes up anyway is how the wrong database gets written to.

| Variable | Value | Exposure |
| --- | --- | --- |
| `DATABASE_URL` | Supabase transaction pooler connection string, port **6543**: `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres` | **Server only.** Never in a client bundle, never in a log. |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | Public. Reaches the browser by design. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The `sb_publishable_…` key | Public. Row level security is what protects the data, not this key. |
| `SUPABASE_SECRET_KEY` | The `sb_secret_…` key | **Server only.** Bypasses RLS. Treat as a root credential. |

Optional:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_DB_CA_CERT` | Override the shipped Supabase root CA (`supabase/prod-ca-2021.crt`). A PEM string or a path. TLS verification is always on and is never disabled. |
| `DATABASE_POOL_MAX` | Local connection pool size (default 8). Raise only if the pooler's own limits allow it. |

**Checks before every deploy**

- `.env.local` is git-ignored and is not in the repository. `npm test` asserts
  both, and that no `.env` file other than `.env.example` is tracked.
- The publishable key and the secret key are not swapped. A publishable key in
  `SUPABASE_SECRET_KEY` fails Auth Admin calls with `401 no_authorization` —
  provisioning and invitations stop working while everything else looks fine.
- `DATABASE_URL` points at the pooler (6543), not the direct connection (5432).
- The project reference in `DATABASE_URL` matches the one in
  `NEXT_PUBLIC_SUPABASE_URL`. Pointing the two at different projects produces a
  system that authenticates against one and reads from another.

**Rotating the secret key.** Rotate in the Supabase dashboard, update the
deployment's environment, redeploy. Nothing caches it. Invitations already
issued are unaffected — they are database rows, not key-derived.

---

## 2. Supabase configuration

**Auth**

- Email OTP enabled. Email/password is used only by internal staff.
- Sign-ups **disabled**. The application always sends `shouldCreateUser: false`,
  but the project setting is the belt to that brace: no OTP request may ever
  mint an account.
- OTP length is a project setting. The application does not assume one — it does
  not say "6-digit" anywhere and applies no length check — so 6 or 8 both work.
  If you change it, no code change is needed.
- OTP expiry: 10 minutes is the working default. Longer widens the window in
  which an intercepted email is useful.

**Database**

- Row level security is enabled on every application table and must stay that
  way. Migration `0007` fails rather than complete if any table has it off.
- `anon` holds no privilege on any table, view or sequence in `public`, and
  neither does `PUBLIC`. `authenticated` holds no `TRUNCATE`, `REFERENCES` or
  `TRIGGER`. Supabase's default privileges are revoked for the migration
  grantor, so a new table inherits nothing.
- Do not add privileges through the dashboard's table editor. It grants
  generously by default and will silently undo the above.

**Storage**

- One bucket: `publication-documents`. **Private.** No public URL is ever
  minted; investors receive a 60-second signed URL and never a storage path.
- Create it with `npm run db:storage`, which is idempotent and safe before every
  deploy. If the bucket is already public, the script fails rather than quietly
  fixing it — a public bucket means objects may already have been exposed, so
  make it private in the dashboard and rotate anything that was in it.
- Allowed types: PDF, XLSX/XLS, DOCX/DOC, PPTX/PPT, CSV, PNG, JPEG, ZIP.
  Ceiling: 50 MB. Both are enforced server-side regardless of what the browser
  claimed.

**SMTP**

Supabase's shared SMTP is rate-limited and unsuitable for investor mail. Use a
custom SMTP provider (Resend) so OTP emails arrive from a Reiwa domain.

1. Verify `reiwa-capital.com` with the provider: SPF, DKIM and (recommended)
   DMARC records in DNS. Allow for propagation.
2. In Supabase → Project Settings → Authentication → SMTP Settings, enter the
   provider's host, port, username and password, and set the sender to a real
   monitored Reiwa address.
3. Set the sender **name** to `Reiwa Capital`. Investors receive this cold; an
   unfamiliar sender goes to spam or gets ignored.
4. Send one real invitation to a deliverable address and confirm the OTP
   arrives, the code works and `/portal` opens.

Until step 4 passes, the portal cannot admit a new investor. Everything else
works; this is an external launch blocker, not a code one.

---

## 3. Migrations and deployment

```bash
npm ci
npm run db:migrate        # apply pending migrations
npm run db:storage        # ensure the private bucket
npm run build
npm start
```

Migrations are ledgered in `app._migrations`, applied in filename order, one
transaction each. A failed migration rolls back and stops the run; it is never
half-applied.

**Never run `npm run db:reset` against production.** It drops every application
table. It requires `--yes`, and that is the only guard — there is no other.

Deployment order matters: migrate before the new build serves traffic, so the
schema is never behind the code.

---

## 4. No demonstration data in production

`npm run db:seed` and the seed inside `db:reset` create demonstration
organisations, staff accounts with a shared password (`reiwa2026`), four
fictional investor firms and their contacts. **None of it belongs in
production.**

- Run neither `db:seed` nor `db:reset` against the production project. Ever.
- `db:migrate` does not seed. It is the only database command a production
  deployment needs.
- The sign-in page's demonstration credentials are compiled out of a production
  build (`NODE_ENV`), so they are absent from the bundle rather than hidden.

**Verifying a clean production database**

```sql
-- Expect zero rows for all three.
select email from profiles where email like '%@reiwa.com' or email like '%@meiji.com';
select name  from investor_organizations where name in
  ('Kitano Family Office','Sakura Capital Partners','Hanabi Ventures');
select email from investor_contacts where email like '%.example';
```

If any return rows, the seed has been run against production. Stop, and treat
it as an incident: demonstration accounts share a published password.

---

## 5. The first real investor

Order matters. Each step is refused until the one before it is done.

**5.1 Create the organisation** — `/admin/investors` → New Investor
Organisation. Status `active`. Suspended and archived organisations see
nothing.

**5.2 Add the contact** — real name, real email, job title. The email is the
identity: it is what the OTP goes to and what authorises them. A typo here
means a stranger can request a code.

**5.3 Provision the sign-in** — "Provision sign-in" on the contact. This creates
the passwordless Supabase Auth identity and anchors it to the contact row.
Nothing else works until this is done, and an invitation cannot be created for
an unprovisioned contact.

**5.4 Assign publications** — before inviting them, not after. An investor whose
first sign-in shows an empty portal has been given a bad first impression of a
private-office product.

Assign from either side (`/admin/investors/<id>` or the publication's Investor
Access tab). Each entitlement carries:

- **Visible** — off by default. An entitlement grants nothing until this is on.
- **Placement** — `featured` (one per organisation) or `secondary`.
- **Document access** — `standard` or `diligence`. See 5.6.

**5.5 Send the invitation** — "Create invitation" on the contact produces a link
of the form `https://<host>/access/<token>`, shown **once**. Only a SHA-256 hash
is stored; it cannot be retrieved later. Send it to the contact's own address —
never a shared inbox, never a group.

The link is valid for 14 days, is single-use, and creating a new one revokes the
previous one, so a contact never has two live links. It grants nothing by
itself: it identifies the intended context, and only the one-time code emailed
to the authorised address signs anyone in.

What the investor does: opens the link, which validates server-side and
immediately redirects to a page carrying no token; requests a code; enters it;
lands on `/portal`.

**5.6 Diligence access** — a deliberate, per-organisation decision, usually after
an NDA. Set "Document access" to `diligence` on that organisation's entitlement.

| Tier | Sees |
| --- | --- |
| `standard` | Standard documents only |
| `diligence` | Standard **and** diligence documents |
| — | `internal` documents are readable by **no** investor at any tier, ever |

Classify a document `internal` when it should never leave Reiwa. That is not a
convention; the database refuses to release it.

**5.7 Adding documents** — a publication's documents belong to a version and are
frozen when that version is published. Attach them while the version is a draft.
Upload through the Documents tab: the file is stored at a random,
server-generated path in the private bucket, and its type and size are validated
server-side. Deleting the row deletes the stored object with it.

---

## 6. Emergency: cutting off access

All of these take effect on the investor's **very next request**. There is no
cache and no grace period: entitlement is re-derived per statement, and a signed
URL already issued expires within 60 seconds.

**One contact has left, or their email is compromised**

`/admin/investors/<id>` → the contact → **Deactivate**. Immediately: no portal
access, no OTP will be issued to that address, no document download, and any
outstanding invitation stops working.

**A whole organisation must be stopped**

`/admin/investors/<id>` → status → **Suspended**. Every contact at that firm
loses access at once. Reversible: set back to `active`.

**One opportunity must be pulled from one investor**

The entitlement's **Revoke** (or clear Visible). That organisation stops seeing
it; every other investor is unaffected.

**One opportunity must be pulled from everyone**

The publication's **Withdraw**. The live version is superseded and the
publication leaves every portal. Reversible by drafting and publishing a new
version.

**A document was released in error**

Delete the document row in the Documents tab. The row and the stored object both
go. Then check who already downloaded it — `/admin/activity`, filtered to
`document_downloaded` — and decide whether that needs a conversation.

**Everything, right now**

Suspend every investor organisation. If the situation is worse than that, rotate
`SUPABASE_SECRET_KEY` and the database password in the Supabase dashboard and
redeploy; every existing session is invalidated.

---

## 7. Rollback

**Application code.** Redeploy the previous build. The application is stateless;
nothing but the database persists.

**Migrations.** There are no down-migrations, deliberately: a generated rollback
is a good way to lose data confidently. To reverse a schema change, write a new
forward migration that undoes it, and test it against a development project
first.

**Data.** Supabase's Point-in-Time Recovery is the mechanism. Confirm PITR is
enabled on the production project before launch — it is not on by default on
every plan. Restoring is a project-level operation from the dashboard; it
restores everything, so treat it as a last resort rather than a way to undo one
bad row.

**A bad publication.** Withdraw it, draft a corrected version, publish. Versions
are immutable once published, so there is a complete record of what each
investor was actually shown and when.

---

## 8. Monitoring

**Watch for**

| Signal | Where | Means |
| --- | --- | --- |
| `[reiwa] <scope> failed (ref …)` | Server log | An unhandled failure. The reference matches the one shown on screen; the log line carries the SQLSTATE, constraint, table and stack. |
| `[db] idle client error` | Server log | A pooled connection died in the background. Occasional is normal; sustained means the pooler is unhealthy. |
| 404s from `/portal/documents/<id>` | Access log | Refused downloads. One is routine (an expired entitlement); a burst from one session is worth looking at. |
| Auth `401 no_authorization` | Server log | The secret key is wrong or has been rotated without redeploying. |
| Rising OTP requests with no verifications | Supabase Auth logs | Email delivery has stopped. Check the SMTP provider first. |

**Check weekly**

- `/admin/activity` — who is actually reading, and what.
- Open requests on the admin overview — an investor asking for diligence access
  or a meeting is a commercial signal with a short shelf life.
- Invitations created but never accepted — usually a delivery problem, not a
  disinterested investor.

**Check before each deploy**

```bash
npm test            # full suite against the configured database
npm run typecheck
npm run lint
npm run build
npm run test:e2e    # real-browser UAT at three viewports
```

**The privilege audit.** Run after any schema change, and periodically:

```sql
-- Expect zero rows: anon and PUBLIC hold nothing in public.
select c.relname, a.privilege_type
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
 where n.nspname = 'public' and (a.grantee = 'anon'::regrole or a.grantee = 0);

-- Expect zero rows: authenticated holds no structural privilege.
select c.relname, a.privilege_type
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
 where n.nspname = 'public' and a.grantee = 'authenticated'::regrole
   and a.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER');

-- Expect zero rows: every table keeps row level security.
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity;
```

The test suite asserts all three, so a green `npm test` against production's
schema is the same audit.

**Activity is append-only.** `investor_activity_events` cannot be updated or
deleted by any signed-in session, staff included — the privilege is not
granted and no policy allows it. Retention or erasure is a deliberate act on the
privileged connection, and should be recorded outside the system when it
happens.

---

## 9. Launch checklist

- [ ] Production Supabase project created; PITR enabled
- [ ] Four environment variables set; publishable and secret keys not swapped
- [ ] `npm run db:migrate` applied; ledger shows every migration
- [ ] `npm run db:storage` run; bucket exists and is **private**
- [ ] Privilege audit returns zero rows on all three queries
- [ ] No demonstration data (section 4 queries return nothing)
- [ ] Sign-ups disabled in Supabase Auth
- [ ] Custom SMTP configured and a real OTP email received end to end
- [ ] First investor organisation, contact, provisioning and entitlement done
- [ ] One real invitation delivered, accepted, and `/portal` reached
- [ ] One document uploaded, downloaded by the investor, and the download
      visible in `/admin/activity`
