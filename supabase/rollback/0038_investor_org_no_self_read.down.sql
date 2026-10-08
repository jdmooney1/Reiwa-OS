-- Rolls back 0038: gives an investor read access to their own organisation row again.
-- NOTE: this re-opens the column leak described in 0038 (notes, linked_internal_organization_id).
-- Only roll back if something is found to depend on it, and fix that dependency instead.
begin;
create policy investor_organizations_self on public.investor_organizations for select to authenticated
  using (investor_org_id = app.current_investor_org_id());
delete from app._migrations where name = '0038_investor_org_no_self_read.sql';
commit;
