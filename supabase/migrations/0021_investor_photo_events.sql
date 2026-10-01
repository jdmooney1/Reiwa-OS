-- ============================================================================
-- 0021 - Activity trail: 'photo_viewed'
-- ----------------------------------------------------------------------------
-- Photo delivery (0020, src/lib/photos/portal-delivery.ts) records what an
-- investor was shown, exactly as document delivery records document_downloaded:
-- ONE event, written only after a photograph has been authorised AND a signed URL
-- minted, never on a refusal. Engagement should not be blind to photographs from
-- the day they exist.
--
-- Two changes to investor_activity_events (0005):
--
--   1. event_type gains 'photo_viewed'. The CHECK was written inline in 0005, so
--      Postgres named it investor_activity_events_event_type_check; it is dropped
--      and re-added with the same list plus the one value.
--
--   2. A nullable photo_id column. The existing document_id is a foreign key to
--      publication_documents, so it cannot hold a photograph. photo_id is
--      DELIBERATELY NOT a foreign key to property_photos:
--        * property_photos is on the internal side of the schema (0019), and an
--          investor-writable table must not reference it. A foreign key check
--          would tell an investor, by succeeding or failing, whether a guessed
--          id exists. The same reasoning kept every internal id off the
--          investor-readable rows in 0005.
--        * The id is one the investor already holds (it is in the URL they
--          fetched), and the row is only ever written after the database has
--          resolved that id for them.
--      The cost is that deleting a photograph leaves its id on old events. That
--      is acceptable for an append-only trail: the event records that a view
--      happened, and the id simply no longer resolves.
--
-- Existing rows, policies and privileges are untouched: still append-only for
-- everybody (0007), investors still insert and read only their own rows (0005).
-- ============================================================================
alter table investor_activity_events
  drop constraint if exists investor_activity_events_event_type_check;

alter table investor_activity_events
  add constraint investor_activity_events_event_type_check
  check (event_type in (
    'login', 'opportunity_viewed', 'saved', 'unsaved', 'compared',
    'document_viewed', 'document_downloaded', 'information_requested',
    'photo_viewed'));

alter table investor_activity_events
  add column if not exists photo_id uuid;

comment on column investor_activity_events.photo_id is
  'The photograph a photo_viewed event is about. Not a foreign key, on purpose: the photo register is internal-side and an investor-writable table must not be able to probe it.';

-- Serves the de-duplication check on write and per-photo engagement reporting.
create index if not exists idx_activity_photo
  on investor_activity_events(photo_id, investor_contact_id, occurred_at desc)
  where photo_id is not null;
