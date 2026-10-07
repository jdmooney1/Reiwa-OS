# 25 - Every publication document owns its file

Migration `0034`, plus a copy-on-draft change in the data layer.

## The defect
`startDraftFromVersion` copied document **rows** but kept the source's `storage_path`, so a draft and
the live version pointed at one file. Removing the document from the draft deleted the file by path,
and the live version's download then failed (the portal answers 404 for any document it cannot sign),
with nothing visible to the person who did it.

## The fix, and why this one
**Each version owns independent copies of its files.** Starting a draft copies every document file,
server-side inside the bucket, to a new path under the draft's own version folder, and the draft's
rows point at the copies. A published version is a frozen snapshot; one that shares a mutable file
with a draft is not frozen. The cost is paid once, at draft creation, in storage (a few documents per
draft), and there is no ongoing invariant for later code to remember.

Reference-counting before every delete was the alternative. It avoids duplicate storage but makes
every future code path that touches documents responsible for the count. It is kept only as a
**second line of defence** (below), not as the design.

Enforcement, so the rule does not rest on remembering it:
- **Database:** unique index on `publication_documents.storage_path` (0034). A path-sharing insert
  fails at the insert.
- **Delete path:** `removePublicationDocument` returns a path for deletion only when no other
  `publication_documents` or `opportunity_documents` row references it. Anything else leaves the file
  in place: an unowned file costs kilobytes, a deleted live file costs an investor their download.
- **Failure handling:** copies run inside the draft's transaction. If one fails, the draft rolls back
  and the copies already made are deleted; the same cleanup runs if the commit fails.
- **A source file that is already missing** (damaged by the old bug) does not block a new draft: the
  draft starts without that document and a banner names it, so it can be re-uploaded. Blocking would
  deadlock, because a published version's documents cannot be edited.

## Existing data
A migration cannot copy storage objects, so the unique index is created by 0034 only when no rows
already share a path; otherwise it is skipped with a NOTICE and nothing changes. Two scripts handle
what is already there (run them against each real database after deploying this):

```
npm run db:audit-documents                   # read-only: shared files, and documents whose file is missing
npm run db:unshare-documents                 # dry run
npm run db:unshare-documents -- --apply      # copy files, re-point rows, create the unique index
```

Repair rule: the row on the oldest version keeps the original path; every other row gets its own copy.
Rows of published or superseded versions are immutable by trigger, so the one trigger is switched off
for the length of one transaction to change their path (the path is where a file lives, not part of what
was published), and is verified enabled afterwards. A shared row whose file is already missing cannot
be repaired and is reported, not guessed at.

## Audit of other delete-by-path code
- `deleteDocumentObject` has three callers: the two failed-insert cleanups (the admin upload and the
  opportunity-document upload), which delete only a path they generated a moment earlier, and the
  row-then-file remover above. A unit test fails if a new caller appears.
- Photographs (`deletePhotoObject`): exclusive by a unique index on `property_photos.object_path`
  (0019), and a memo's frozen pictures are copies, not references. Safe.
- Opportunity documents: one row per file, no delete path today.
- Not changed, noted: deleting an opportunity or a draft version by cascade leaves its files in the
  bucket (a leak, not a loss). "Refresh from source" (`startDraftFromSource`) makes a draft with no
  documents at all, so publishing it would drop the live documents from the investor view; the review
  screen shows that as removals, but it is probably not what a person expects.
