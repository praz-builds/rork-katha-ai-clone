-- Migration 00030: one atomic call to start a story
--
-- ## What this replaces
--
-- `generate-story` opened every generation with three sequential round trips:
--
--   1. select generation_operations   (idempotency)
--   2. insert stories
--   3. rpc reserve_generation_operation  (which deducts the credit)
--
-- Measured against the deployed function on 2026-09-04, those three cost
-- 1.4-2.2 seconds before the model was even asked for a word - roughly 11% of
-- an 18-second generation, spent entirely on latency the user cannot see the
-- point of. This collapses them into one call.
--
-- ## Why it is also a correctness fix
--
-- The story row was inserted *before* the credit was reserved, so an
-- insufficient-credit request created a story it then had to delete in a
-- separate best-effort statement. When that delete failed, the user got their
-- 402 and the project kept an orphaned row stuck in `status = 'generating'`
-- forever. Here the insert and the deduction share one transaction: if
-- `deduct_credit` raises KTH02 the story never existed, and there is nothing
-- to clean up. The same holds for the unique-violation path.
--
-- Note on `coalesce`: it is deliberately unqualified. `set search_path = ''`
-- means every real function call in these definers must be schema-qualified,
-- and `coalesce` looks like one - but it is a SQL construct resolved by the
-- parser, not a function in `pg_catalog`, so qualifying it raises
-- `42883: function pg_catalog.coalesce(integer, integer) does not exist`. It
-- also cannot be shadowed by a search_path attack, which is the reason the
-- rule exists. `reserve_generation_operation` has always used it bare.
--
-- ## Idempotency
--
-- Unchanged in meaning. An existing operation for (user_id, request_id) short
-- circuits before anything is written and reports itself, exactly as the
-- separate lookup did - so a retried request still replays rather than
-- generating and charging twice. The caller keeps the stale-reservation
-- reconciliation and the completed-replay fetch, both of which are rare paths
-- that do not belong on the hot one.

create or replace function public.begin_story_generation(
    p_user_id uuid,
    p_request_id text,
    p_title text,
    p_primary_genre text,
    p_audience_mode text,
    p_identity_lenses text[],
    p_trope_modules text[],
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

    -- Serialize per user, exactly as reserve_generation_operation does. Two
    -- concurrent first-chapter requests from one account must not both pass
    -- the idempotency check and both deduct.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
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
        order by created_at desc, id desc
        limit 1;

        -- No story is created on this path: the original request already made
        -- one, and the caller reads it by id if it needs it.
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

    -- Every column the brief supplies is written here, in one statement. The
    -- flow document's fields existed on the table after 00027 but nothing wrote
    -- them: `where_and_when` in particular has to be persisted rather than kept
    -- in the request, because regenerating a cover later needs it.
    insert into public.stories (
        author_id, title, genre, primary_genre, audience_mode,
        identity_lenses, trope_modules, spice_level, story_mode,
        topic, where_and_when, chapter_length, planned_chapter_count,
        moments, story_values, writing_style, avoid, illustrate_chapters,
        status
    ) values (
        p_user_id, p_title, array[p_primary_genre], p_primary_genre,
        p_audience_mode, p_identity_lenses, p_trope_modules, p_spice_level,
        p_story_mode, p_topic, p_where_and_when, p_chapter_length,
        p_planned_chapter_count, p_moments, p_story_values, p_writing_style,
        p_avoid, p_illustrate_chapters, 'generating'
    ) returning * into v_story;

    begin
        insert into public.generation_operations (
            user_id, request_id, story_id, chapter_number, kind
        ) values (
            p_user_id, p_request_id, v_story.id, 1, 'story'
        ) returning * into v_operation;
    exception
        when unique_violation then
            -- The `exception` block is a subtransaction: catching here rolls
            -- back only the failed insert, not the story insert above it. The
            -- re-raise is what unwinds the whole function, and with it the
            -- story - so the message matters as much as the rollback.
            raise exception using
                errcode = 'KTH01',
                message = 'Generation chapter already reserved';
    end;

    -- Raises KTH02 on an insufficient balance, which unwinds this whole
    -- transaction. That is the point: no orphaned story, no manual cleanup.
    v_balance := public.deduct_credit(
        p_user_id,
        1,
        'generation',
        v_operation.id::text,
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
    uuid, text, text, text, text, text[], text[], text, text, text, text, text, integer, text[], text[], text, text, boolean
) from public, anon, authenticated;

-- Edge functions only. It writes a story and spends a credit on the caller's
-- behalf, so it must never be reachable with a user's own JWT.
grant execute on function public.begin_story_generation(
    uuid, text, text, text, text, text[], text[], text, text, text, text, text, integer, text[], text[], text, text, boolean
) to service_role;

comment on function public.begin_story_generation(
    uuid, text, text, text, text, text[], text[], text, text, text, text, text, integer, text[], text[], text, text, boolean
) is
  'Atomically checks idempotency, creates the story and reserves one credit. Replaces three sequential round trips in generate-story, and removes the orphaned-story window on the insufficient-credit path.';

-- The first revision of this function took twelve arguments, before the merged
-- contract added chapter_length, planned_chapter_count, moments, story_values,
-- writing_style, avoid and illustrate_chapters. PostgreSQL overloads on
-- argument types, so `create or replace` above does not replace it: it creates
-- a second function beside it, and a caller passing the old shape would still
-- resolve to a definition that writes none of the brief. Drop it explicitly.
drop function if exists public.begin_story_generation(
    uuid, text, text, text, text, text[], text[], text, text, text, text, text
);
