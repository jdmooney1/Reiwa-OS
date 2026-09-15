# 04 · RLS Policy Approach & TypeScript Types

Companion to [`../supabase/migrations/`](../supabase/migrations/) and
[`../src/types/database.ts`](../src/types/database.ts).

> **Status.** Rewritten in Phase 0. The original described Clerk as the JWT
> provider and an MVP posture of `for all to authenticated using (true)` across
> eight tables. Neither is what was built: authentication is **Supabase Auth**,
> and the policies are **claim-scoped from the first migration** — there was
> never an allow-all phase to tighten later. The `Database` interface this
> document used to describe typed tables that never existed and has been removed.

---

## 1. Row Level Security

### Posture

Deny by default, everywhere, from migration `0001`. Every table has RLS enabled
and explicit policies; a table with no matching policy returns nothing. The
`anon` role is revoked on every table, so a leaked publishable key reads nothing
at all rather than "whatever the policies happen to allow".

This is deliberately stronger than the trusted-small-team argument would require.
The application serves two populations from one database — Reiwa staff and
external investors — and the investor side is the one where a mistake is not
recoverable by apology.

### Claims and helpers

Signed-in requests carry a Supabase Auth JWT. Policies never read a table to
decide access; they read claims through `stable` helpers in the `app`
schema, each with `set search_path = ''`:

| Helper | Returns |
| --- | --- |
| `app.current_user_id()` | `auth.jwt() ->> 'sub'` |
| `app.current_global_role()` | `app_metadata.global_role`, defaulting to `anon` |
| `app.is_admin()` | `current_global_role() = 'reiwa_admin'` |
| `app.can_write()` | `app_metadata.can_write = 'true'` |
| `app.current_org_ids()` | `app_metadata.org_ids` as `uuid[]` |
| `app.has_org(target)` | `is_admin() or target = any (current_org_ids())` |

Reading membership from claims rather than from `organization_members` keeps the
policies non-recursive and cheap: no policy triggers a query that is itself
subject to a policy.

### The internal pattern

Every tenant-scoped table (`portfolios`, `properties`, `opportunities`,
`investment_cases`, `transactions`, `assets`, `business_plans`,
`performance_periods`, `valuations`, `asset_risks`, `asset_decisions`) carries a
denormalised `org_id` and gets the same four policies:

```sql
create policy <t>_select on <t> for select to authenticated
  using (app.has_org(org_id));
create policy <t>_insert on <t> for insert to authenticated
  with check (app.has_org(org_id) and app.can_write());
-- update and delete: the same predicate on both USING and WITH CHECK
```

Read and write are separated: a `viewer` sees the organisation's data and cannot
change it. `WITH CHECK` mirrors `USING` on update so a row cannot be moved out of
the caller's own organisation.

### Immutability is a trigger, not a policy

RLS decides *who* may write. It cannot express "this row may never change again".
Three guards do that:

- `app.block_if_approved_case` — an approved `investment_case` cannot be updated
  or deleted; only the `draft → approved` transition is permitted.
- `app.block_transaction_change` — `transactions` are immutable, full stop.
- `app.block_underwriting_plan` — the `underwriting` business plan cannot change.

Together these make original underwriting reconstructable, which every variance
figure in the product depends on.

### The investor boundary

Investors are a different population with a different rule, not a narrower
version of the staff rule:

- `publication_sources` — the publication → opportunity mapping — is
  **admin-only** and projected by no investor-readable view. An investor cannot
  learn which internal opportunity a publication corresponds to, or that two
  publications share a property.
- Investor visibility runs through `publication_entitlements`, per investor
  organisation, per publication.
- `investor_invites` stores only `token_hash` (SHA-256). The raw token exists in
  the emailed link and nowhere else — not in the database, not in logs, not in
  activity metadata.
- An invitation identifies context only. It does not authenticate: the investor
  must still request and enter an OTP, and `shouldCreateUser: false` means the
  OTP path can never create an account.

### Privilege hardening (`0007`)

Supabase's default privileges grant `anon` rights on every new table in `public`.
Migration `0007` takes them back — across tables, sequences and functions — and
sets `ALTER DEFAULT PRIVILEGES` so future objects do not reintroduce the problem.
It also revokes `TRUNCATE`, which RLS does not filter: a policy that restricts
`DELETE` row by row does nothing against `TRUNCATE`.

The migration asserts its own outcome and fails if the grants are not as
expected, so it is a check as well as a change.

### Storage

Documents live in a **private** bucket (`publication-documents`). Objects are
never public; the server mints short-lived signed URLs on demand, after checking
the caller's entitlement. See [`08-document-vault.md`](08-document-vault.md).

---

## 2. TypeScript types

Types are **hand-written per layer**, mapped to the real schema. There is no
generated `Database` interface.

| Module | Covers |
| --- | --- |
| `src/types/database.ts` | Shared vocabulary: `Currency`, `Market`, `AssetType`, `Strategy`, `Recommendation`, the DD framework types (`DdSection`, `DdJurisdiction`, `DdStatus`, `PriorityLevel`, `RiskLevel`, `RiskStatus`), `DocCategory`, and `DueDiligenceItem`. |
| `src/lib/asset-intelligence/types.ts` | The post-acquisition model: `Asset`, `BusinessPlan`, `PerformancePeriod`, `Valuation`, `AssetRisk`, `AssetDecision`, and the `AssetFile` composite. |
| `src/lib/data/opportunity-types.ts` | `OppStage`, `OppStatus` and the opportunity row shape. |
| `src/lib/domain.ts` | Labels and tones for those enums, UI-agnostic. |

### What Phase 0 removed, and why it matters

`src/types/database.ts` previously declared a `Database` interface mapping tables
named `deals`, `deal_metrics`, `due_diligence_items`, `risks`, `contacts`,
`documents`, `document_extractions`, `investment_scores`,
`investment_score_categories` and `decision_log`, plus row interfaces for each
and a `DealFile` composite.

**None of those tables exists in any migration.** The types were written against
a schema that was only ever served from `src/lib/mock-data.ts`. A typed model of
an imaginary database is worse than no types: it type-checks, it reads like a
contract, and it silently licenses a screen to present figures no system of
record can vouch for. The file is now 93 lines and every type in it corresponds
to something real.

`AssetFile` was trimmed for the same reason — it declared `leases`, `capex`,
`developments`, `milestones`, `loans`, `advisers`, `actions` and `events`, none
of which has a table. See [`09-asset-intelligence.md`](09-asset-intelligence.md).

### Rule

A type in this codebase describes either a row that exists or a value computed
from rows that exist. Anything else belongs in a design document, not in
`src/types`.
