-- ============================================================================
-- 0034 - Every publication document owns its file
-- ----------------------------------------------------------------------------
-- THE DEFECT. Starting a draft from a version copied the document ROWS but kept the
-- same `storage_path`, so a draft and the live version shared one file. Removing the
-- document from the draft deleted that file, and the live version's download then
-- failed for the investor, with nothing to say why.
--
-- THE FIX is in code: a new draft now gets its own COPY of each file at a new path
-- (lib/data/admin-portal createDraftFromVersion), and removing a document deletes its
-- file only if no other row still references it. This migration makes the rule a fact
-- the database enforces rather than a habit every future code path has to remember:
-- no two documents may point at one file, so a path-sharing insert fails at the insert.
--
-- EXISTING DATA. A migration cannot copy storage objects, so it cannot repair rows that
-- ALREADY share a path. Where duplicates exist the index is NOT created and a NOTICE says
-- so; nothing is changed and the migration succeeds. The repair is a script that copies
-- the files and re-points the rows, then creates this same index:
--
--     npm run db:audit-documents        (read-only: lists shared and missing files)
--     npm run db:unshare-documents      (dry run)   /   -- --apply
--
-- Until then the code-level guard (a delete returns no path while anything else still
-- references it) keeps the shared file safe.
--
-- LINEAGE. Once every version owns its own file, the path can no longer say "this is the same
-- document as the live version's". The publish review diff needs that, so each document row
-- carries a `lineage_id`: a fresh upload gets a new one, a copy made for a new draft keeps its
-- source's. Existing rows that already share a file are one document, so they share a lineage.
-- ============================================================================
alter table public.publication_documents
  add column if not exists lineage_id uuid not null default gen_random_uuid();

-- Rows that already share a file are the same document. The immutability trigger is switched
-- off for this one statement: a lineage tag is bookkeeping about identity, not published content.
alter table public.publication_documents disable trigger trg_pubdocument_guard;
update public.publication_documents d
   set lineage_id = g.lineage
  from (select storage_path, gen_random_uuid() as lineage
          from public.publication_documents
         group by storage_path having count(*) > 1) g
 where d.storage_path = g.storage_path;
alter table public.publication_documents enable trigger trg_pubdocument_guard;

do $$
begin
  if exists (select 1 from public.publication_documents
              group by storage_path having count(*) > 1) then
    raise notice '0034: publication_documents rows share a storage_path; unique index NOT created. '
                 'Run db:audit-documents, then db:unshare-documents --apply.';
  else
    create unique index if not exists publication_documents_storage_path_key
      on public.publication_documents (storage_path);
  end if;
end $$;
