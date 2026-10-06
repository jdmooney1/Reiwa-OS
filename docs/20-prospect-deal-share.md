# 20 · Prospect deal shares

A **third surface**, beside the internal `(app)` shell and the investor `(portal)` shell. It lets
Reiwa show a prospect who has **not** signed a mandate two already-finalised documents for one
opportunity (the Asset Snapshot and the Investor Teaser) through one emailed link: named to one
person, expiring, revocable. No account, no password, no portal shell.

> **Do not use it on a real prospect until counsel has confirmed whether and how it may be used**
> (UK financial promotions, Japan FIEA solicitation rules). This is built; that is a separate gate.
> The on-screen disclaimer wording (`PROSPECT_DISCLAIMER`, `src/lib/deal-share/policy.ts`) is a
> placeholder for counsel's text, in one constant.

## Why a third surface

The investor portal assumes every viewer is an admin-provisioned `investor_contacts` row under an
active mandate; "an unknown address never even reaches Supabase" (doc 14). A prospect has a lower
trust level and a narrower allowance. Forcing them through the portal would mean weakening that
model, or onboarding prospects as fake investors and polluting the real mandate data. So: a
separate route group, separate tables, and **no shared code path with anything `investor_*`**. A
test (`tests/unit/deal-share-boundaries.test.ts`) fails if either side starts mentioning the other.

## Data (migration `0029_deal_shares.sql`)

| Table | Holds |
| --- | --- |
| `deal_shares` | One row per link: opportunity, the final memo each document is read from, prospect name and email, `token_hash` (SHA-256 hex, unique), `expires_at`, `revoked_at`, creator. Only the hash is stored. |
| `deal_share_views` | One row per successful open: `share_id`, `viewed_at`. No IP, no user agent, no location: the prospect is already named on the share. |

- **A memo is a version, not a format.** The Snapshot and the Teaser are two renderings of one
  memo's content, so `snapshot_memo_id` and `teaser_memo_id` may point at the same final version
  or at different ones. At least one is required (CHECK).
- **RLS:** admin only (`app.is_admin()`). No prospect-facing policy exists; the token lookup runs
  on the privileged server connection, like OTP sign-in support. No new function in schema `app`.
- **Narrower than `investor_invites`, on purpose.** An admin can insert, read and revoke. The only
  updatable column is `revoked_at` (column-level grant), so a link cannot be extended, re-pointed
  or re-addressed after it was sent: revoke it and issue another. There is no delete. The views
  table is `select` only for admins; rows are written by the server and cannot be edited.
- Opportunity and memo references do not cascade. (A final memo cannot be deleted anyway.)

## The access route

`GET /deal/<token>` (`src/app/(prospect)/deal/[token]/page.tsx`), no session of any kind.

1. The token is hashed and matched, then compared again with `timingSafeEqual` against the stored
   hash (the shape of `authorizeCron`), and every doubt fails closed.
2. In one statement: not revoked, not expired, and each named memo still exists, still belongs to
   the share's opportunity, and is still `final`.
3. A valid open records one `deal_share_views` row (only if the share is still live at that
   instant, so a racing revocation leaves no view), then renders.
4. **Any** failure (wrong, malformed, expired, revoked, memo no longer final, even a database
   fault) is the same `notFound()`. The 404 page says nothing about which. Verified over HTTP:
   the bodies are identical once the echoed request path is masked.

It renders the **stored** content only: no recomposition, and it reads no live table. What reaches
the screen is cut down first (`src/lib/deal-share/document.ts`): the Snapshot's grid and the
Teaser's seven sections, never the other ten sections, the minute or the score.

**Pictures.** `/deal/<token>/image/<photo|map>` redirects (303) to a 60-second signed URL for the
copy frozen at finalisation, under the same token check and the same bare 404. A Snapshot
finalised *before* pictures were frozen (migration 0028 / PR #23) still holds live references; a
prospect is shown it **without** its photograph and map rather than reaching `property_photos`.

**Headers**, on every response under `/deal` (set in `next.config.mjs`, repeated by the page
metadata and the picture route): `Cache-Control: private, no-store, max-age=0`,
`X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer` (plus the app-wide
`X-Frame-Options: DENY`). The title is "Reiwa Capital"; "Reiwa OS" never reaches a prospect.

**Disclaimer.** On screen, above the documents and again below them, plus the Snapshot's and the
Teaser's own footers.

## Boundary (what the tests hold)

`src/lib/data/deal-share-access.ts` is the whole boundary, because it runs without RLS:

- reads `deal_shares` and `memos` only (the memo is joined once per document);
- writes one row, into `deal_share_views`; updates and deletes nothing;
- imports from an allow-list; no session, cookies or request headers anywhere in the surface;
- no `console.*`, and no `reportError` / `runAction` context ever mentions a token.

## Admin

- **Share with a prospect**: from the Memo tab (admins, once a memo exists) or **Prospect Links**
  in the sidebar. Form: name, email, lifetime (default 14 days, 1 to 90), and per document a
  checkbox plus the final version to read from (disabled when no final memo supports it).
- The full link is shown **once**, with a copy button and a plain warning. Staff send it
  themselves; nothing is emailed from here.
- **Prospect Links** (`/admin/deal-shares`): prospect, opportunity, documents and versions,
  active / expired / revoked, created, expires, last viewed, view count, and **Revoke**
  (immediate; it stops the next request and undoes nothing already seen).
- Creation is refused unless every named memo belongs to the opportunity and is final, and a
  Snapshot needs a version that carries one: "Finalise the memo first".

## Know the limits

- **The link is a bearer credential.** The name on the share is a label, not a check: whoever
  holds the link sees the documents. Forwarding is not prevented.
- **A view means "opened", not "read".** Mail scanners and link previews can open it.
- **The token is in the URL path**, so it appears in hosting request logs (the investor
  `/access/<token>` link has the same property). The application never logs it.
- **The Snapshot carries the property address and, if uploaded, the map.** The investor portal
  withholds location by document access level; this surface does not. Decide that with counsel.
- **Finalised content is shown as finalised**, including a source note such as "working version,
  not yet approved" and an FX staleness note, and "No data recorded" boxes for empty Teaser
  sections. Finalise only what you would send.

## Configuration

`DEAL_SHARE_URL` (see doc 17). Apply `0029` before deploying the code that uses it.
