-- Migration 00040: one tie-breaker for credit_ledger, everywhere
--
-- 00026 added `credit_ledger.ledger_sequence` for exactly one purpose: rows
-- written inside a single transaction share a `created_at`, so `created_at`
-- alone does not order them. Its own comment says so. `deduct_credit`,
-- `grant_credit` and `ensure_credit_balance_buckets` were written against it,
-- but every other balance read still ordered by `created_at desc, id desc` --
-- and `id` is a random uuid, so among rows sharing a timestamp the "latest"
-- balance was decided by a coin flip.
--
-- This is not theoretical. `refresh_subscription_grant` writes a lapse row and
-- a grant row in one transaction with identical `created_at`, so roughly half
-- of all renewals reported the pre-grant balance to the client afterwards.
--
-- Each function below is reproduced from its current definition -- the highest
-- numbered migration that defines it, which is not always the one that
-- introduced it -- with the ordering as the only change:
--
--   create_feedback               00005 (two reads)
--   reserve_generation_operation  00027 (one read)
--   refund_generation_operation   00034 (two reads)
--   begin_story_generation        00036 (one read)
--
-- Orderings on `generation_operations` and `comments` keep `id desc`: neither
-- table has a sequence column, and neither read is a balance.


-- -------------------------------------------------------------------------
-- create_feedback
-- -------------------------------------------------------------------------

create or replace function public.create_feedback(
    p_user_id uuid,
    p_request_id text,
    p_story_id uuid,
    p_chapter_id uuid,
    p_content text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_story_author_id uuid;
    v_story_is_public boolean;
    v_story_is_curated boolean;
    v_comment public.comments;
    v_balance integer;
    v_credit_granted boolean := false;
begin
    if p_request_id is null
       or pg_catalog.btrim(p_request_id) = ''
       or pg_catalog.char_length(p_request_id) > 128 then
        raise exception 'Invalid feedback request ID';
    end if;

    if p_content is null
       or pg_catalog.btrim(p_content) = ''
       or pg_catalog.char_length(pg_catalog.btrim(p_content)) > 2000 then
        raise exception 'Feedback must contain between 1 and 2000 characters';
    end if;

    select author_id, is_public, is_curated
    into v_story_author_id, v_story_is_public, v_story_is_curated
    from public.stories
    where id = p_story_id;

    if not found or not (
        coalesce(v_story_is_public, false)
        or coalesce(v_story_is_curated, false)
    ) then
        raise exception using
            errcode = 'KTH03',
            message = 'Story not found';
    end if;

    if p_chapter_id is not null and not exists (
        select 1
        from public.chapters
        where id = p_chapter_id
          and story_id = p_story_id
    ) then
        raise exception using
            errcode = 'KTH04',
            message = 'Chapter not found';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );

    select *
    into v_comment
    from public.comments
    where user_id = p_user_id
      and request_id = p_request_id
    order by created_at desc, id desc
    limit 1;

    if found then
        if v_comment.story_id is distinct from p_story_id then
            raise exception using
                errcode = 'KTH05',
                message = 'Feedback request belongs to another story';
        end if;

        select balance_after
        into v_balance
        from public.credit_ledger
        where user_id = p_user_id
        order by created_at desc, ledger_sequence desc
        limit 1;

        return pg_catalog.jsonb_build_object(
            'comment', pg_catalog.to_jsonb(v_comment),
            'credit_granted', v_comment.reward_granted,
            'balance', coalesce(v_balance, 0),
            'replayed', true
        );
    end if;

    insert into public.comments (
        user_id,
        story_id,
        chapter_id,
        content,
        request_id
    ) values (
        p_user_id,
        p_story_id,
        p_chapter_id,
        pg_catalog.btrim(p_content),
        p_request_id
    ) returning * into v_comment;

    select balance_after
    into v_balance
    from public.credit_ledger
    where user_id = p_user_id
    order by created_at desc, ledger_sequence desc
    limit 1;
    v_balance := coalesce(v_balance, 0);

    if v_story_author_id is distinct from p_user_id
       and not exists (
           select 1
           from public.credit_ledger
           where user_id = p_user_id
             and reason = 'feedback'
             and reference_id = p_story_id::text
       )
       and not exists (
           select 1
           from public.credit_ledger
           where user_id = p_user_id
             and reason = 'feedback'
             and created_at >= (
                 pg_catalog.date_trunc(
                     'day',
                     pg_catalog.now() at time zone 'UTC'
                 ) at time zone 'UTC'
             )
       ) then
        v_balance := public.grant_credit(
            p_user_id,
            1,
            'feedback',
            p_story_id::text,
            'feedback:' || p_story_id::text
        );
        v_credit_granted := true;

        update public.comments
        set reward_granted = true
        where id = v_comment.id
        returning * into v_comment;
    end if;

    return pg_catalog.jsonb_build_object(
        'comment', pg_catalog.to_jsonb(v_comment),
        'credit_granted', v_credit_granted,
        'balance', v_balance,
        'replayed', false
    );
end;
$$;


-- -------------------------------------------------------------------------
-- reserve_generation_operation
-- -------------------------------------------------------------------------

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
       or p_kind not in ('story', 'continuation', 'cover', 'chapter_art', 'characters') then
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


-- -------------------------------------------------------------------------
-- refund_generation_operation
-- -------------------------------------------------------------------------

create or replace function public.refund_generation_operation(
    p_operation_id uuid,
    p_user_id uuid,
    p_error text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operation public.generation_operations;
    v_balance integer;
    v_expected_refund integer;
    v_original_debit integer;
begin
    select *
    into v_operation
    from public.generation_operations
    where id = p_operation_id
      and user_id = p_user_id
    for update;

    if not found then
        raise exception 'Generation operation not found';
    end if;

    select balance_after
    into v_balance
    from public.credit_ledger
    where user_id = p_user_id
    order by created_at desc, ledger_sequence desc
    limit 1;
    v_balance := coalesce(v_balance, 0);

    if v_operation.status = 'completed' then
        return pg_catalog.jsonb_build_object(
            'status', v_operation.status,
            'balance', v_balance,
            'refunded', false,
            'result_chapter_id', v_operation.result_chapter_id
        );
    end if;

    if v_operation.status = 'refunded' then
        return pg_catalog.jsonb_build_object(
            'status', v_operation.status,
            'balance', v_balance,
            'refunded', false,
            'result_chapter_id', v_operation.result_chapter_id
        );
    end if;

    if v_operation.status = 'reserved' then
        v_expected_refund := case
            when v_operation.kind = 'story' then 3
            else 1
        end;

        select -amount
        into v_original_debit
        from public.credit_ledger
        where user_id = p_user_id
          and reason = 'generation'
          and reference_id = v_operation.id::text
          and amount < 0
        order by created_at desc, ledger_sequence desc
        limit 1;

        if v_original_debit is not null then
            v_expected_refund := least(v_expected_refund, v_original_debit);
        end if;

        v_balance := public.grant_credit(
            p_user_id,
            v_expected_refund,
            'refund',
            v_operation.id::text,
            'refund:' || v_operation.id::text
        );

        update public.generation_operations
        set status = 'refunded',
            last_error = pg_catalog.left(p_error, 1000),
            updated_at = pg_catalog.now()
        where id = p_operation_id;

        if v_operation.kind = 'story' then
            update public.stories
            set status = 'failed'
            where id = v_operation.story_id
              and status = 'generating';
        end if;
    end if;

    return pg_catalog.jsonb_build_object(
        'status', 'refunded',
        'balance', v_balance,
        'refunded', true
    );
end;
$$;


-- -------------------------------------------------------------------------
-- begin_story_generation
-- -------------------------------------------------------------------------

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


revoke all on function public.create_feedback(uuid, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_feedback(uuid, text, uuid, uuid, text) to service_role;

revoke all on function public.reserve_generation_operation(uuid, text, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.reserve_generation_operation(uuid, text, uuid, integer, text) to service_role;

revoke all on function public.refund_generation_operation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.refund_generation_operation(uuid, uuid, text) to service_role;

revoke all on function public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean, text[]
) from public, anon, authenticated;

grant execute on function public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean, text[]
) to service_role;
