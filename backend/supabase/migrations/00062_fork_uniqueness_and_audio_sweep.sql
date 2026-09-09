-- Migration 00062: one fork per reader per story, and audio objects that can
-- still be found after their row is gone.
--
-- Two defects in 00057, both found by review, both about data rather than
-- pixels.
--
-- 1. THE FORK RACE. `reimagine-chapter` looks for an existing fork and calls
--    `fork_story` when it finds none. Two requests from the same reader on the
--    same story -- a double tap, a retry over a slow connection, two tabs --
--    can both read "no fork" before either writes, and the reader ends up with
--    two private copies of the story, their rewrites split across them. No
--    amount of client-side care fixes that; only the database can, so the rule
--    is stated here as a constraint and `fork_story` is left to fail loudly
--    against it. The edge function catches the unique violation and reads the
--    winner's row, which is exactly what it would have found had it not raced.
--
--    Safe to create unconditionally: `forked_from_story_id` was added by 00057
--    in the same release as this file, so no deployed database can already
--    hold a duplicate pair.
--
-- 2. ORPHANED NARRATION OBJECTS. Rewriting or hand-editing a chapter deletes
--    its `chapter_audio` rows so the next Listen tap regenerates narration for
--    the prose that is actually there. The MP3s those rows pointed at stay in
--    the `audio` bucket forever, because a row delete is not an object delete.
--
--    RECORDING THE PATH IS THE FIX HERE, NOT DELETING THE OBJECT. Postgres
--    cannot delete a storage object: in Supabase the bytes live in S3 and only
--    the Storage API removes them, so a trigger that deleted from
--    `storage.objects` would drop the bookkeeping row and leave the bytes --
--    the same leak, minus the evidence. So the delete is recorded, and a
--    sweeper with a service-role key removes the objects through the Storage
--    API and marks the rows swept. An unswept row is a bill, not a bug; an
--    unrecorded object is unrecoverable.
--
--    The trigger records a path ONLY when no surviving `chapter_audio` row
--    still points at it. Two voices of one chapter, or a legacy backfill that
--    shared a path, must never have their audio swept out from under them.

-- ---------------------------------------------------------------------------
-- 1. One fork per reader per source story
-- ---------------------------------------------------------------------------

create unique index if not exists stories_fork_owner_key
    on public.stories (forked_from_story_id, author_id)
    where forked_from_story_id is not null;

comment on index public.stories_fork_owner_key is
  'A reader gets one private copy of a story, however many times they reimagine it. Enforced here because two concurrent requests can both see no fork.';

-- ---------------------------------------------------------------------------
-- 2. Storage paths left behind by a deleted chapter_audio row
-- ---------------------------------------------------------------------------

create table if not exists public.orphaned_audio_objects (
    storage_path text primary key,
    recorded_at timestamptz not null default pg_catalog.now(),
    -- Set by the sweeper once the object is gone from the bucket. Rows are
    -- kept rather than deleted so a sweep can be audited after the fact.
    swept_at timestamptz
);

comment on table public.orphaned_audio_objects is
  'Narration objects whose chapter_audio row was deleted. A service-role sweeper removes them from the audio bucket through the Storage API and sets swept_at.';

create index if not exists orphaned_audio_objects_unswept_idx
    on public.orphaned_audio_objects (recorded_at)
    where swept_at is null;

alter table public.orphaned_audio_objects enable row level security;
-- No policies: this is service-role-only bookkeeping. RLS on with no policy
-- is what makes that true for `anon` and `authenticated` rather than merely
-- undocumented.

create or replace function public.record_orphaned_audio_object()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
    if old.storage_path is null or pg_catalog.btrim(old.storage_path) = '' then
        return old;
    end if;

    -- A legacy row may hold a full public URL rather than a bucket path. It is
    -- still worth recording: the sweeper can recognise its own bucket in it,
    -- and a path it cannot parse is left unswept rather than guessed at.

    -- Still referenced by another voice's row, or by the row that replaced
    -- this one in the same statement? Then it is not an orphan.
    if exists (
        select 1 from public.chapter_audio
        where storage_path = old.storage_path
          and id <> old.id
    ) then
        return old;
    end if;

    insert into public.orphaned_audio_objects (storage_path)
    values (old.storage_path)
    on conflict (storage_path) do update
        set recorded_at = pg_catalog.now(),
            -- Re-orphaned after a sweep: it must be looked at again.
            swept_at = null;

    return old;
end;
$$;

comment on function public.record_orphaned_audio_object() is
  'After-delete trigger on chapter_audio. Records the storage path for the sweeper unless another row still points at it.';

drop trigger if exists chapter_audio_record_orphan on public.chapter_audio;
create trigger chapter_audio_record_orphan
    after delete on public.chapter_audio
    for each row
    execute function public.record_orphaned_audio_object();

grant select, insert, update, delete on public.orphaned_audio_objects to service_role;

-- ---------------------------------------------------------------------------
-- 3. A story's word count, summed and written in one statement
-- ---------------------------------------------------------------------------
--
-- `edit-story` recomputed it by SELECTing every chapter's word count and then
-- UPDATEing the story with the total. Two saves interleaving between those two
-- statements leave the story holding a total that matches neither -- the count
-- shown on every card in the app. Read and write in one statement and the
-- interleaving cannot happen: whichever save commits last writes the sum as it
-- is at that moment, which is by definition correct.

create or replace function public.recompute_story_word_count(p_story_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
    v_total integer;
begin
    update public.stories s
    set word_count = (
        select coalesce(pg_catalog.sum(c.word_count), 0)
        from public.chapters c
        where c.story_id = s.id
    )
    where s.id = p_story_id
    returning s.word_count into v_total;

    return v_total;
end;
$$;

comment on function public.recompute_story_word_count(uuid) is
  'Sums the story''s chapters into stories.word_count in one statement, so concurrent chapter saves cannot write a stale total.';

grant execute on function public.recompute_story_word_count(uuid) to service_role;
