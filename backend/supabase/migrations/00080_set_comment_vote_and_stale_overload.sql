-- Migration 00080: comment voting has never worked in production. This is the
-- second attempt to fix it, and the first one is the reason it is still broken.
--
-- ## What is wrong right now
--
-- `public.set_comment_vote` does not exist on the live database. Confirmed
-- 2026-09-11 three ways: absent from `pg_proc` in every schema, absent from
-- PostgREST's `/rpc/` listing, and `public.comment_votes` has never held a
-- single row. Every upvote and downvote since the feature shipped has returned
-- PGRST202 through `comments/index.ts`, which maps only `23503` and therefore
-- rethrows it as a 500.
--
-- ## Why it went missing, and why it went missing TWICE
--
-- The function was added to `00043_threaded_comments_moderation.sql` during
-- review, after 00043 had already been applied to the live project. A migration
-- runner keys off the version number, so an environment that has recorded 00043
-- never sees the edited file. A fresh checkout creates the function; production
-- does not. Every test passed the entire time, because the test harness builds a
-- clean database from the edited 00043.
--
-- That was diagnosed correctly at the time. Commit `cac250c` added
-- `00044_set_comment_vote_backfill.sql` to repair it, and its comment spelled
-- out this exact failure mode in detail.
--
-- It was then lost to a NUMBER COLLISION. PR #59 landed
-- `00044_cover_regeneration.sql` the same day, at the same number. Remote
-- `schema_migrations` records version `00044` as `cover_regeneration`, the
-- backfill file is gone from the tree, and the fix never ran anywhere. A
-- migration whose own comment predicted this class of bug was erased by it.
--
-- ## Why this file takes its number from the remote, not the directory
--
-- `AGENTS.md` requires the next number to come from `supabase migration list`
-- rather than a local listing, and this is the incident that rule exists for.
-- Remote is at `00078`; `00079` is claimed by concurrent work on this branch;
-- this is `00080`.
--
-- The body is copied verbatim from 00043 and `create or replace` makes it a
-- no-op where the function already exists, so this is safe to apply to a fresh
-- database and to production alike. Editing an applied migration is what caused
-- the original divergence; the fix is forward-only, always.

create or replace function public.set_comment_vote(
    p_comment_id uuid,
    p_value smallint
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        raise exception 'not authenticated' using errcode = '42501';
    end if;

    if p_value not in (-1, 0, 1) then
        raise exception 'invalid vote value' using errcode = '22023';
    end if;

    if not exists (
        select 1
        from public.comments c
        join public.stories s on s.id = c.story_id
        where c.id = p_comment_id
          and (
              s.is_public = true
              or s.is_curated = true
              or s.author_id = v_user_id
          )
    ) then
        raise exception 'comment not found' using errcode = '23503';
    end if;

    if p_value = 0 then
        delete from public.comment_votes
        where user_id = v_user_id
          and comment_id = p_comment_id;
        return;
    end if;

    insert into public.comment_votes (user_id, comment_id, value)
    values (v_user_id, p_comment_id, p_value)
    on conflict (user_id, comment_id) do update
    set value = excluded.value
    where public.comment_votes.value is distinct from excluded.value;
end;
$$;

revoke all on function public.set_comment_vote(uuid, smallint) from public;
grant execute on function public.set_comment_vote(uuid, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- A stale overload of complete_story_generation
-- ---------------------------------------------------------------------------
-- 00005 created a 6-argument `complete_story_generation`; a later migration
-- created the 16-argument one every caller now uses and never dropped the
-- original. Both are live, and it is the only function in `public` with more
-- than one overload.
--
-- Harmless today purely by luck: `generate-story` and `generate-story-stream`
-- pass all sixteen parameters by name, which cannot match the 6-argument
-- version. The day somebody trims a call site to the fields they need, the
-- resolution becomes ambiguous and PostgREST answers `PGRST203` on a paid
-- generation that has already reserved its credit.
--
-- Dropped by exact signature so this cannot touch the version in use.

-- The signature is copied from 00005's own revoke/grant lines, not guessed.
-- `drop function if exists` with a wrong signature is a SILENT no-op: it would
-- have reported success and left both overloads in place, which is a worse
-- outcome than not writing this at all. It is three uuids, not two.

drop function if exists public.complete_story_generation(
    uuid, uuid, uuid, text, text, integer
);
