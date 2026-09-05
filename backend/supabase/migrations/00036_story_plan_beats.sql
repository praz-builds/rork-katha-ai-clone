-- Migration 00036: the story plan
--
-- The blueprint screen shows the reader an ordered outline before they pay, and
-- until now nothing stored it. Chapters were generated one at a time with no
-- plan, so the outline a user approved was never the outline the story
-- followed. `stories.beats` closes that gap: beat N is the brief for chapter N,
-- and the remaining beats are forward context so the model paces toward them.
--
-- Nullable and empty-defaulted, so every existing story keeps generating exactly
-- as it does today.

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS beats text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.stories.beats IS
  'The ordered chapter plan shown on the blueprint screen. Beat N briefs chapter N; the rest are forward context. Length is clamped to planned_chapter_count in validation.ts. Distinct from stories.moments, which are unordered beats the user pinned and the model schedules where it likes.';

-- A plan longer than the story is a contradiction, not a preference: it would
-- promise beats that no chapter can ever reach. Empty stays legal, because a
-- story created before the blueprint existed has no plan and must not break.
ALTER TABLE public.stories
  ADD CONSTRAINT stories_beats_within_planned_length
  CHECK (
    beats = '{}'
    OR planned_chapter_count IS NULL
    OR pg_catalog.array_length(beats, 1) <= planned_chapter_count
  )
  NOT VALID;

-- ---------------------------------------------------------------------------
-- begin_story_generation, with the plan
-- ---------------------------------------------------------------------------
-- PostgreSQL overloads on argument types, so `create or replace` with a new
-- parameter would create a second function beside the old one rather than
-- replacing it, and a caller could still resolve to the definition that writes
-- no plan. Drop the previous shape explicitly, exactly as 00033 and 00034 did.

drop function if exists public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean
);

create function public.begin_story_generation(
    p_user_id uuid,
    p_request_id text,
    p_title text,
    p_primary_genre text,
    p_genres text[],
    p_audience_mode text,
    p_identity_lenses text[],
    p_spice_level text,
    p_story_mode text,
    p_topic text,
    p_language text,
    p_where_and_when text,
    p_chapter_length text,
    p_planned_chapter_count integer,
    p_moments text[],
    p_story_values text[],
    p_writing_style text,
    p_avoid text,
    p_illustrate_chapters boolean,
    p_beats text[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operation public.generation_operations;
    v_story public.stories;
    v_balance integer;
    v_genres text[];
    v_beats text[];
begin
    if p_request_id is null
       or pg_catalog.btrim(p_request_id) = ''
       or pg_catalog.char_length(p_request_id) > 128 then
        raise exception 'Invalid generation request ID';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );

    select * into v_operation
    from public.generation_operations
    where user_id = p_user_id and request_id = p_request_id
    order by created_at desc, id desc
    limit 1;

    if found then
        select balance_after into v_balance
        from public.credit_ledger
        where user_id = p_user_id
        order by created_at desc, id desc
        limit 1;

        return pg_catalog.jsonb_build_object(
            'replayed', true,
            'operation_id', v_operation.id,
            'story_id', v_operation.story_id,
            'chapter_number', v_operation.chapter_number,
            'status', v_operation.status,
            'result_chapter_id', v_operation.result_chapter_id,
            'updated_at', v_operation.updated_at,
            'balance', coalesce(v_balance, 0)
        );
    end if;

    v_genres := case
        when p_genres is null or pg_catalog.cardinality(p_genres) = 0
            then array[p_primary_genre]
        else p_genres
    end;

    -- validation.ts already clamps the plan to the planned length. Clamping
    -- again here is not redundant: the check constraint added above would
    -- otherwise abort the whole transaction, and a plan one beat too long is
    -- not a reason to refuse to write someone's story.
    v_beats := case
        when p_beats is null then '{}'::text[]
        when p_planned_chapter_count is null then p_beats
        else p_beats[1:p_planned_chapter_count]
    end;

    insert into public.stories (
        author_id, title, genre, primary_genre, audience_mode,
        identity_lenses, spice_level, story_mode, topic, language, where_and_when,
        chapter_length, planned_chapter_count, moments, story_values,
        writing_style, avoid, illustrate_chapters, beats, status
    ) values (
        p_user_id, p_title, v_genres, p_primary_genre,
        p_audience_mode, p_identity_lenses, p_spice_level, p_story_mode,
        p_topic, p_language, p_where_and_when, p_chapter_length, p_planned_chapter_count,
        p_moments, p_story_values, p_writing_style, p_avoid,
        p_illustrate_chapters, v_beats, 'generating'
    ) returning * into v_story;

    begin
        insert into public.generation_operations (
            user_id, request_id, story_id, chapter_number, kind
        ) values (
            p_user_id, p_request_id, v_story.id, 1, 'story'
        ) returning * into v_operation;
    exception when unique_violation then
        raise exception using
            errcode = 'KTH01',
            message = 'Generation chapter already reserved';
    end;

    v_balance := public.deduct_credit(
        p_user_id, 3, 'generation', v_operation.id::text,
        'generation:' || v_operation.id::text
    );

    return pg_catalog.jsonb_build_object(
        'replayed', false,
        'operation_id', v_operation.id,
        'story_id', v_story.id,
        'chapter_number', v_operation.chapter_number,
        'status', v_operation.status,
        'result_chapter_id', v_operation.result_chapter_id,
        'balance', v_balance,
        'story', pg_catalog.to_jsonb(v_story)
    );
end;
$$;

revoke all on function public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean, text[]
) from public, anon, authenticated;

grant execute on function public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean, text[]
) to service_role;

comment on function public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean, text[]
) is
  'Atomically checks idempotency, creates the story with its approved chapter plan, and reserves three credits.';

-- The constraint was added NOT VALID so the migration never has to scan the
-- table. Every existing row has beats = '{}' and therefore satisfies it
-- trivially, so validating is cheap and leaves no unenforced contract behind.
ALTER TABLE public.stories
  VALIDATE CONSTRAINT stories_beats_within_planned_length;
