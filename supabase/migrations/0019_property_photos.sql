-- ============================================================================
-- 0019  Asset photos (Phase 1: staff only)
-- ----------------------------------------------------------------------------
-- A property has photographs: one HEADLINE and a gallery. The bytes live in the
-- private Supabase Storage bucket `property-photos`; this table is the register.
--
-- THE DEFAULT IS INTERNAL. `visibility` reuses the document vocabulary
-- (internal / standard / diligence) so the same entitlement comparison,
-- app.document_tier(), can decide a photo later exactly as it decides a document.
-- Nothing here reads it for an investor: there is NO investor policy, NO view
-- change and NO helper in this migration. A portal contact has no `profiles` row
-- and no `organization_members` row, so app.has_org() is false for every org and
-- the staff policies below return them nothing, at any tier. An investor-facing
-- read path is a separate, deliberate migration (Phase 2), and
-- tests/unit/investor-no-photos.test.ts fails until it is made on purpose.
--
-- Same posture as every other internal table (0003, 0008): org-scoped read,
-- org-scoped-and-writable write, `anon` revoked.
-- ============================================================================
create table if not exists property_photos (
  photo_id    uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(org_id) on delete cascade,
  property_id uuid not null references properties(property_id) on delete cascade,
  -- Server-generated and random. Never supplied by a browser, never returned to
  -- one: the row is the authority for it, as with publication_documents.
  object_path text not null,
  -- Checked on the server against the file's own bytes; repeated here so no
  -- other writer can store a type the application would refuse (no SVG: it can
  -- carry script).
  mime_type   text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  is_headline boolean not null default false,
  sort_order  integer not null default 0,
  caption     text,
  visibility  text not null default 'internal'
                check (visibility in ('internal', 'standard', 'diligence')),
  uploaded_by uuid not null references profiles(user_id),
  created_at  timestamptz not null default now()
);

comment on table property_photos is
  'Photographs of a property. Staff-only in Phase 1: no investor read path exists. visibility defaults to internal and uses the document tiers so app.document_tier() can gate it later.';
comment on column property_photos.object_path is
  'Path in the private property-photos bucket. Server-generated, random, never sent to a browser.';
comment on column property_photos.visibility is
  'internal | standard | diligence. Recorded now, consumed by nothing investor-facing until Phase 2.';

-- At most ONE headline per property, enforced where it cannot be bypassed. The
-- same pattern as properties_identity_key (0012): a partial unique index.
create unique index if not exists property_photos_one_headline
  on property_photos(property_id) where is_headline;

create unique index if not exists property_photos_object_path_key
  on property_photos(object_path);

create index if not exists idx_property_photos_property
  on property_photos(property_id, sort_order, created_at);

alter table property_photos enable row level security;

drop policy if exists property_photos_select on property_photos;
create policy property_photos_select on property_photos for select to authenticated
  using (app.has_org(org_id));
drop policy if exists property_photos_insert on property_photos;
create policy property_photos_insert on property_photos for insert to authenticated
  with check (app.has_org(org_id) and app.can_write());
drop policy if exists property_photos_update on property_photos;
create policy property_photos_update on property_photos for update to authenticated
  using (app.has_org(org_id) and app.can_write())
  with check (app.has_org(org_id) and app.can_write());
drop policy if exists property_photos_delete on property_photos;
create policy property_photos_delete on property_photos for delete to authenticated
  using (app.has_org(org_id) and app.can_write());

revoke all on property_photos from anon, public;
grant select, insert, update, delete on property_photos to authenticated;
