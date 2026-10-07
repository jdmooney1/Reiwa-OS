-- ============================================================================
-- 0037 - Saved pipeline views
-- ----------------------------------------------------------------------------
-- A saved view is a name for a set of pipeline filters (for example an investor mandate:
-- "Core London offices, 5-15m, 6%+"), so it can be reopened in one click instead of rebuilt.
--
-- PERSONAL, NOT SHARED. A view belongs to the person who saved it and only that person
-- can read, rename, change or delete it. Sharing a mandate with the team is a deliberate
-- later step (a `shared` flag and one more policy), not something to be implied here.
--
-- WHAT IS STORED. `definition` is the view as the app builds it: the filters, the table sort
-- and board-or-table. It holds filter VALUES (a market name, a price bound), never a deal id
-- and no figure from any deal. The app validates it on the way in and again on the way out,
-- so a hand-edited row cannot put anything but a valid view on screen.
--
-- NOTHING ELSE CHANGES. No existing table, policy, grant or function is touched. Rolling this
-- back is `drop table` (supabase/rollback/0037_pipeline_saved_views.down.sql) and loses only
-- the saved views themselves. The pipeline page works without the table (it hides the saved-views
-- menu), so applying this late, or rolling it back, does not break the pipeline.
-- ============================================================================

create table if not exists public.pipeline_saved_views (
  view_id    uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(user_id) on delete cascade,
  name       text not null
               check (btrim(name) <> '' and char_length(name) <= 80),
  definition jsonb not null
               check (jsonb_typeof(definition) = 'object' and pg_column_size(definition) <= 4096),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.pipeline_saved_views is
  'A person''s named pipeline filter set (filters, table sort, board or table). Private to its owner.';

-- One name per person, ignoring case and surrounding spaces.
create unique index if not exists pipeline_saved_views_owner_name
  on public.pipeline_saved_views (user_id, lower(btrim(name)));

drop trigger if exists trg_pipeline_saved_views_touch on public.pipeline_saved_views;
create trigger trg_pipeline_saved_views_touch before update on public.pipeline_saved_views
  for each row execute function app.touch_updated_at();

-- ---- Row level security: your own rows, and only for internal roles ---------
alter table public.pipeline_saved_views enable row level security;

drop policy if exists pipeline_saved_views_select on public.pipeline_saved_views;
create policy pipeline_saved_views_select on public.pipeline_saved_views
  for select to authenticated
  using (user_id::text = app.current_user_id());

drop policy if exists pipeline_saved_views_insert on public.pipeline_saved_views;
create policy pipeline_saved_views_insert on public.pipeline_saved_views
  for insert to authenticated
  with check (
    user_id::text = app.current_user_id()
    and app.current_global_role() in ('reiwa_admin', 'reiwa_staff', 'org_user')
  );

drop policy if exists pipeline_saved_views_update on public.pipeline_saved_views;
create policy pipeline_saved_views_update on public.pipeline_saved_views
  for update to authenticated
  using (user_id::text = app.current_user_id())
  with check (
    user_id::text = app.current_user_id()
    and app.current_global_role() in ('reiwa_admin', 'reiwa_staff', 'org_user')
  );

drop policy if exists pipeline_saved_views_delete on public.pipeline_saved_views;
create policy pipeline_saved_views_delete on public.pipeline_saved_views
  for delete to authenticated
  using (user_id::text = app.current_user_id());

-- 0007 removed the blanket default grant, so the privileges are named.
revoke all on public.pipeline_saved_views from anon, public;
grant select, insert, update, delete on public.pipeline_saved_views to authenticated;
