# P6 — Launch Hardening

No new product surface. P6 closes the gap between "the feature works" and "this
can be handed to a real investor", and it is the last phase before branding.

Everything below was found by looking at the running system — the live privilege
catalogue, a real browser, an actual upload — rather than by reading the code.

---

## What changed, and why it mattered

### Secure document delivery

P1 built the tiering and P4 showed the documents; nothing delivered them. The
portal said "secure delivery pending".

An investor now presents a **document id** and nothing else. The lookup runs
inside `withInvestorSession()`, so `publication_documents_tiered` decides it from
`auth.uid()` alone, and the answer is a **60-second signed URL** from a private
bucket. There is no tier comparison, status check or organisation id in
application code — which is the point: a defect in `secure-delivery.ts` cannot
widen access, because the row never arrives.

Refusals are indistinguishable from each other and from "no such document": a
revoked entitlement, a deactivated contact, a suspended organisation, a
withdrawn publication, an `internal` document, a guessed id and a malformed id
all produce the same 404 with no body.

`document_downloaded` is written **only after** a signed URL has been minted, and
the write is private to that module, so the event cannot be emitted from
anywhere that has not just delivered bytes.

Admin upload stores files at a **server-generated random path**
(`publications/<versionId>/<uuid><ext>`), with the extension taken from the
validated MIME type rather than the file name. The browser never supplies a
path. Deleting the row deletes the object, and the path used for that comes back
from the deleted row.

### Database hardening

The live catalogue audit found `anon` — the role an **unauthenticated** request
arrives on — holding `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`,
`REFERENCES` and `TRIGGER` on every table migrations `0001`–`0004` created.
Nothing leaked, because RLS denied those requests. But one table shipped without
RLS, or one policy written `to public`, and the data would have been immediately
writable by anyone holding the publishable key. That is one mistake away from a
breach, and the privilege was never needed.

`authenticated` held `TRUNCATE` everywhere. **Row level security does not filter
`TRUNCATE`** — no policy can stop it — so the privilege alone let any signed-in
session empty a table.

Supabase's stock `ALTER DEFAULT PRIVILEGES` re-granted all of it to `anon` on
every new table, so fixing the catalogue without fixing the default would have
re-introduced the problem with the next migration.

Migration `0007` corrects all three, asserts its own result, and fails rather
than complete if any of it is wrong. It also makes `investor_activity_events`
append-only for **staff** as well as investors — the admin policy had been
written `for all` in the same loop as the other ten portal tables, so staff could
rewrite history. An audit trail its reader can edit is not an audit trail.

### Invitation hand-off

The raw token used to persist in the `/access/<token>` URL the browser stayed on,
in a `?invite=` redirect after it, and in a hidden form field. Browser history,
the address bar, the `Referer` header and any access log all kept a copy.

It now appears in **one** URL — the emailed link — and that URL renders nothing:
it validates server-side, moves the token into a short-lived `httpOnly` cookie
and redirects to a page carrying no credential. A refused invitation hands on
only the *reason*, never the token.

Every P3 guarantee is unchanged and re-asserted rather than assumed: 32 random
bytes, hash-only storage, expiry, revocation, predecessor invalidation, one-shot
acceptance.

### Connection resilience

Bounded retry on **acquisition only**, and that distinction is the whole safety
argument. A stale pooled socket fails before any statement has been sent, so
retrying cannot repeat work. Once a statement is in flight it may have committed
on the far side of a connection that died before the acknowledgement came back —
so no transaction is replayed and no statement re-sent, however transient the
failure looks. `keepAlive` on, idle timeout cut to 10s.

Teardown drops `app` **first**, so cascade takes the trigger functions and the
policies that referenced them; the tables then go in one statement rather than
27 — one round trip instead of 27.

### Environment, errors, OTP

Configuration has no defaults, because a fallback is the one line that lets a
misconfigured deployment come up looking healthy and write to the wrong
database. A missing variable reports every missing variable at once.

Failures tell the log everything (SQLSTATE, constraint, table, stack, a
reference) and the screen nothing but that reference. A database message is a
map of the schema; a stack trace is a map of the code.

The OTP UI assumed six digits. A project's OTP length is a Supabase **setting** —
this project may issue eight — so nothing in the copy, the input or the
server-side handling assumes a length.

### Browser and accessibility UAT

Real Chromium, production build, three viewports. Fixed: the unlabelled investor
search field, the absent global `:focus-visible` rule (Tailwind's preflight
removes the browser outline, so most of the application was focusable but
invisible), unhandled `prefers-reduced-motion`, text tones failing WCAG AA
contrast as low as 2.5:1, and demonstration credentials shipping in the sign-in
page.

---

## The rules a change to this codebase must not break

Each is enforced by a test, not by convention.

| Rule | Where |
| --- | --- |
| `anon` and `PUBLIC` hold nothing in `public`; a new table inherits nothing | `tests/privileges.test.ts` |
| `authenticated` holds no `TRUNCATE`, `REFERENCES` or `TRIGGER` | `tests/privileges.test.ts` |
| Every table keeps RLS; every `app` function pins an empty `search_path` | `tests/privileges.test.ts`, migration `0007` |
| Activity is append-only for everyone, at the privilege layer | `tests/privileges.test.ts`, `tests/activity-intelligence.test.ts` |
| An investor never receives a storage path or a public URL | `tests/document-delivery.test.ts` |
| `document_downloaded` follows a delivery, never an attempt | `tests/document-delivery.test.ts` |
| No invitation token in a log, a redirect, a link or a form field | `tests/invite-hardening.test.ts` |
| A transaction is never replayed; a statement is never re-sent | `tests/connection-resilience.test.ts` |
| No required variable has a default; no local-harness fallback exists | `tests/environment-errors.test.ts` |
| No server-only module reaches the client bundle, at any import depth | `tests/environment-errors.test.ts` |
| No error boundary renders `error.message` | `tests/environment-errors.test.ts` |
| Nothing assumes a six-digit OTP | `tests/environment-errors.test.ts` |
| No page scrolls sideways; focus is visible; every input has a name | `e2e/` |

---

## Verification

| Gate | Result |
| --- | --- |
| Reset + migrate | 3 consecutive runs, 7 migrations |
| Test suite | 264 / 264, 16 files |
| Typecheck, lint, production build | Clean |
| Secure upload / download | 28 / 28, real objects and signed URLs |
| Privilege audit | Clean on all four queries |
| Playwright UAT | 96 / 96 at 1440×900, 834×1112, 390×844 |
| Secrets audit | No secret, connection string or demo credential in `.next/static` |
| **SMTP** | **Outstanding — external blocker** |

SMTP is the one thing not certified. Until a real OTP email is received end to
end, the portal cannot admit a new investor. Section 2 of
[`docs/17-operations-runbook.md`](17-operations-runbook.md) has the procedure.
