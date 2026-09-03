# 10 · Persistence Gate — live backend, auth, lifecycle

> **Superseded in part by [11 · P0 — Supabase runtime](11-supabase-p0.md).** The
> lifecycle model below still stands; the runtime does not. PGlite and the custom
> JWT/scrypt authentication described here were replaced by hosted Supabase
> PostgreSQL and Supabase Auth.

This phase converted Reiwa OS from a mock prototype into a **functioning persistent,
authenticated, multi-tenant application** and validated the full lifecycle end to end.

## Architecture decision — Property vs Asset

Adopted the **property-centric** model. `property` is the persistent physical identity;
lifecycle entities reference it:

```
property → opportunity → investment_case (approved = immutable) → transaction (immutable)
        → asset → business_plan (v1 underwriting immutable + forecasts) → performance_period (append-only)
```

An opportunity is not an owned asset; the same property may recur in the pipeline. This
answers, permanently and without overwriting history: *what did we believe at
acquisition* (approved case + underwriting plan), *what was our forecast at date X*
(plan version), *what actually happened* (performance periods).

## What is actually operational (not just designed)

| Capability | Status | Proof |
| --- | --- | --- |
| Real Postgres persistence | **Live** | PGlite (embedded, file-backed); same migrations run on Supabase |
| Migrations (idempotent, ordered) | **Live** | `supabase/migrations/0001–0004`, runner in `db/client.ts` |
| Authentication (email/password, signed cookie) | **Live** | `lib/auth/*`, sign-in page, guarded `(app)` layout |
| Org isolation via DB RLS | **Live** | `authenticated` role + `app.*` GUC helpers; 3 isolation tests |
| Roles: reiwa_admin / org_user / investor_viewer | **Live** | RLS `has_org` + `can_write`; permission tests |
| Opportunity CRUD + stage + archive | **Live** | `data/opportunities.ts`, actions, pipeline UI |
| Opportunity → Asset conversion | **Live** | `data/conversion.ts`; underwriting carried + immutable |
| Asset Intelligence persistence (asset/plans/periods/risks/decisions/valuations) | **Live** | `data/assets.ts`, DB-backed overview + performance panel |
| Portfolio aggregation from stored assets | **Live** | `data/portfolio.ts`; explicit labelled FX (`fx_rates`) |
| Clerk / hosted Supabase | **Designed, not connected** | superseded by working self-contained auth; migrations are Supabase-ready |
| Phase-2 modules (leasing/capex/financing/etc.) | **Planned** | tab shells present; not built this gate |

## Automated tests (12, all passing) — `npm test`

- **isolation.test** — Meiji cannot read Aoyama (even by direct id); admin sees all; reverse.
- **lifecycle.test** — opportunity persistence; conversion + underwriting carry-forward;
  underwriting/case/transaction immutability; forecast-vs-underwriting variance;
  portfolio total changes when an asset metric changes.
- **permissions.test** — investor_viewer write blocked; cross-org write blocked; own-org allowed.
- **persistence.test** — records survive a simulated server restart (close + reopen the
  file-backed DB); seed does not duplicate.

Verification run: `tsc --noEmit` clean · `next lint` clean · `vitest` 12/12 · `next build` succeeds.

## Demo accounts (password `reiwa2026`)

| Email | Role | Access |
| --- | --- | --- |
| admin@reiwa.com | Reiwa Admin | all organisations |
| analyst@meiji.com | Organisation User | Meiji Shipping (read/write) |
| viewer@meiji.com | Investor Viewer | Meiji Shipping (read-only) |
| user@aoyama.com | Organisation User | Aoyama Holdings (isolation fixture) |

## Manual end-to-end test — 20 Example Street

1. `npm run dev`, open the app → redirected to **/sign-in**. Sign in as `analyst@meiji.com` / `reiwa2026`.
2. **Pipeline → New Opportunity**: name "20 Example Street", London, office, GBP, target price 30,000,000, target IRR 15. Create.
3. Land on the opportunity. **Refresh the browser** — it persists.
4. Edit a field (e.g. target price) and Save — reload to confirm.
5. Advance stages: New → Screening → Underwriting → IC → **Approved**.
6. Click **Convert to Asset** → redirected to the new asset (lifecycle_stage Operating).
7. Confirm the **Overview** three-way shows the underwriting baseline (carried from the approved case).
8. **Performance tab → Record Performance Period** (e.g. Q3 2026, NOI 1,600,000, occupancy 90, valuation 34,000,000). Variance vs underwriting recalculates.
9. **Portfolio** → the new asset is aggregated into the totals (GBP, labelled demo FX).
10. **Sign out**, sign back in → all records remain. Data also survives a server restart (`npm run start`).

Isolation check: sign in as `user@aoyama.com` → only Roppongi Tower is visible; none of Meiji's data appears.

## Technical debt remaining

- Clerk and hosted Supabase are designed-but-not-connected; the auth boundary and
  migrations are structured for a drop-in swap (point `DATABASE_URL`/Supabase at the
  same SQL; move RLS helpers to read `auth.jwt()`).
- Existing deal tables (`deals`, DD/score/memo/documents) remain mock and are not
  org-scoped; `/deals/[id]` is a legacy analytics showcase, not wired to the DB.
- FX uses labelled demo static rates (`fx_rates`) — replace with a live feed.
- Portfolio bulk assembly is per-asset queries (fine at demo scale; batch later).
