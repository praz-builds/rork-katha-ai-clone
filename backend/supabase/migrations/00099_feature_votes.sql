-- 00099: vote on what gets built next.
--
-- The final-feedback round asked for "feedback voting" beside bug reporting.
-- Reporting shipped in #140 (`app_feedback`, migration 00098, the
-- `app-feedback` function); this is the other half, and only that half: a
-- count the team can read of which named things readers want most.
--
-- ## Voting is on a CURATED list, never on user-written ideas
--
-- `feedback_topics` is written by the team (service role only). Readers vote;
-- they do not post topics. A public board of user-written ideas is
-- user-generated content every other reader sees, and Play's UGC policy then
-- expects reporting, blocking and moderation on it too -- a second moderation
-- surface for a feature whose job is a tally. An idea that is not on the list
-- goes through Send feedback (00098), where only the team reads it and can
-- promote it to a topic.
--
-- One vote per reader per topic is the primary key. A reader can take a vote
-- back (delete their own row) and cannot see who else voted: the per-topic
-- count comes from `feedback_topic_tallies()`, which returns numbers and the
-- caller's own `voted` flag, never user ids. A shipped topic is closed.
--
-- ## Only named accounts vote
--
-- A pre-auth anonymous session is free to mint, so a vote from one is a tally
-- anybody can inflate. The app has no guests past the email step, so a real
-- reader is never refused. (Send feedback deliberately accepts anonymous
-- sessions; a message is not a count.)
--
-- Nothing here grants, spends or promises credits.
--
-- ## Deletion
--
-- `feedback_votes.user_id` references `auth.users(id) on delete cascade`, so
-- the second step of account deletion removes a person's votes.
--
-- ## Deploy
--
-- Migration only; the client reads and writes through PostgREST under RLS.
-- Until this is applied the vote sheet says the list could not load.
--
-- Repo rule (00071): NULLIF, COALESCE, GREATEST and LEAST are parser
-- constructs, not `pg_catalog` functions. Under `set search_path = ''` every
-- real function is qualified and these four must NOT be.

-- Read from the request's JWT claims, the same source `auth.uid()` reads; a
-- missing claim (service role, SQL editor) is not anonymous.
create or replace function public.caller_is_named()
returns boolean
language sql
stable
set search_path = ''
as $$
    select coalesce(
        (nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb
            ->> 'is_anonymous')::boolean,
        false
    ) = false;
$$;

revoke all on function public.caller_is_named() from public, anon;
grant execute on function public.caller_is_named() to authenticated;

create table if not exists public.feedback_topics (
    id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
    title text not null check (pg_catalog.char_length(title) between 1 and 80),
    detail text check (detail is null or pg_catalog.char_length(detail) <= 200),
    status text not null default 'open'
        check (status in ('open', 'planned', 'shipped')),
    sort_order integer not null default 0,
    created_at timestamptz not null default pg_catalog.now()
);

comment on table public.feedback_topics is
    'Curated "what should we build next" list (00099). Team-written; readers vote via feedback_votes and never post topics.';

alter table public.feedback_topics enable row level security;

drop policy if exists feedback_topics_read on public.feedback_topics;
create policy feedback_topics_read on public.feedback_topics
    for select to authenticated
    using (true);

revoke all on public.feedback_topics from anon, authenticated;
grant select on public.feedback_topics to authenticated;

create table if not exists public.feedback_votes (
    topic_id text not null references public.feedback_topics(id) on delete cascade,
    user_id uuid not null default auth.uid()
        references auth.users(id) on delete cascade,
    created_at timestamptz not null default pg_catalog.now(),
    primary key (topic_id, user_id)
);

create index if not exists feedback_votes_user_id_idx
    on public.feedback_votes (user_id);

comment on table public.feedback_votes is
    'One vote per reader per feedback topic (00099). Own rows only; counts come from feedback_topic_tallies().';

alter table public.feedback_votes enable row level security;

drop policy if exists feedback_votes_read_own on public.feedback_votes;
create policy feedback_votes_read_own on public.feedback_votes
    for select to authenticated
    using (user_id = auth.uid());

drop policy if exists feedback_votes_insert_own on public.feedback_votes;
create policy feedback_votes_insert_own on public.feedback_votes
    for insert to authenticated
    with check (
        user_id = auth.uid()
        and public.caller_is_named()
        and exists (
            select 1 from public.feedback_topics t
            where t.id = topic_id and t.status in ('open', 'planned')
        )
    );

drop policy if exists feedback_votes_delete_own on public.feedback_votes;
create policy feedback_votes_delete_own on public.feedback_votes
    for delete to authenticated
    using (user_id = auth.uid());

revoke all on public.feedback_votes from anon, authenticated;
grant select, delete on public.feedback_votes to authenticated;
grant insert (topic_id) on public.feedback_votes to authenticated;

-- Counts without identities. SECURITY DEFINER because a reader can only see
-- their own votes under RLS, and a count of one's own votes is not a tally.
create or replace function public.feedback_topic_tallies()
returns table (topic_id text, votes bigint, voted boolean)
language sql
stable
security definer
set search_path = ''
as $$
    select t.id,
           pg_catalog.count(v.user_id),
           pg_catalog.bool_or(v.user_id = auth.uid()) is true
      from public.feedback_topics t
      left join public.feedback_votes v on v.topic_id = t.id
     group by t.id;
$$;

revoke all on function public.feedback_topic_tallies() from public, anon;
grant execute on function public.feedback_topic_tallies() to authenticated;

-- The first list: rows already on the roadmap's P1 table or asked for in the
-- final-feedback round, so the vote ranks work the team has already named
-- rather than promising anything new.
insert into public.feedback_topics (id, title, detail, sort_order) values
    ('dark_mode_app', 'Dark mode for the whole app', 'The reader has Night already; this is every other screen.', 10),
    ('more_story_languages', 'Write stories in more languages', 'Portuguese and Spanish first.', 20),
    ('push_notifications', 'Notifications when a chapter is ready', null, 30),
    ('reading_lists', 'Reading lists and collections', null, 40),
    ('more_voices', 'More narration voices', null, 50)
on conflict (id) do nothing;
