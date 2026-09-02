-- ============================================================================
-- 0004 — FX rates (explicit, labelled; never silently hard-coded)
-- ----------------------------------------------------------------------------
-- Portfolio aggregation reads rates from here and surfaces the source + date in
-- the UI. Replace the seeded demo rates with a live feed for production.
-- ============================================================================
create table if not exists fx_rates (
  currency    text primary key,
  rate_to_gbp numeric(12,6) not null,
  as_of_date  date not null,
  source      text not null
);

grant select on fx_rates to authenticated;

insert into fx_rates(currency, rate_to_gbp, as_of_date, source) values
  ('GBP', 1.000000, '2026-08-27', 'Demo static rates'),
  ('EUR', 0.850000, '2026-08-27', 'Demo static rates'),
  ('USD', 0.790000, '2026-08-27', 'Demo static rates'),
  ('JPY', 0.005200, '2026-08-27', 'Demo static rates')
on conflict (currency) do nothing;
