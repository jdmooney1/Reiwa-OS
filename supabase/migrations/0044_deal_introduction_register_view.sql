-- ============================================================================
-- 0044 — deal_introduction_register: prospect introductions, as a view
-- ----------------------------------------------------------------------------
-- Per the approved revision to docs/24 §G: a view, not a new table. The
-- prospect-link surface (deal_shares/deal_share_views, 0029) is already
-- immutable by construction — deal_shares permits no update but `revoked_at`,
-- deal_share_views is insert-only and select-only for admins — and doc 20
-- enforces, with its own boundary test, that this surface shares NO code path
-- with anything investor_*. Adding a new table here would mean either minting
-- a fake investor_organizations row per prospect (exactly what doc 20 exists
-- to avoid) or crossing a boundary that is currently tested shut.
--
-- Mandated investors keep their own register: deal_investor.first_introduced_at
-- (0038). This view covers the OTHER population — prospects — and the two are
-- only ever unioned at the reporting layer later (Session 4+), never at the
-- schema/FK level.
--
-- "What was shown": a share's teaser_memo_id is the ANONYMISED teaser;
-- snapshot_memo_id is the NAMED snapshot (it carries the real address — docs/20
-- "The Snapshot carries the property address"). Exposed as two booleans so a
-- reader of this view never has to know that distinction lives in column
-- naming on deal_shares.
--
-- Views in Postgres are expanded against the INVOKER's row-level security by
-- default (not the definer's) — so this view inherits deal_shares'/
-- deal_share_views' existing admin-only policies with no RLS of its own to
-- write or get wrong. The grant below only governs who may query the view at
-- all; the underlying policies still decide what rows come back.
-- ============================================================================

create or replace view deal_introduction_register as
select
  ds.opportunity_id,
  ds.share_id,
  ds.prospect_name,
  ds.prospect_email,
  ds.created_at as link_created_at,
  (select min(dsv.viewed_at) from deal_share_views dsv where dsv.share_id = ds.share_id) as first_viewed_at,
  (ds.teaser_memo_id is not null)   as shown_anonymised_teaser,
  (ds.snapshot_memo_id is not null) as shown_named_snapshot,
  ds.revoked_at,
  ds.expires_at
from deal_shares ds;

comment on view deal_introduction_register is
  'Prospect-side introduction register (docs/24 §G): link creation + first view, derived from deal_shares/deal_share_views. For mandated investors, use deal_investor.first_introduced_at instead — never this view, and never unioned with it except at the reporting layer.';

revoke all on deal_introduction_register from anon, public;
grant select on deal_introduction_register to authenticated;

-- ROLLBACK:
--   drop view if exists deal_introduction_register;
