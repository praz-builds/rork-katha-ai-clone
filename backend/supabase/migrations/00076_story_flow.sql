-- Migration 00076: whether the writer drives the story, or watches it drive
-- itself.
--
-- The Create brief now carries a *Story mode* pick. 'interactive' is what the
-- app has always done: at the end of a chapter the reader is offered direction
-- chips and nothing is written until one is chosen. 'auto' is the writer saying
-- they do not want to be asked -- the same flow, with the direction chosen for
-- them and the next chapter written straight away.
--
-- WHY IT IS A COLUMN AND NOT A REQUEST FIELD. The pick is made once, in the
-- brief, and it has to be honoured at every chapter end afterwards -- which is
-- a different session, often a different day, and always a surface that has
-- nothing but the story row to read from. A pick that lived only in the body of
-- the request that wrote chapter one would be forgotten by the time chapter two
-- was offered, which is the only moment it means anything.
--
-- NOT NULL defaulting to 'interactive'. Every story written before this
-- migration asked before it spent, and that is what 'interactive' says; there
-- is no story for which the answer is unknown. It is also the safe direction
-- for a value that somehow goes missing: being asked an unnecessary question
-- costs a tap, and not being asked costs a credit.

alter table public.stories
    add column if not exists story_flow text not null default 'interactive';

alter table public.stories
    drop constraint if exists stories_story_flow_check;

alter table public.stories
    add constraint stories_story_flow_check
    check (story_flow in ('interactive', 'auto'));

comment on column public.stories.story_flow is
    'How the next chapter is chosen. ''interactive'': the reader picks a direction chip at the chapter end and nothing is written until they do. ''auto'': the direction is chosen for them and the next chapter follows. Read at every chapter end, which is why it is a column and not a field on the request that created the story.';


-- ---------------------------------------------------------------------------
-- begin_story_generation
-- ---------------------------------------------------------------------------
-- Unchanged from 00075 apart from the new last parameter and the column it
-- writes. Dropped and recreated for the same reason 00075 was: a parameter
-- list of a different length is a different function to Postgres, so
-- `create or replace` would leave the 21-argument version standing beside this
-- one and make a 21-argument call ambiguous. The new parameter goes LAST and
-- carries a default, so a `generate-story` deploy that predates it still
-- resolves here during the window where code and schema disagree.

drop function if exists public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean, text[], text
);

create or replace function public.begin_story_generation(
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
    p_beats text[],
    p_image_style text default 'auto',
    p_story_flow text default 'interactive'
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
    v_image_style text;
    v_story_flow text;
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
        order by created_at desc, ledger_sequence desc
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

    -- Same reasoning as the beat clamp, and the same failure it prevents.
    -- validation.ts already maps an unknown style to 'auto', but a value this
    -- function did not recognise would hit stories_image_style_check and abort
    -- the transaction -- so a stale client sending a style that has since been
    -- renamed would fail the whole paid generation rather than get the default
    -- look. `lower` and `btrim` are real functions and must be qualified under
    -- `search_path = ''`; `coalesce` is a parser construct and must NOT be
    -- (migration 00071).
    v_image_style := pg_catalog.lower(
        pg_catalog.btrim(coalesce(p_image_style, 'auto'))
    );
    if v_image_style not in ('auto', 'anime', 'cinematic', 'comic', 'watercolor')
    then
        v_image_style := 'auto';
    end if;

    -- Clamped for exactly the reason the style above is: an unrecognised
    -- value would hit stories_story_flow_check and abort the transaction
    -- that also deducts three credits, so a stale client would fail a paid
    -- generation over a preference. 'interactive' is the safe direction to
    -- fall back to: it is the mode that asks before it spends.
    v_story_flow := pg_catalog.lower(
        pg_catalog.btrim(coalesce(p_story_flow, 'interactive'))
    );
    if v_story_flow not in ('interactive', 'auto') then
        v_story_flow := 'interactive';
    end if;

    insert into public.stories (
        author_id, title, genre, primary_genre, audience_mode,
        identity_lenses, spice_level, story_mode, topic, language, where_and_when,
        chapter_length, planned_chapter_count, moments, story_values,
        writing_style, avoid, illustrate_chapters, beats, image_style,
        story_flow, status
    ) values (
        p_user_id, p_title, v_genres, p_primary_genre,
        p_audience_mode, p_identity_lenses, p_spice_level, p_story_mode,
        p_topic, p_language, p_where_and_when, p_chapter_length, p_planned_chapter_count,
        p_moments, p_story_values, p_writing_style, p_avoid,
        p_illustrate_chapters, v_beats, v_image_style, v_story_flow, 'generating'
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
    text, text, integer, text[], text[], text, text, boolean, text[], text, text
) from public, anon, authenticated;

grant execute on function public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean, text[], text, text
) to service_role;

comment on function public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean, text[], text, text
) is 'Service-only. Idempotency check, story row and credit reservation in one transaction. p_image_style and p_story_flow are the writer''s Image style and Story mode picks; both are clamped to their allowed set rather than trusted, so a stale client cannot abort a paid generation on a check constraint.';
