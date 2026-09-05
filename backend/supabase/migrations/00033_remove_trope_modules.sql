-- Migration 00033: remove the retired trope contract
--
-- Tropes are no longer inferred, stored, accepted by generation, or sent to
-- the model. Values remain a separate kids-only brief field.

drop function if exists public.begin_story_generation(
    uuid, text, text, text, text, text[], text[], text, text, text, text, text,
    integer, text[], text[], text, text, boolean
);

alter table public.stories
  drop column if exists trope_modules;

create function public.begin_story_generation(
    p_user_id uuid,
    p_request_id text,
    p_title text,
    p_primary_genre text,
    p_audience_mode text,
    p_identity_lenses text[],
    p_spice_level text,
    p_story_mode text,
    p_topic text,
    p_where_and_when text,
    p_chapter_length text,
    p_planned_chapter_count integer,
    p_moments text[],
    p_story_values text[],
    p_writing_style text,
    p_avoid text,
    p_illustrate_chapters boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operation public.generation_operations;
    v_story public.stories;
    v_balance integer;
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

    insert into public.stories (
        author_id, title, genre, primary_genre, audience_mode,
        identity_lenses, spice_level, story_mode, topic, where_and_when,
        chapter_length, planned_chapter_count, moments, story_values,
        writing_style, avoid, illustrate_chapters, status
    ) values (
        p_user_id, p_title, array[p_primary_genre], p_primary_genre,
        p_audience_mode, p_identity_lenses, p_spice_level, p_story_mode,
        p_topic, p_where_and_when, p_chapter_length, p_planned_chapter_count,
        p_moments, p_story_values, p_writing_style, p_avoid,
        p_illustrate_chapters, 'generating'
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
        p_user_id, 1, 'generation', v_operation.id::text,
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
    uuid, text, text, text, text, text[], text, text, text, text, text,
    integer, text[], text[], text, text, boolean
) from public, anon, authenticated;

grant execute on function public.begin_story_generation(
    uuid, text, text, text, text, text[], text, text, text, text, text,
    integer, text[], text[], text, text, boolean
) to service_role;

comment on function public.begin_story_generation(
    uuid, text, text, text, text, text[], text, text, text, text, text,
    integer, text[], text[], text, text, boolean
) is
  'Atomically checks idempotency, creates the story and reserves one credit.';
