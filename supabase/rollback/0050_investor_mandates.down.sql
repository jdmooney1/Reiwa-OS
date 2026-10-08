-- Rolls back 0050: removes every investor mandate. Nothing else depends on the table.
begin;
drop table if exists public.investor_mandates;
delete from app._migrations where name = '0050_investor_mandates.sql';
commit;
