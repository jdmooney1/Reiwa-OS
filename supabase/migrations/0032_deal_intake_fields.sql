-- ============================================================================
-- 0032 - Deal intake: the facts a broker's IM carries that the schema had nowhere to put
-- ----------------------------------------------------------------------------
-- The first real deals to be loaded from broker material (a seed of eight, then the
-- extraction feature) carry facts the Asset Snapshot template has cells for and the
-- record had no column for: heritage status, tenure and term, ground rent, WAULT,
-- covenant strength, how the rent reviews, EPC, transport. This adds them, and a place
-- for the rest, WITHOUT inventing anything: every column is nullable, and NULL means the
-- source did not say.
--
-- WHERE THINGS LIVE (and why not "an asset snapshot table")
--   The Snapshot is composed on read from the records (docs/07); there is no Snapshot row.
--   So the facts go where they belong, and the Snapshot composer reads them later:
--     properties          what the BUILDING is: heritage, tenure, term, ground rent,
--                         WAULT, covenant, rent review, EPC, transport. These belong to
--                         the building, so a second opportunity on the same property
--                         sees them too.
--     opportunities       what this DEAL is: its stage in the sale process, and where
--                         its pictures are, and a verbatim record of the other source
--                         facts and how complete the source was.
--     investment_cases    unchanged. Money (price, yield, passing rent) is written there
--                         by the loader, never to the opportunity row (0009 projects it).
--
-- NOT INVESTOR-VISIBLE, BY CONSTRUCTION. Nothing here is added to any investor function or
-- view. What an investor sees is the publication's own frozen snapshot, which names its
-- fields one by one (app.opportunity_publication_source, 0005), so a new column on
-- either table is invisible to an investor until someone writes it into that list.
--
-- THE REST OF WHAT A SOURCE SAYS (opportunities.source_facts)
--   A broker's IM carries more than there are columns (tenant, lease expiry, rent steps,
--   amenities, price per sq ft, retail turnover, ...). Dropping it would make the load
--   lossy; promoting every key to a column now would freeze a schema before the extraction
--   brief has said what the vocabulary is. So the remainder is kept as given, as an object,
--   and promoted to a column when it earns one. Keys starting with an underscore are added
--   by the loader (reconciliation flags), never by the source.
-- ============================================================================

-- ---- Building facts: properties ------------------------------------------
alter table properties
  add column if not exists heritage_status        text,
  add column if not exists tenure                 text,
  add column if not exists unexpired_term_years   numeric(8,2),
  add column if not exists ground_rent_pa         numeric(14,2),
  add column if not exists ground_rent_note       text,
  add column if not exists wault_to_expiry_years  numeric(6,2),
  add column if not exists wault_to_breaks_years  numeric(6,2),
  add column if not exists covenant_rating        text,
  add column if not exists rent_review_mechanism  text,
  add column if not exists epc_rating             text,
  add column if not exists transport_connectivity text;

alter table properties drop constraint if exists properties_tenure_valid;
alter table properties add constraint properties_tenure_valid check (
  tenure is null or tenure in ('freehold', 'virtual_freehold', 'long_leasehold', 'short_leasehold', 'other'));

alter table properties drop constraint if exists properties_intake_figures_valid;
alter table properties add constraint properties_intake_figures_valid check (
  (unexpired_term_years  is null or unexpired_term_years  >= 0) and
  (ground_rent_pa        is null or ground_rent_pa        >= 0) and
  (wault_to_expiry_years is null or wault_to_expiry_years >= 0) and
  (wault_to_breaks_years is null or wault_to_breaks_years >= 0));

-- A short free-text field must not be empty or a paragraph: blank is NULL, not ''.
alter table properties drop constraint if exists properties_intake_text_valid;
alter table properties add constraint properties_intake_text_valid check (
  (heritage_status        is null or char_length(btrim(heritage_status))        between 1 and 200) and
  (ground_rent_note       is null or char_length(btrim(ground_rent_note))       between 1 and 200) and
  (covenant_rating        is null or char_length(btrim(covenant_rating))        between 1 and 200) and
  (rent_review_mechanism  is null or char_length(btrim(rent_review_mechanism))  between 1 and 500) and
  (epc_rating             is null or char_length(btrim(epc_rating))             between 1 and 50)  and
  (transport_connectivity is null or char_length(btrim(transport_connectivity)) between 1 and 500));

comment on column properties.tenure is
  'freehold | virtual_freehold | long_leasehold | short_leasehold | other. NULL = the source did not say.';
comment on column properties.unexpired_term_years is 'Years left on a leasehold or virtual-freehold title.';
comment on column properties.ground_rent_pa is
  'Ground rent per year, in the currency of the opportunity it was recorded from. NULL when none is stated; a peppercorn is NOT zero and is recorded in ground_rent_note instead.';
comment on column properties.ground_rent_note is 'Ground rent as the source worded it, where it is not an amount (e.g. Peppercorn).';

-- ---- Deal facts: opportunities -------------------------------------------
alter table opportunities
  add column if not exists deal_stage            text,
  add column if not exists photo_reference_type  text,
  add column if not exists photo_url             text,
  add column if not exists source_attachments    jsonb not null default '[]'::jsonb,
  add column if not exists data_completeness     text,
  add column if not exists source_facts          jsonb not null default '{}'::jsonb;

alter table opportunities drop constraint if exists opportunities_deal_stage_valid;
alter table opportunities add constraint opportunities_deal_stage_valid check (
  deal_stage is null or deal_stage in ('early_dialogue', 'guided', 'under_offer'));

-- Where a picture might be got, as distinct from a picture we hold. A STORED photograph is
-- a row of the photo gallery (0019) and needs no value here; when one exists it is what is shown.
-- NULL means nobody has looked yet; 'none_found' means somebody did and there is none.
alter table opportunities drop constraint if exists opportunities_photo_reference_valid;
alter table opportunities add constraint opportunities_photo_reference_valid check (
  (photo_reference_type is null or photo_reference_type in ('attachment_not_retrieved', 'external_url', 'none_found'))
  and ((photo_reference_type is not distinct from 'external_url') = (photo_url is not null))
  and (photo_url is null or photo_url ~ '^https?://[^[:space:]]+$')
  and jsonb_typeof(source_attachments) = 'array'
  and (photo_reference_type is distinct from 'none_found' or jsonb_array_length(source_attachments) = 0)
  and (photo_reference_type is distinct from 'attachment_not_retrieved' or jsonb_array_length(source_attachments) > 0));

alter table opportunities drop constraint if exists opportunities_source_facts_valid;
alter table opportunities add constraint opportunities_source_facts_valid check (
  jsonb_typeof(source_facts) = 'object'
  and (data_completeness is null or char_length(btrim(data_completeness)) between 1 and 1000));

comment on column opportunities.deal_stage is
  'Where the SALE PROCESS is (early_dialogue | guided | under_offer); not Reiwa''s own pipeline stage, which is `stage`. NULL = not recorded. An early_dialogue deal normally has no price or yield yet, and its investment case says so by being NULL, not zero.';
comment on column opportunities.photo_reference_type is
  'attachment_not_retrieved | external_url | none_found | NULL (not looked at). A stored photograph (a row of the photo gallery) takes precedence over this.';
comment on column opportunities.source_attachments is
  'Names of files the source identified but that have not been retrieved, as a JSON array of strings.';
comment on column opportunities.data_completeness is
  'How complete the source material was, in the words of whoever extracted it. A thin record is thin, not wrong.';
comment on column opportunities.source_facts is
  'Source facts with no column yet, kept as given (object, nested by the source''s own sections). Keys starting with an underscore are added by the loader, never by the source.';
