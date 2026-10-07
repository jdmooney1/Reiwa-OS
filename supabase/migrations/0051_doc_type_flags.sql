-- ============================================================================
-- 0051 — doc_type_applies: real flags, not '{}', and a real platform setting
-- ----------------------------------------------------------------------------
-- FOUND BY REVIEW, not live testing this time: app.doc_type_applies was
-- always called from app.ensure_deal_documents_for_investor (0047) with the
-- flags argument hardcoded to '{}'::jsonb — the opportunity's own `flags`
-- column was never read for an investor-scoped doc_type at all, and
-- `regulated_disclosure` had nowhere to read a platform setting from, so it
-- defaulted to always-applicable.
--
-- Three layers now feed every applicability check, least to most specific:
--   1. the platform setting (this migration's new `platform_settings`
--      table, key 'regulated_disclosure') — the baseline;
--   2. the opportunity's own `flags` column — can override the platform
--      default for this one deal;
--   3. (investor-scoped only) that investor's own `deal_investor.flags` —
--      can override again for this one investor.
-- `app.doc_type_applies` itself only ever sees the fully merged jsonb for
-- whichever of those apply to the call it is answering; it does not resolve
-- the platform setting itself except as the one explicit fallback below, and
-- it never reaches past what it is handed for deal/investor flags.
-- ============================================================================

create table if not exists platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid references profiles(user_id),
  updated_at timestamptz not null default now()
);

comment on table platform_settings is
  'Firm-wide settings with nowhere else to live — e.g. regulated_disclosure, read by app.doc_type_applies. Readable by every authenticated session; writable only by reiwa_admin.';

alter table platform_settings enable row level security;

drop policy if exists platform_settings_select on platform_settings;
create policy platform_settings_select on platform_settings for select to authenticated
  using (true);
drop policy if exists platform_settings_admin_write on platform_settings;
create policy platform_settings_admin_write on platform_settings for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

revoke all on platform_settings from anon, public;
grant select, insert, update, delete on platform_settings to authenticated;

-- ---- doc_type_applies: now reads real merged flags + the platform setting
-- No longer `immutable` (it reads a table for one specific condition), so
-- `stable` — still never writes anything, still safe to call per row.
create or replace function app.doc_type_applies(
  p_gate_condition text, p_flags jsonb, p_investor_type text
) returns boolean
  language plpgsql stable
  set search_path = ''
  as $fn$
  declare
    platform_value boolean;
  begin
    if p_gate_condition is null then
      return true;
    elsif p_gate_condition = 'geared' then
      return coalesce((p_flags->>'geared')::boolean, false);
    elsif p_gate_condition = 'hedged' then
      return coalesce((p_flags->>'hedged')::boolean, false);
    elsif p_gate_condition like 'jurisdiction:%' then
      return p_flags->>'jurisdiction' = split_part(p_gate_condition, ':', 2);
    elsif p_gate_condition like 'investor_type:%' then
      return p_investor_type = split_part(p_gate_condition, ':', 2);
    elsif p_gate_condition = 'regulated_disclosure' then
      -- The deal/investor flags (already merged by the caller) win if they
      -- say anything explicit; otherwise fall back to the platform setting.
      -- Key is 'regulated_disclosure' (snake_case, matching the condition
      -- string itself) in the raw jsonb — the TypeScript side (DealFlags,
      -- src/lib/deal-gates/types.ts) reads and writes this exact key too,
      -- not a camelCase rename, so a flag set directly in SQL and one set
      -- through the app agree without translation.
      if p_flags ? 'regulated_disclosure' then
        return coalesce((p_flags->>'regulated_disclosure')::boolean, false);
      end if;
      select (value = 'true'::jsonb) into platform_value
        from public.platform_settings where key = 'regulated_disclosure';
      return coalesce(platform_value, false);
    else
      return true;
    end if;
  end
  $fn$;

-- Unchanged from 0047 — CREATE OR REPLACE keeps the existing grant, repeated
-- here only so this file is self-contained to read.
revoke execute on function app.doc_type_applies(text, jsonb, text) from public, anon;
grant execute on function app.doc_type_applies(text, jsonb, text) to authenticated;

-- ---- ensure_deal_documents_for_investor: pass the real merged flags -------
create or replace function app.ensure_deal_documents_for_investor(p_deal_investor_id uuid) returns void
  language plpgsql
  set search_path = ''
  as $fn$
  begin
    insert into public.deal_document (org_id, opportunity_id, deal_investor_id, doc_type_key, status)
    select di.org_id, di.opportunity_id, di.deal_investor_id, dt.key, 'not_started'
      from public.doc_type dt
      join public.deal_investor di on di.deal_investor_id = p_deal_investor_id
      join public.opportunities o on o.opportunity_id = di.opportunity_id
     where dt.scope = 'investor' and dt.is_active
       and dt.investor_status_trigger is not null
       and app.investor_status_rank(dt.investor_status_trigger) <= app.investor_status_rank(di.status)
       and app.doc_type_applies(dt.gate_condition, o.flags || di.flags, di.investor_type)
    on conflict (
      opportunity_id, doc_type_key,
      coalesce(deal_investor_id, '00000000-0000-0000-0000-000000000000'::uuid),
      coalesce(counterparty_id,  '00000000-0000-0000-0000-000000000000'::uuid)
    ) do nothing;
  end
  $fn$;

revoke execute on function app.ensure_deal_documents_for_investor(uuid) from public, anon;
grant execute on function app.ensure_deal_documents_for_investor(uuid) to authenticated;

-- ROLLBACK:
--   drop function if exists app.ensure_deal_documents_for_investor(uuid);  -- (recreate 0047's version)
--   drop function if exists app.doc_type_applies(text, jsonb, text);      -- (recreate 0047's version)
--   drop table if exists platform_settings;
