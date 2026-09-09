-- Migration 00057: a writer's characters outlive one story, a reader can
-- reimagine somebody else's chapter into a private copy, and a chapter can be
-- rewritten in place.
--
-- Three things a product decision made on 2026-09-09 needs from the schema:
--
--   1. **Saved characters.** `characters` is per story (00001) and always has
--      been: a writer who invents a cast for one story starts from a blank
--      sheet on the next. `user_characters` is the reusable, owner-scoped
--      library. Rows enter it automatically when a story finishes generating
--      (`remember_story_characters`, service-only, called after
--      `complete_story_generation`) and the writer can pull any of them into
--      a new brief. Deduplicated per owner on the lower-cased trimmed name,
--      because "Aarav" and "aarav" are the same person to the writer.
--
--   2. **Forks.** Reimagining a chapter of a story you do not own must not
--      touch the original. `fork_story` copies the story, its chapters and its
--      cast into a private story owned by the caller, and records where it
--      came from in `stories.forked_from_story_id`. The copy inherits
--      `entity_gate_reason`, so a story that could not be published stays
--      unpublishable in every copy - the 00050 CHECK constraint sees a fork as
--      just another row. Copies are built with `jsonb_populate_record` over
--      `to_jsonb(row)` so a column added to `stories` or `chapters` after this
--      migration is copied too instead of silently dropped.
--
--   3. **Reimagine as a generation operation.** A rewrite costs a credit like
--      a continuation and needs the same reservation, replay and refund
--      lifecycle, so it is a new `generation_operations.kind` rather than a
--      side table. `reserve_generation_operation` is re-issued with the kind
--      admitted (the function body is 00040's, unchanged apart from the list),
--      and `complete_reimagine_generation` is the counterpart to
--      `complete_continuation_generation` that UPDATES the existing chapter
--      row instead of inserting a new one. The existing partial unique index
--      on (story_id, chapter_number) where status = 'reserved' is what makes
--      "this chapter is already being rewritten" a `KTH01`, exactly as it does
--      for a continuation.
--
-- Narration for a rewritten chapter is deleted, not kept: `chapter_audio` rows
-- are keyed by chapter id and would otherwise read the old prose aloud.

-- ---------------------------------------------------------------------------
-- 1. user_characters
-- ---------------------------------------------------------------------------

create table if not exists public.user_characters (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references public.profiles(id) on delete cascade,
    name text not null
        check (pg_catalog.char_length(pg_catalog.btrim(name)) between 1 and 100),
    description text check (description is null or pg_catalog.char_length(description) <= 500),
    background text check (background is null or pg_catalog.char_length(background) <= 500),
    appearance text check (appearance is null or pg_catalog.char_length(appearance) <= 500),
    portrait_url text,
    source_story_id uuid references public.stories(id) on delete set null,
    created_at timestamptz not null default pg_catalog.now(),
    updated_at timestamptz not null default pg_catalog.now()
);

comment on table public.user_characters is
  'A writer''s reusable cast. Filled automatically when a story finishes generating; one row per owner per lower-cased name.';

create unique index if not exists user_characters_owner_name_key
    on public.user_characters (owner_id, (pg_catalog.lower(pg_catalog.btrim(name))));

create index if not exists user_characters_owner_created_idx
    on public.user_characters (owner_id, created_at desc);

alter table public.user_characters enable row level security;

create policy "Users read own saved characters"
    on public.user_characters for select
    using (auth.uid() = owner_id);

create policy "Users add own saved characters"
    on public.user_characters for insert
    with check (auth.uid() = owner_id);

create policy "Users update own saved characters"
    on public.user_characters for update
    using (auth.uid() = owner_id)
    with check (auth.uid() = owner_id);

create policy "Users delete own saved characters"
    on public.user_characters for delete
    using (auth.uid() = owner_id);

grant select, insert, update, delete on public.user_characters to authenticated;

-- A story character can remember which saved character it was made from, so
-- a portrait paid for once travels with the person rather than the story.
alter table public.characters
    add column if not exists saved_character_id uuid
        references public.user_characters(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. Forks
-- ---------------------------------------------------------------------------

alter table public.stories
    add column if not exists forked_from_story_id uuid
        references public.stories(id) on delete set null;

comment on column public.stories.forked_from_story_id is
  'Set on a private copy made by reimagine-chapter for a reader who does not own the source. Null for an original.';

create index if not exists stories_forked_from_idx
    on public.stories (forked_from_story_id)
    where forked_from_story_id is not null;

create or replace function public.fork_story(
    p_source_story_id uuid,
    p_new_author_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_source public.stories;
    v_new_id uuid := gen_random_uuid();
begin
    if p_new_author_id is null then
        raise exception 'Fork needs an author';
    end if;

    select * into v_source
    from public.stories
    where id = p_source_story_id;

    if not found then
        raise exception 'Story not found';
    end if;
    if v_source.author_id = p_new_author_id then
        raise exception 'Cannot fork your own story';
    end if;
    if v_source.status <> 'complete' then
        raise exception 'Story is not complete';
    end if;
    -- The same rule the reader was already subject to when they opened it.
    if not (coalesce(v_source.is_public, false) or coalesce(v_source.is_curated, false)) then
        raise exception 'Story is not available to fork';
    end if;

    -- Every column, with the identity and the counters replaced. Keys that
    -- name no column are ignored by jsonb_populate_record, so the override
    -- list may be generous.
    insert into public.stories
    select (pg_catalog.jsonb_populate_record(
        null::public.stories,
        pg_catalog.to_jsonb(v_source) || pg_catalog.jsonb_build_object(
            'id', v_new_id,
            'author_id', p_new_author_id,
            'is_public', false,
            'is_curated', false,
            'forked_from_story_id', v_source.id,
            'created_at', pg_catalog.now(),
            'read_count', 0,
            'unique_reader_count', 0,
            'like_count', 0,
            'bookmark_count', 0,
            'comment_count', 0,
            'share_count', 0,
            'follower_count', 0,
            'credits_earned', 0,
            'cover_regen_count', 0,
            'cover_attempt_count', 0,
            'cover_last_request_id', null
        )
    )).*;

    insert into public.chapters
    select (pg_catalog.jsonb_populate_record(
        null::public.chapters,
        pg_catalog.to_jsonb(c) || pg_catalog.jsonb_build_object(
            'id', gen_random_uuid(),
            'story_id', v_new_id,
            'is_published', false,
            'published_at', null,
            'audio_url', null,
            'created_at', pg_catalog.now()
        )
    )).*
    from public.chapters c
    where c.story_id = p_source_story_id;

    insert into public.characters
    select (pg_catalog.jsonb_populate_record(
        null::public.characters,
        pg_catalog.to_jsonb(ch) || pg_catalog.jsonb_build_object(
            'id', gen_random_uuid(),
            'story_id', v_new_id,
            'saved_character_id', null
        )
    )).*
    from public.characters ch
    where ch.story_id = p_source_story_id;

    return v_new_id;
end;
$$;

revoke all on function public.fork_story(uuid, uuid) from public, anon, authenticated;
grant execute on function public.fork_story(uuid, uuid) to service_role;
comment on function public.fork_story(uuid, uuid)
    is 'Service-only. Private copy of a readable story (row, chapters, cast) for a reader who is not its author.';

-- ---------------------------------------------------------------------------
-- 3. Reimagine as a generation operation
-- ---------------------------------------------------------------------------

alter table public.generation_operations
    drop constraint if exists generation_operations_kind_check;
alter table public.generation_operations
    add constraint generation_operations_kind_check
    check (kind in ('story', 'continuation', 'cover', 'chapter_art', 'characters', 'reimagine'));

-- 00040's body, with 'reimagine' admitted. Nothing else changes.
CREATE OR REPLACE FUNCTION public.reserve_generation_operation(
    p_user_id uuid,
    p_request_id text,
    p_story_id uuid,
    p_chapter_number integer,
    p_kind text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
declare
    v_operation public.generation_operations;
    v_balance integer;
begin
    if p_request_id is null
       or pg_catalog.btrim(p_request_id) = ''
       or pg_catalog.char_length(p_request_id) > 128 then
        raise exception 'Invalid generation request ID';
    end if;

    if p_chapter_number <= 0
       or p_kind not in ('story', 'continuation', 'cover', 'chapter_art', 'characters', 'reimagine') then
        raise exception 'Invalid generation operation';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_story_id::text, 1)
    );

    select *
    into v_operation
    from public.generation_operations
    where user_id = p_user_id
      and request_id = p_request_id
    order by created_at desc, id desc
    limit 1;

    if found then
        select balance_after
        into v_balance
        from public.credit_ledger
        where user_id = p_user_id
        order by created_at desc, ledger_sequence desc
        limit 1;

        return pg_catalog.jsonb_build_object(
            'id', v_operation.id,
            'story_id', v_operation.story_id,
            'chapter_number', v_operation.chapter_number,
            'status', v_operation.status,
            'result_chapter_id', v_operation.result_chapter_id,
            'replayed', true,
            'balance', coalesce(v_balance, 0)
        );
    end if;

    begin
        insert into public.generation_operations (
            user_id,
            request_id,
            story_id,
            chapter_number,
            kind
        ) values (
            p_user_id,
            p_request_id,
            p_story_id,
            p_chapter_number,
            p_kind
        ) returning * into v_operation;
    exception
        when unique_violation then
            raise exception using
                errcode = 'KTH01',
                message = 'Generation chapter already reserved';
    end;

    v_balance := public.deduct_credit(
        p_user_id,
        1,
        'generation',
        v_operation.id::text,
        'generation:' || v_operation.id::text
    );

    return pg_catalog.jsonb_build_object(
        'id', v_operation.id,
        'story_id', v_operation.story_id,
        'chapter_number', v_operation.chapter_number,
        'status', v_operation.status,
        'result_chapter_id', v_operation.result_chapter_id,
        'replayed', false,
        'balance', coalesce(v_balance, 0)
    );
end;
$$;

revoke all on function public.reserve_generation_operation(uuid, text, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.reserve_generation_operation(uuid, text, uuid, integer, text) to service_role;

create or replace function public.complete_reimagine_generation(
    p_operation_id uuid,
    p_user_id uuid,
    p_title text,
    p_content text,
    p_word_count integer,
    p_first_line text default null,
    p_previously_summary text default null,
    p_series_state jsonb default '{}'::jsonb,
    p_hook_type text default 'none',
    p_hook_text text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operation public.generation_operations;
    v_chapter public.chapters;
    v_old_words integer;
    v_is_latest boolean;
    v_hook_type text := coalesce(p_hook_type, 'none');
begin
    select * into v_operation
    from public.generation_operations
    where id = p_operation_id
      and user_id = p_user_id
      and kind = 'reimagine'
      and status = 'reserved'
    for update;

    if not found then
        raise exception 'Reserved reimagine operation not found';
    end if;

    if p_content is null or pg_catalog.btrim(p_content) = '' then
        raise exception 'Chapter content is required';
    end if;

    if v_hook_type not in (
      'none', 'revelation', 'reversal', 'decision', 'arrival', 'betrayal',
      'danger', 'unanswered_question', 'emotional_rupture'
    ) then
        raise exception 'Invalid hook type';
    end if;

    select * into v_chapter
    from public.chapters
    where story_id = v_operation.story_id
      and chapter_number = v_operation.chapter_number
    for update;

    if not found then
        raise exception 'Chapter to reimagine not found';
    end if;

    v_old_words := coalesce(v_chapter.word_count, 0);
    v_is_latest := not exists (
        select 1 from public.chapters
        where story_id = v_operation.story_id
          and chapter_number > v_operation.chapter_number
    );

    update public.chapters
    set title = coalesce(nullif(pg_catalog.btrim(p_title), ''), title),
        content = p_content,
        word_count = p_word_count,
        first_line = p_first_line,
        previously_summary = p_previously_summary,
        -- A standalone or a finale ends nowhere by definition, whatever the
        -- model wrote in its metadata.
        hook_type = case when chapter_role in ('standalone', 'finale') then 'none' else v_hook_type end,
        hook_text = case when chapter_role in ('standalone', 'finale') then null else p_hook_text end,
        audio_url = null
    where id = v_chapter.id
    returning * into v_chapter;

    -- Narration read the old prose. Dropping the rows is what lets the next
    -- Listen tap generate it afresh instead of playing a chapter that no
    -- longer exists.
    delete from public.chapter_audio where chapter_id = v_chapter.id;

    update public.stories
    set word_count = greatest(0, coalesce(word_count, 0) - v_old_words + p_word_count),
        -- Continuity is only rewritten when the rewritten chapter is the last
        -- one: a chapter in the middle of a series does not get to overwrite
        -- the state later chapters were written from.
        series_state = case
            when v_is_latest and p_series_state is not null and p_series_state <> '{}'::jsonb
              then p_series_state
            else series_state
        end,
        previously_summary = case
            when v_is_latest then coalesce(p_previously_summary, previously_summary)
            else previously_summary
        end
    where id = v_operation.story_id;

    update public.generation_operations
    set status = 'completed',
        result_chapter_id = v_chapter.id,
        updated_at = pg_catalog.now()
    where id = p_operation_id;

    return pg_catalog.to_jsonb(v_chapter);
end;
$$;

revoke all on function public.complete_reimagine_generation(
  uuid, uuid, text, text, integer, text, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.complete_reimagine_generation(
  uuid, uuid, text, text, integer, text, text, jsonb, text, text
) to service_role;
comment on function public.complete_reimagine_generation(
  uuid, uuid, text, text, integer, text, text, jsonb, text, text
) is 'Service-only. Rewrites an existing chapter in place, drops its narration, and completes the reimagine operation.';

-- ---------------------------------------------------------------------------
-- 4. Remembering a story's cast
-- ---------------------------------------------------------------------------

create or replace function public.remember_story_characters(
    p_user_id uuid,
    p_story_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_inserted integer;
begin
    if p_user_id is null or p_story_id is null then
        return 0;
    end if;

    insert into public.user_characters
        (owner_id, name, description, background, appearance, portrait_url, source_story_id)
    select p_user_id,
           pg_catalog.btrim(c.name),
           pg_catalog.left(c.description, 500),
           pg_catalog.left(c.background, 500),
           pg_catalog.left(c.appearance, 500),
           c.portrait_url,
           c.story_id
    from public.characters c
    join public.stories s on s.id = c.story_id
    where c.story_id = p_story_id
      and s.author_id = p_user_id
      and pg_catalog.char_length(pg_catalog.btrim(c.name)) between 1 and 100
    on conflict (owner_id, (pg_catalog.lower(pg_catalog.btrim(name)))) do nothing;

    get diagnostics v_inserted = row_count;
    return v_inserted;
end;
$$;

revoke all on function public.remember_story_characters(uuid, uuid) from public, anon, authenticated;
grant execute on function public.remember_story_characters(uuid, uuid) to service_role;
comment on function public.remember_story_characters(uuid, uuid)
    is 'Service-only. Copies a story''s cast into the author''s saved characters, skipping names already saved.';

-- The same thing from the client, scoped to the caller. Lets a writer save the
-- cast of a story generated before this migration existed.
create or replace function public.save_my_story_characters(
    p_story_id uuid
) returns integer
language sql
security definer
set search_path = ''
as $$
    select public.remember_story_characters(auth.uid(), p_story_id);
$$;

revoke all on function public.save_my_story_characters(uuid) from public, anon;
grant execute on function public.save_my_story_characters(uuid) to authenticated;
