-- ============================================================================
-- 0059 — document_version.is_manual_override: unblock delivery before Session 6
-- ----------------------------------------------------------------------------
-- Session 4 decision F: a PDF may be manually uploaded as a document_version
-- for any investor-facing Produce doc_type, even when its catalogue
-- generation_mode is 'template_fill', 'memo_backed' or 'none' — not only the
-- types already marked 'manual_upload'. This unblocks delivery of pitch_pack
-- and friends now, without waiting on Session 6's generator; the catalogue's
-- own generation_mode is unchanged by this, and Session 6 is expected to
-- make this override the exception again once real generation exists.
--
-- Tagged, hashed and immutable-on-lock exactly like every other version —
-- this column changes nothing about app.guard_document_version (0040); it
-- only names how THIS version's bytes came to exist.
--
-- NARROW ON PURPOSE: the trigger below only ever widens what the DB will
-- accept for a flagged row — refusing a manual override for a doc_type that
-- is not Produce/investor-audience, and refusing one that is pointless
-- (the catalogue already says 'manual_upload'). It does not touch the
-- existing document_version RLS (0040): any session that could already
-- insert a version there can set this flag, same as every other column.
-- ============================================================================

alter table document_version
  add column if not exists is_manual_override boolean not null default false;

comment on column document_version.is_manual_override is
  'True when this version was manually uploaded for a doc_type whose catalogue generation_mode is not manual_upload (docs/24 Session 4 decision F) — unblocks delivery of produce/memo_backed/template_fill investor documents (e.g. pitch_pack) before Session 6''s generator exists. The catalogue''s own generation_mode is unchanged.';

create or replace function app.validate_manual_override_version() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    dt record;
  begin
    if new.is_manual_override then
      select dt2.origin, dt2.audience, dt2.generation_mode into dt
        from public.deal_document dd
        join public.doc_type dt2 on dt2.key = dd.doc_type_key
       where dd.deal_document_id = new.deal_document_id;

      if dt.origin is distinct from 'produce' or not ('investor' = any(dt.audience)) then
        raise exception
          'document_version % : is_manual_override is only for investor-facing Produce doc_types (deal_document %)',
          new.version_id, new.deal_document_id;
      end if;
      if dt.generation_mode = 'manual_upload' then
        raise exception
          'document_version % : deal_document % is already manual_upload in the catalogue — is_manual_override is for overriding template_fill/memo_backed/none only',
          new.version_id, new.deal_document_id;
      end if;
    end if;
    return new;
  end
  $fn$;

drop trigger if exists trg_document_version_manual_override on document_version;
create trigger trg_document_version_manual_override before insert on document_version
  for each row execute function app.validate_manual_override_version();

-- ROLLBACK:
--   drop trigger if exists trg_document_version_manual_override on document_version;
--   drop function if exists app.validate_manual_override_version();
--   alter table document_version drop column if exists is_manual_override;
