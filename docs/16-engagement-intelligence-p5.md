# P5 — Investor Engagement & Commercial Intelligence

Turns the P1 activity record into something Reiwa can act on, and stops there.

It answers five questions: who is actively reviewing, what is receiving
attention, what each investor has actually done, who asked for information or
diligence access, and what needs following up.

**No migration was added.** `investor_activity_events` and `investor_requests`
already carried everything, and the `*_admin` policies from `0005` already gave
Reiwa administrators the read. No P0–P4 policy, function or guard changed.

## The line this layer does not cross

`src/lib/data/admin-activity.ts` returns one of three things and nothing else:
an event that was recorded, a **count** of those events, or the **most recent
timestamp** among them.

There is no engagement score, lead score, ranking, suitability inference or
propensity model. There is no session duration — the record holds instants, and
one instant is never subtracted from another to invent "time spent". A quiet
investor is not "0% engaged": they are simply absent from the list.

Two things follow from that, and both are tested:

- **The record is an audit trail.** No statement anywhere in `src/` updates or
  deletes an `investor_activity_events` row — a test walks the tree and asserts
  it. Investors have `select` and `insert` policies only, so their `UPDATE` and
  `DELETE` match no policy and change nothing.
- **Nothing sensitive is captured.** No IP address, user agent, device or
  browser fingerprint, in the `context` payload or as a column. Asserted both
  ways, including against `information_schema`.

## Where it appears

| Surface | What it adds |
| --- | --- |
| `/admin/activity` | The filterable record: investor, contact, opportunity, action, date range, paged. Open requests sit above it. |
| `/admin/investors/[investorOrgId]` | Requests & follow-up, last portal sign-in, counts by action, per-contact breakdown, opportunities opened, event record. |
| `/admin/publications/[publicationId]` | Which entitled organisations opened, saved, compared and requested — internal only — plus requests on that opportunity. |
| `/admin` | Three signals: open requests, investors active recently, opportunities receiving attention. Not a dashboard. |

Filters live in the URL, so a filtered view can be linked to and the page stays
a server render.

## Decisions worth recording

**`login` is now emitted.** P4 emitted five events but not `login`, so "last
portal sign-in" had nothing to show. It is recorded once per verified OTP
sign-in in `verifyOtpAction` — not per page view — so the figure means exactly
what it says.

**`document_viewed` / `document_downloaded` are still unemitted.** Secure
document delivery does not exist yet (P4), so there is no view or download to
record. Recording one when nothing was delivered would be a meaningless
technical event. The event types remain in the P1 vocabulary, ready.

**Comparison events carry no `publication_id`.** A comparison is recorded once,
with the set of ids in `context`, so it is not attributed to any single
opportunity — a publication's activity shows only what was recorded *against
it*. The admin feed reads the recorded set length to show "3 opportunities".

**Activity sections were added to the pages, not to the P2 components.** The
investor and publication detail views are large P2 client components; the P5
sections are server-rendered blocks composed beneath them, so no P2 behaviour
was touched.

**Triage is admin-only.** `investor_requests` has no investor `update` policy,
so an investor cannot re-open, re-classify or close a request after submitting
it. Verified against a live investor session.

## Who can read it

Internal, and narrowly so. `/admin` requires `reiwa_admin` (`requireAdminAuth`
— a 404 for other staff, verified), and beneath the application gate the
`*_admin` policies require `app.is_admin()`, so an ordinary internal org user
reads nothing at all.

An investor calling these functions with their own session is not a leak but is
worth stating precisely: RLS narrows every query to **their own rows**. They
gain no organisation-wide view — a colleague's sign-in is invisible to them,
another organisation's activity returns nothing, and the organisation summary
collapses to just themselves. That is exactly what `investor_activity_own_select`
already permitted; P5 adds no reach.

## Tests

`tests/activity-intelligence.test.ts` — 21 tests on a self-contained fixture,
covering the fifteen required cases: permitted self-emission, forgery of a
colleague's / another organisation's / a mismatched-organisation event,
append-only enforcement, deactivated contacts and suspended organisations
halting recording, view/save/unsave/compare/request accuracy, every filter
dimension, both aggregations, open-request surfacing and status persistence —
plus the audit-trail source scan and the no-fingerprinting assertions.

## An observation for P6, not changed here

The uniform `*_admin` policy from P1 is `for all`, so a Reiwa administrator
*could* in principle update or delete an activity row directly in the database.
No application path does, and P5 adds none. Making the audit trail
insert-only even for admins would mean changing a P1 policy, which is out of
scope here — flagging it as a P6 hardening candidate.

## Not in P5

Engagement dashboards, duration tracking, scoring, suitability inference,
behavioural analytics — explicitly excluded. Secure document delivery and the
P3 real-email/custom-SMTP item both remain **mandatory pre-UAT**.
