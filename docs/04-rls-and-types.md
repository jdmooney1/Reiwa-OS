# 04 · RLS Policy Approach & TypeScript Types

Companion to [`../supabase/schema.sql`](../supabase/schema.sql),
[`../supabase/seed.sql`](../supabase/seed.sql), and
[`../src/types/database.ts`](../src/types/database.ts).

---

## 1. Row Level Security approach

### Threat model & posture
Reiwa OS is a private internal tool for a small, fully-trusted team (Founder,
Analyst). The realistic risk is not one internal user attacking another — it is
(a) a leaked browser-side key reaching the database, and (b) future external
advisers seeing deals they shouldn't. RLS is therefore configured **deny-by-default
with an authenticated allow-all for MVP**, leaving a clean tightening path.

### How it works
1. **Clerk as the JWT provider.** Clerk is registered as a Supabase third-party
   auth provider. Signed-in requests carry a Clerk JWT; Postgres sees
   `auth.role() = 'authenticated'` and `auth.jwt() ->> 'sub'` = Clerk user id.
2. **RLS enabled on every table.** With no matching policy, access is denied — so
   the `anon` key alone can read nothing.
3. **MVP policies** grant `for all to authenticated using (true) with check (true)`
   on all eight tables. Any signed-in Reiwa user has full CRUD.
4. **Server-side privileged access.** Server Actions / webhooks use the
   `service_role` key, which bypasses RLS, for sync and admin tasks. This key
   never reaches the browser.

### Tightening path (external adviser phase)
When advisers join, do **not** loosen the model — extend it:

```sql
-- Per-deal access grants
create table deal_access (
  deal_id    uuid references deals(deal_id) on delete cascade,
  profile_id text,                     -- Clerk user id
  level      text check (level in ('read','comment','write')),
  primary key (deal_id, profile_id)
);

-- Replace `using (true)` with role- and grant-aware predicates, e.g.:
create policy deals_read on deals for select to authenticated
using (
  is_internal()                              -- founder / analyst see all
  or exists (                                -- advisers see granted deals only
    select 1 from deal_access da
    where da.deal_id = deals.deal_id
      and da.profile_id = auth.jwt() ->> 'sub'
  )
);
```

Child tables (`deal_metrics`, `risks`, …) inherit the same gate by checking their
`deal_id` against the visible-deals predicate. The IC sign-off transition
(`deal_stage = 'investment_committee' → approved`-equivalent) stays enforced in the
server-action layer, optionally backstopped by a `BEFORE UPDATE` trigger checking
the actor's role.

### Storage
The Document Vault uses a **private** Supabase Storage bucket (`deal-documents`).
Objects are never public; the server mints short-lived signed URLs on demand. A
Storage RLS policy mirrors the table model (authenticated read/write for MVP,
per-deal grants later).

---

## 2. TypeScript types

`src/types/database.ts` is the single source of truth for the app's data shapes and
mirrors the SQL exactly:

- **Enum unions** (`DealStage`, `AssetType`, `DdCategory`, …) match the Postgres
  enums one-to-one, so invalid values are caught at compile time.
- **Row interfaces** (`Deal`, `DealMetrics`, `DueDiligenceItem`, …) map column →
  field with `| null` where the column is nullable. Money/percent are `number`.
- **`Database`** is a Supabase-generated-style interface (`Row`/`Insert`/`Update`
  per table) for typing the Supabase client. It can be regenerated later with
  `supabase gen types typescript` without changing the consuming code.
- **`DealFile`** is a composite view type (deal + metrics + DD + risks + contacts +
  documents + score + decisions) — the exact shape the Deal Detail page consumes.

This keeps queries, server actions, mock data, and UI all speaking one vocabulary.
