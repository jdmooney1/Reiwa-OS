# 14 · P3 — Investor access & authentication

The secure access layer in front of the Investment Portal:

```
invitation link → confirm email (masked) → request OTP → verify → investor session → /portal
```

Built on the frozen P0/P1/P2 baseline. One new table (`investor_invites`,
migration `0006`), no change to any existing migration, policy, helper or the
P1 EXECUTE matrix (no new function exists in schema `app`).

## Identity model

Two kinds, never blended, resolved in `src/lib/auth/portal-session.ts`:

| | internal | investor |
| --- | --- | --- |
| Anchor | `profiles` row | active `investor_contacts.auth_user_id` of an active org |
| Sign-in | email + password (unchanged) | email OTP only — the Auth user is created **without a password** |
| Surface | Reiwa OS `(app)` shell | `(portal)` shell only |

Resolution order is deliberate: the internal identity wins, so a staff member
whose email overlaps an investor contact is never treated as an investor, and
`completeInvestorVerification` refuses to mint an investor session for a staff
Auth user outright. An investor has no `profiles` row, so `requireAuth()` (and
therefore `/admin`, `/pipeline`, opportunities, assets, portfolio) turns them
away with no new code — the P0 denial is structural.

Redirects: internal → internal app · investor → `/portal` · unauthenticated
internal route → `/sign-in` · unauthenticated portal route → `/portal/verify` ·
staff visiting `/portal` or `/portal/verify` → `/portfolio`.

## No self-registration

`signInWithOtp` always runs with `shouldCreateUser: false`, and it is only ever
called after a server-side guard (`authoriseOtpEmail`) has confirmed the email
belongs to an **active, provisioned contact of an active organisation** — an
unknown address never even reaches Supabase, and the public form answers
identically either way, so addresses cannot be enumerated. Investor Auth users
come from exactly one place: the admin's *Provision sign-in* action
(`provisionInvestorAuthUser`, Admin API, server-only).

## Invitations (`investor_invites`, migration 0006)

- Belong to a contact; **only the SHA-256 hash of the token is stored** — the
  raw token exists in the admin's browser at creation time and in the link.
- 14-day expiry, server-enforced; revocation immediate; minting a new
  invitation revokes the previous active one, so one link is live per contact.
- Accepted exactly once, and only when the invitation's contact is the very
  contact the OTP just verified; a spent link offers direct sign-in instead.
- **An invitation grants nothing**: no policy, helper or claim reads the table
  (investors cannot even see their own rows — there is no investor policy on
  it). It only identifies the intended access context; access always requires
  the OTP, and what the investor then sees is still derived from `auth.uid()`
  by the P1 helpers. `investorSessionClaims()` remains `{sub, role,
  app_metadata: {}}` — no org id, entitlement or tier is ever asserted.
- RLS enabled, admin-only policy, `anon`/`PUBLIC` revoked, explicit grants —
  the same posture as 0005, pinned by the existing privileges tests (the table
  matches their `investor%` sweep).
- Unauthenticated token validation and acceptance run on the privileged
  connection, exactly as P0 session assembly does — sign-in support, keyed only
  by the token hash.

## Routes

| Route | Purpose |
| --- | --- |
| `/access/[token]` | branded landing: validates hash/expiry/revocation/status server-side, shows the **masked** authorised email, requests the OTP (email resolved from the token, never from the client) |
| `/portal/verify` | code entry; also the direct sign-in path for already-authorised contacts |
| `/portal` | minimal holding page: access + identity confirmation and sign-out only — **no P4 content** |

No Supabase callback route exists because none is needed: the flow uses
6-digit codes via `verifyOtp`, not magic links.

## Admin integration (P2 contact card, extended)

Per contact: provisioning state badge → *Provision sign-in* → invitation
controls (create / regenerate / revoke, state and expiry badges). The raw link
is displayed once with a copy field and cannot be recovered later. Deactivating
a contact (P2) ends portal access on the investor's next request; suspending
the organisation does the same for all its contacts.

## Tests — `tests/investor-access.test.ts` (23)

Cover the 15 required behaviours: closed self-registration (guard **and**
Supabase-level refusal, with proof no Auth user was created); OTP request and
verification resolving to the exact contact; claims carrying no org/entitlement
data with authorisation still derived from `auth.uid()`; portal identity
resolution; denial of `/admin` and all internal surfaces; unchanged staff
password sign-in; expired/revoked/garbage tokens; hash-only storage;
deactivated contact and suspended organisation rejected at every gate;
one-shot acceptance; and an accepted invitation granting no publication
access. Plus: invitations invisible to internal org users and investors, and
regeneration revoking the predecessor. All P0/P1/P2 suites unchanged and green.

## Outstanding against hosted Supabase (record for the live environment)

The cloud session cannot reach the real `reiwa-dev` pooler, so — as with P2 —
the full gate ran against the local Supabase-equivalent harness (the OTP
endpoints of `scripts/local-auth.ts` mirror GoTrue's `/otp` + `/verify`
semantics, including `create_user=false` refusal). To confirm live:

1. `npm run db:reset -- --yes` (applies `0006`), `npm test`, build gates.
2. Supabase project settings: enable the **Email OTP** sign-in (email provider
   with OTP), set OTP length 6 and a sensible expiry, and confirm the email
   template delivers codes; no other dashboard change is required.
3. Walk invitation → OTP → `/portal` against real email delivery.
4. Rate limiting of OTP requests is delegated to Supabase Auth's built-in
   limits; review them for production.

## Not in this phase

P4 portal experience (opportunity cards, saved, compare, dashboard), storage
wiring, engagement analytics.
