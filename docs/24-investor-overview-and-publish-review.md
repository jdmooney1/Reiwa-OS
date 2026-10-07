# 24 - The investor Overview, and the publish review

Two changes that belong together: stop internal thesis text reaching an investor-facing
record, and put a real pause in front of "publish". Migration `0033`.

## 1. The Overview is its own field

### What was wrong
`app.opportunity_publication_source()` (0005) copied `opportunities.summary` straight into the
investor Overview of every new draft. `summary` is the internal thesis an associate types at
intake. A note marked do-not-disclose reached a publication draft with no friction.

### What it does now
- New nullable column `opportunities.investor_overview`, written for investors and nowhere else.
- The boundary function reads that column and **not** `summary`. When it is NULL the key is
  omitted (`jsonb_strip_nulls`), so a new draft starts with a **blank** Overview. There is no
  fallback to `summary`, in SQL or in the app.
- Written on the opportunity's **Publication** tab (admin only): "Investor overview". The internal
  summary is shown beside it, read-only, with a button that copies it into the box. Copying is a
  deliberate action and is not saved until the person presses Save as a second, separate action.
- A change to the overview applies to the **next** draft. It does not alter an existing draft or
  the live version (a publication is a snapshot).
- A blank string is not an overview: a CHECK refuses it, so NULL is the single "not written" value.
  The admin action normalises empty text to NULL.

### Existing data
- `investor_overview` is NULL everywhere after the migration. Nothing is back-filled, because a
  script cannot tell the part of a summary an investor may read from the part they must not.
- Draft and published versions that already hold copied text are not touched (a published version
  is immutable; a draft is someone's work). To find them, run this read-only query in Supabase:

```sql
-- Versions whose Overview is, or contains, the opportunity's internal summary.
select v.version_id, v.version_number, v.status, v.title,
       left(v.overview, 80) as overview_starts
  from publication_versions v
  join publication_sources ps on ps.publication_id = v.publication_id
  join opportunities o on o.opportunity_id = ps.opportunity_id
 where o.summary is not null
   and v.overview is not null
   and (lower(btrim(v.overview)) = lower(btrim(o.summary))
        or (length(o.summary) >= 40 and position(lower(btrim(o.summary)) in lower(v.overview)) > 0))
 order by v.status, v.title;
```

  Anything listed with status `published` needs a human decision: read it, and if it should not be
  there, start a new draft, write the Overview, and publish through the review screen.

### Drift warnings are re-based, not hidden
The "internal record has changed" warning compares a fingerprint with the boundary function's
output. Changing the function would have flagged every publication. The migration recomputes the
stored fingerprint only for versions that were **in step** before it ran; versions that had already
drifted keep their old fingerprint and keep reporting drift. (Checked on an upgraded database with
one in-step and one drifted publication, both carrying summary text.)

## 2. Publishing has a review screen

### What was wrong
"Submit for review" then "Publish" were two clicks by the same person with no dialog and no view of
what was changing. "Revoke" and document delete had no confirmation at all.

### What it does now
- "Publish" no longer publishes. In the header and in the Versions tab it is **"Review and
  publish"**, which opens `/admin/publications/[id]/publish/[versionId]`.
- That screen shows: who will see the version the moment it goes live (organisation and document
  tier); what is changing against the live version, field by field with before and after (text,
  figures at stored precision, highlights) and documents added, removed or re-tiered; and warnings
  (Overview blank; Overview is, or contains, the internal summary; nobody can see it yet).
- To publish, the person types a sentence built from what the screen shows, for example
  `publish v2 with 5 changes to 3 organisations`. If the Overview matches the internal summary the
  sentence also has to say so: `... with the internal summary as the overview`. Capitals and
  spacing do not matter; the words and numbers do. Pasting into the box is switched off.
- **Enforced on the server.** `publishVersionAction` receives the typed sentence and a digest of
  what the screen showed. It recomputes both from a fresh read and refuses on any mismatch, on a
  version that is not in review, and on a request with no confirmation at all. If anything moved
  since the screen was opened (live version, documents, who is entitled) the digest no longer
  matches and the person has to read the new picture. A direct request that skips the screen is
  refused. This was tested by rewriting the real request in a browser (wrong sentence, forged
  digest, confirmation removed): each left the version in review.
- Withdraw, revoke access (both places), revoke invitation and remove document now ask first, naming
  the consequence. They use the same browser confirmation dialog as memo finalise, no stronger.
  (Document removal used to warn that a file might be shared with the live version; that fault is
  fixed, see [25](25-publication-document-ownership.md), and the warning is gone.)

### What this is not
- **Not separation of duties.** The person shown the diff and typing the sentence can be the person
  who wrote the content. Every internal user is `reiwa_admin` today, so there is no second role
  to hand the review to. A control that asked for "another approver" and resolved to the same admin
  would look like a control without being one, so none was built.
- **Not a database rule.** The gate is in the server action. `publishVersion()` in the data layer
  (used by seeding and tests) does not require it, and anyone with database access can publish.
  A unit test fails if any other application code starts calling it.
- A person can still type the sentence on autopilot. The design aims to make that require reading
  two numbers and, in the one risky case, a clause that states the problem.

### Options for real second-person review (not built)
1. **Four-eyes by author**: record who submitted for review (already stored) and refuse a publish by
   the same user, with a break-glass for the founders. Cheap, honest, but needs two admins today.
2. **Wait for the staff role** (plan item 4) and require a non-author approver of that role.
3. **Out-of-band**: email the diff to a named approver and require their reply link. More moving
   parts than 1 for the same effect.
