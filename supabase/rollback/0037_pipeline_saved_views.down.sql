-- ROLLBACK for 0037_pipeline_saved_views.sql. Run by hand in the Supabase SQL editor.
-- Loses every saved view (they are personal preferences, not deal data). Nothing else is touched.
-- Safe to run twice. The pipeline page keeps working without the table (it hides the saved-views menu).
--
-- Wrapped in one transaction so it is all or nothing.
begin;

drop table if exists public.pipeline_saved_views;

-- Forget that the migration was applied, so that `npm run db:migrate` (or a paste of the up file) can apply it again.
delete from app._migrations where name = '0037_pipeline_saved_views.sql';

commit;
