-- ============================================================================
-- 0027 - Land / building value and the depreciation basis, on the case
-- ----------------------------------------------------------------------------
-- The platform could score "Japanese Depreciation Benefit" 1-10 as a judgement
-- but could not produce the yen figure that is the whole point of showing it to a
-- Japanese investor. The inputs for that figure are case data, like every other
-- number on an underwriting: they live on investment_cases, are entered once per
-- version, and are immutable once the case is approved (app.block_if_approved_case
-- compares whole rows, so a column added here is locked from the moment it exists).
--
--   land_value           the part of the price that is land (not depreciable)
--   building_value       the part that is building (the depreciable base)
--   depreciation_years   the useful-life assumption
--   depreciation_method  'straight_line' only, until somebody needs another. Not
--                        a selector: a method nobody has asked for is not built.
--
-- NOTHING DERIVED IS STORED. The building share, the annual depreciation and every
-- yen figure are computed on read (src/lib/underwriting/allocation.ts), so they
-- cannot go stale when the life assumption or the exchange rate moves.
--
-- RECONCILIATION. A split that does not add up to the price is refused, not
-- quietly kept. When both values are present, their sum must be within 0.5% of
-- acquisition_price (or 1 currency unit, whichever is larger), and a price must
-- exist to compare against. A CHECK rather than a generated column: a generated
-- value would remove the analyst's ability to enter both figures from a valuation
-- report, which is the normal way a split arrives. The same 0.005 lives in
-- src/lib/underwriting/allocation.ts; tests/unit/allocation.test.ts holds the two
-- together. The comparison is against the ACQUISITION PRICE, the price being
-- allocated, not the valuation, which is a different quantity.
--
-- Not backfilled and not defaulted: every existing case has none of the four, and
-- the Asset Snapshot omits the allocation lines until they are entered.
-- ============================================================================
alter table investment_cases
  add column if not exists land_value          numeric(18,2),
  add column if not exists building_value      numeric(18,2),
  add column if not exists depreciation_years  integer,
  add column if not exists depreciation_method text;

alter table investment_cases drop constraint if exists investment_cases_allocation_nonneg;
alter table investment_cases add constraint investment_cases_allocation_nonneg check (
  (land_value is null or land_value >= 0) and (building_value is null or building_value >= 0)
);

alter table investment_cases drop constraint if exists investment_cases_depreciation_life;
alter table investment_cases add constraint investment_cases_depreciation_life check (
  depreciation_years is null or (depreciation_years between 1 and 100)
);

alter table investment_cases drop constraint if exists investment_cases_depreciation_method;
alter table investment_cases add constraint investment_cases_depreciation_method check (
  depreciation_method is null or depreciation_method = 'straight_line'
);

-- A method with no life, or a life with no method, is half an assumption.
alter table investment_cases drop constraint if exists investment_cases_depreciation_whole;
alter table investment_cases add constraint investment_cases_depreciation_whole check (
  (depreciation_years is null) = (depreciation_method is null)
);

alter table investment_cases drop constraint if exists investment_cases_allocation_reconciles;
alter table investment_cases add constraint investment_cases_allocation_reconciles check (
  land_value is null or building_value is null
  or (
    acquisition_price is not null
    and abs(land_value + building_value - acquisition_price) <= greatest(1, 0.005 * acquisition_price)
  )
);

comment on column investment_cases.land_value is
  'The land part of the acquisition price, in the case currency. With building_value it must reconcile to acquisition_price within 0.5% (CHECK).';
comment on column investment_cases.building_value is
  'The building part of the acquisition price: the depreciable base. Derived figures (building %, annual depreciation, yen) are computed on read, never stored.';
comment on column investment_cases.depreciation_years is
  'Useful-life assumption in whole years, 1-100. Entered with depreciation_method.';
