# 31 - Investor admin: duplicate-email errors, and deleting an investor organisation

No migration. Code only.

## 1. A duplicate contact email is now a sentence, not a blank page
- `investor_contacts_email_key` is a unique index on `lower(email)` across the whole table (0005): one address
  belongs to one contact in the portal, whichever organisation they are under. (An address is what a person signs
  in with.) A consultant who advises two investors cannot be a contact at both under one address.
- `createInvestorContactAction` and `updateInvestorContactAction` now run through `runAction`. The data layer
  (`lib/data/investor-portal`) catches `23505` on exactly that constraint and throws an `AppError` with:
  "That email address is already used by a contact (possibly on another organisation). Use a different address or
  edit the existing contact." It names no organisation, so it cannot be used to look up who holds an address.
- Caught on the refusal, not by looking first, so two admins adding the same address at once cannot both pass a check.
- The add / edit form shows it under the fields, stays open, and keeps what was typed (the fields are controlled).
- Any other database failure is still a fault and still reaches the boundary; only this one constraint is translated.

### Same bug class: the rest of `admin-portal.ts` (not changed here)
Twenty actions still throw to the staff boundary. Where a failure is one an admin can fix, the first ones to wrap are:
- organisation create / update: duplicate name (`investor_organizations_name_key`)
- assignment and placement: `assignPublicationAction`, `grantAccessAction`, `setEntitlementPlacementAction`
  (duplicate (org, publication); the single-featured partial index)
- workflow-state actions: `preparePublicationAction`, `updateDraftVersionAction`, `submitForReviewAction`,
  `returnToDraftAction`, `withdrawPublicationAction`
The rest (`setContactActiveAction`, the other entitlement edits, document update/remove) have few recoverable failures.

## 2. Deleting an investor organisation
Everything under an organisation cascades on delete (contacts, entitlements, activity, requests, saved items,
invitations), so the guard is the only protection. A real delete is allowed only for an organisation that has never
been used. **Any one** of these blocks it:

| Check | Why |
|---|---|
| a contact with a portal sign-in (`auth_user_id` set), logged in or not | a real Auth account exists and would be orphaned |
| any activity event | a login, view, download or request for information |
| any entitlement row, including hidden or revoked | revoking keeps the row; a revoked grant looks like a never-shown one |
| any investor request | |
| any accepted invitation | |
| any saved opportunity | |

Contacts nobody signed in as and unaccepted invitations do not block: they are deleted with the organisation, and the
panel says how many.

**Race-safe.** The delete locks the organisation row in one statement, then counts in the next (a statement's snapshot
is taken when it starts, so counting in the same statement as the lock would miss a row committed while it waited).
Anyone adding an entitlement or event waits on that lock and then fails its foreign key.

**UI.** A "Delete organisation" danger zone on the organisation page lists every check with its count. A used
organisation is told why and offered Set to Suspended / Closed. A never-used one needs its name typed. The server runs
the guard again on submit. The directory tags unused organisations "Never used". Admin only (the table's policy is
`app.is_admin()`).

**No audit table exists**, so a delete writes one structured line to the server log (`investor.organisation.deleted`:
id, name, who, contacts and invitations removed).

**New tables.** `tests/investor-delete.test.ts` compares the guard's table list with the foreign keys in the database.
A table added later that cascades from an organisation or contact fails that test until it is added to
`GUARD_COVERAGE` (`lib/investor/deletion-guard.ts`) as either a blocker or a safe cascade.

## Tests
`tests/investor-contact-errors.test.ts` (10), `tests/investor-delete.test.ts` (15, including two concurrency tests and
the catalog test), `tests/unit/investor-deletion-guard.test.ts` (11). Mutation-checked: removing the translation, the
guard, or reading counts before the lock each fails tests. Browser-verified against the local database.
