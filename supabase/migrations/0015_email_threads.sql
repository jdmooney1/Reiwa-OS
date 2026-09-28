-- ============================================================================
-- 0015 — Broker email threads, linked many-to-many to opportunities
-- ----------------------------------------------------------------------------
-- 68 labelled Gmail threads against 132 deals, and the relationship between
-- them is genuinely many-to-many in BOTH directions:
--
--   * One thread covers many deals. 19 of them are firm-level: "Metrus",
--     "Avison Young", "London Tracker", "Opportunities Amsterdam". A broker
--     sends one thread listing eight buildings. A gmail_thread_id column on
--     the opportunity could hold that relationship only by duplicating the
--     thread id across eight rows and losing the fact that it is one
--     conversation.
--
--   * One deal has many threads. A deal that came back to market has the
--     original approach and the relaunch, months apart, and both are evidence.
--
-- So: a thread is a row, a link is a row, and neither owns the other.
--
-- NOT EVERY THREAD IS A DEAL, AND TWO MUST NEVER BE LINKED.
-- `classification` carries that. A Google security alert mislabelled Amsterdam
-- is junk. "16 Conduit Street" is a Meiji-OWNED asset, not pipeline — and the
-- matcher originally paired it with "9 Conduit Street" (LON-052), which was
-- wrong and was withdrawn. Both are recorded as `not_a_deal` so a later pass
-- does not rediscover them as candidates and make the same mistake twice.
--
-- CONFIDENCE IS NOT A DECISION. A link the matcher is unsure of loads, because
-- withholding it loses the evidence, but it loads as `review` and is not
-- treated as settled until somebody confirms it. `confirmed_at` is null until
-- then, which is what lets a screen show the difference.
--
-- WHAT THIS DOES NOT DO: store any message content. A thread id and a subject
-- line are enough to link and to deep-link into Gmail. Bodies, attachments and
-- signature blocks are the deferred extraction phase, which is a different
-- design with a different privacy surface.
-- ============================================================================

create table if not exists email_threads (
  email_thread_id uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(org_id) on delete cascade,

  -- Gmail's own thread identifier. The deep link is composed from it at render
  -- time rather than stored, so a change of mailbox or account does not leave
  -- a table full of stale URLs.
  gmail_thread_id text not null,
  subject         text,
  market          text,

  classification  text not null default 'deal'
    check (classification in ('deal', 'firm_level', 'market_report', 'admin',
                              'not_a_deal', 'unmatched')),
  -- Why a thread is classified as it is, in the words of whoever decided.
  note            text,

  first_seen_at timestamptz not null default now(),
  created_by    uuid not null references profiles(user_id),
  created_at    timestamptz not null default now(),
  unique (org_id, gmail_thread_id)
);

comment on column email_threads.classification is
  'deal = about one opportunity. firm_level = one thread covering several '
  'deals; assigned by hand. market_report / admin = correspondence that is not '
  'a deal. not_a_deal = must never be linked (a mislabelled security alert; '
  '16 Conduit Street, which is a Meiji-owned asset). unmatched = a real '
  'property that is not among the 132 - kept, not deleted, and not auto-created.';

create index if not exists idx_email_threads_org
  on email_threads(org_id, classification);

-- ---- The link --------------------------------------------------------------
create table if not exists opportunity_email_threads (
  org_id          uuid not null references organizations(org_id) on delete cascade,
  opportunity_id  uuid not null references opportunities(opportunity_id) on delete cascade,
  email_thread_id uuid not null references email_threads(email_thread_id) on delete cascade,

  -- How the link was arrived at, carried forward from the source.
  confidence   text not null default 'review' check (confidence in ('high', 'review')),
  matched_subject text,

  -- Null until a person agrees. A `review` link is evidence offered, not a
  -- fact asserted, and the difference has to survive into the database or the
  -- screen cannot show it.
  confirmed_at timestamptz,
  confirmed_by uuid references profiles(user_id),

  linked_by  uuid not null references profiles(user_id),
  created_at timestamptz not null default now(),
  primary key (opportunity_id, email_thread_id)
);

create index if not exists idx_oet_thread on opportunity_email_threads(email_thread_id);
create index if not exists idx_oet_org on opportunity_email_threads(org_id, confidence);

-- A thread that is explicitly not a deal cannot be linked to one. The rule is
-- in the database rather than in the loader because the loader is not the only
-- thing that will ever write here.
create or replace function app.guard_email_thread_link() returns trigger
  language plpgsql
  set search_path = ''
  as $fn$
  declare
    class text;
    subj  text;
  begin
    select t.classification, t.subject into class, subj
      from public.email_threads t
     where t.email_thread_id = new.email_thread_id;

    if class = 'not_a_deal' then
      raise exception
        'Thread "%" is recorded as not a deal and cannot be linked to an opportunity.',
        coalesce(subj, new.email_thread_id::text);
    end if;
    return new;
  end
  $fn$;
drop trigger if exists trg_oet_guard on opportunity_email_threads;
create trigger trg_oet_guard before insert or update on opportunity_email_threads
  for each row execute function app.guard_email_thread_link();

-- ---- RLS and privileges ----------------------------------------------------
-- The 0002 shape. No investor policy: broker correspondence is the most
-- commercially sensitive material here, and an investor session matches no
-- permissive policy on either table. 0007 removed the blanket default grant,
-- so `authenticated` is named and `anon` revoked explicitly.
do $$
declare t text;
begin
  foreach t in array array['email_threads', 'opportunity_email_threads'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I_select on %I', t, t);
    execute format('create policy %I_select on %I for select to authenticated using (app.has_org(org_id))', t, t);
    execute format('drop policy if exists %I_insert on %I', t, t);
    execute format('create policy %I_insert on %I for insert to authenticated with check (app.has_org(org_id) and app.can_write())', t, t);
    execute format('drop policy if exists %I_update on %I', t, t);
    execute format('create policy %I_update on %I for update to authenticated using (app.has_org(org_id) and app.can_write()) with check (app.has_org(org_id) and app.can_write())', t, t);
    execute format('drop policy if exists %I_delete on %I', t, t);
    execute format('create policy %I_delete on %I for delete to authenticated using (app.has_org(org_id) and app.can_write())', t, t);
    execute format('revoke all on %I from anon, public', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;
