-- ============================================================================
-- 0025 - fx_rates: a person maintains these, and only an administrator
-- ----------------------------------------------------------------------------
-- 0004 seeded four "Demo static rates" and left writes to the privileged
-- connection, so nobody could correct a rate without a database console. This
-- gives the admin settings card a lawful path: Reiwa administrators (and only
-- they, via app.is_admin()) can insert or update a rate. Everyone signed in can
-- still read them, as before; investors still read none (their reads are denied
-- by the `to authenticated` role test, see tests/investor-rls.test.ts).
--
-- This is NOT a live feed. A rate is whatever an administrator last typed, with
-- the source they named and the date it is good for. The app flags any rate
-- older than 30 days wherever it is shown or composed; it never blocks on one.
--
-- No delete: removing a currency would make the portfolio refuse to value
-- assets in it, which is a decision to take with a migration, not a button.
--
-- Added: updated_by / updated_at, so the card can say who last touched a rate.
-- The action sets them; the policy is what stops anyone else writing at all.
-- ============================================================================
alter table fx_rates
  add column if not exists updated_by uuid references profiles(user_id),
  add column if not exists updated_at timestamptz;

-- A rate must be a positive number and must say where it came from.
alter table fx_rates drop constraint if exists fx_rates_rate_positive;
alter table fx_rates add constraint fx_rates_rate_positive check (rate_to_gbp > 0);
alter table fx_rates drop constraint if exists fx_rates_source_named;
alter table fx_rates add constraint fx_rates_source_named check (length(btrim(source)) > 0);

drop policy if exists fx_rates_insert on fx_rates;
create policy fx_rates_insert on fx_rates for insert to authenticated
  with check (app.is_admin());

drop policy if exists fx_rates_update on fx_rates;
create policy fx_rates_update on fx_rates for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- Insert and update for the signed-in role (the policies above narrow that to
-- administrators); never delete, and nothing for anon. Revoking explicitly rather
-- than relying on the grant list, because Supabase's default privileges hand
-- every new grant on a public table to anon and authenticated.
revoke all on fx_rates from anon, public;
revoke delete on fx_rates from authenticated;
grant select, insert, update on fx_rates to authenticated;
