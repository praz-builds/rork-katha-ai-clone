-- Migration 00075: the writer's picture style is part of the story, not part
-- of the request that started it.
--
-- The Create brief now carries an *Image style* pick -- auto, anime,
-- cinematic, comic or watercolor -- which replaces the genre's own style
-- clause when a cover or a portrait prompt is built (`coverArtStyleClause` in
-- `_shared/cover-prompts.ts`).
--
-- If that pick lived only in the generation request body it would be applied
-- once and then lost, and the places that rebuild an image prompt do not have
-- the request body:
--
--   * `regenerate-cover` builds its prompt entirely from what
--     `claim_cover_regeneration` returns, precisely so it does not follow the
--     claim with a second SELECT of the same row. A writer who picked anime,
--     got an anime cover and then tapped Regenerate would have been charged
--     for a painterly one.
--   * The cast portraits are drawn by the background media task, minutes after
--     the response carrying the request has gone. A story whose cover is
--     watercolour and whose cast is painterly reads as two different books --
--     the whole reason `coverArtStyleClause` is exported for portraits at all.
--
-- So the pick is a column, and both of those read it from the row.
--
-- NOT NULL with a default rather than nullable: 'auto' is not a missing value,
-- it is the answer "use the genre's own look", which is what every story
-- written before this migration was. A nullable column would make every reader
-- of it spell that equivalence out again, and one of them would eventually
-- spell it differently.

alter table public.stories
    add column if not exists image_style text not null default 'auto';

alter table public.stories
    drop constraint if exists stories_image_style_check;

alter table public.stories
    add constraint stories_image_style_check
    check (image_style in ('auto', 'anime', 'cinematic', 'comic', 'watercolor'));

comment on column public.stories.image_style is
    'The writer''s Image style pick, applied to this story''s cover and to every cast portrait. ''auto'' means the genre''s own style clause (GENRE_PROMPTS in _shared/cover-prompts.ts); the other four replace it. Never appended to the genre style -- two style instructions in one prompt produce neither.';


-- ---------------------------------------------------------------------------
-- begin_story_generation
-- ---------------------------------------------------------------------------
-- Unchanged from 00040 apart from the new last parameter and the column it
-- writes.
--
-- Dropped and recreated rather than replaced, because a parameter list of a
-- different length is a different function to Postgres: `create or replace`
-- would leave the 20-argument version in place beside this one and a
-- 20-argument call would then have two equally good candidates. Adding the
-- parameter LAST and defaulting it is what keeps an older deploy of
-- `generate-story` -- which names 20 parameters and not this one -- resolving
-- to this function during the window where code and schema disagree.

drop function if exists public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean, text[]
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
    p_image_style text default 'auto'
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

    insert into public.stories (
        author_id, title, genre, primary_genre, audience_mode,
        identity_lenses, spice_level, story_mode, topic, language, where_and_when,
        chapter_length, planned_chapter_count, moments, story_values,
        writing_style, avoid, illustrate_chapters, beats, image_style, status
    ) values (
        p_user_id, p_title, v_genres, p_primary_genre,
        p_audience_mode, p_identity_lenses, p_spice_level, p_story_mode,
        p_topic, p_language, p_where_and_when, p_chapter_length, p_planned_chapter_count,
        p_moments, p_story_values, p_writing_style, p_avoid,
        p_illustrate_chapters, v_beats, v_image_style, 'generating'
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
    text, text, integer, text[], text[], text, text, boolean, text[], text
) from public, anon, authenticated;

grant execute on function public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean, text[], text
) to service_role;

comment on function public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean, text[], text
) is 'Service-only. Idempotency check, story row and credit reservation in one transaction. p_image_style is the writer''s Image style pick and is clamped to the allowed set rather than trusted, so a stale client cannot abort a paid generation on a check constraint.';


-- ---------------------------------------------------------------------------
-- claim_cover_regeneration
-- ---------------------------------------------------------------------------
-- Unchanged from 00044 apart from one more field in the returned object.
--
-- This is the half of the feature that makes the pick durable. The claim
-- returns everything the cover prompt is built from precisely so the caller
-- does not re-read the row; a style missing from here is a style the
-- regeneration cannot know about, and the writer pays a credit to have their
-- anime cover replaced by a painterly one.

create or replace function public.claim_cover_regeneration(
    p_story_id uuid,
    p_user_id uuid,
    p_request_id text default null,
    p_stale_after interval default interval '10 minutes'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_story public.stories;
    v_attempt_limit constant integer := 12;
begin
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_story_id::text, 1)
    );

    select * into v_story
    from public.stories
    where id = p_story_id
    for update;

    if not found then
        return pg_catalog.jsonb_build_object('claimed', false, 'reason', 'not_found');
    end if;

    -- Ownership is checked here rather than trusted from the caller. This
    -- function is SECURITY DEFINER and reachable only by service_role, so it is
    -- the last gate before a user pays to change somebody else's story.
    if v_story.author_id is distinct from p_user_id then
        return pg_catalog.jsonb_build_object('claimed', false, 'reason', 'not_owner');
    end if;

    -- The same request id, against the cover that request id actually
    -- delivered, is a retry of a call that succeeded -- a dropped response, a
    -- backgrounded app, a tapped-twice button. Handing back the cover it
    -- already bought is what idempotency means here. Only
    -- finish_cover_regeneration writes cover_last_request_id, which is what
    -- makes this guard mean "this id delivered a cover" rather than "this id
    -- was merely the last to claim the row".
    if p_request_id is not null
       and v_story.cover_last_request_id = p_request_id
       and v_story.cover_status = 'ready'
       and v_story.cover_image_url is not null then
        return pg_catalog.jsonb_build_object(
            'claimed', false,
            'reason', 'replayed',
            'cover_image_url', v_story.cover_image_url,
            'cover_regen_count', v_story.cover_regen_count
        );
    end if;

    -- The spend bound. Before the reservation and before the provider, because
    -- the attempt this refuses is one that would have cost us money and the
    -- caller nothing.
    if v_story.cover_attempt_count >= v_attempt_limit then
        return pg_catalog.jsonb_build_object(
            'claimed', false,
            'reason', 'attempt_limit'
        );
    end if;

    -- A fresh 'generating' claim means another regeneration -- or the original
    -- background media task -- is in flight. Two providers writing the same
    -- storage key would leave the row pointing at whichever finished last, and
    -- the user would have paid for the one that lost.
    if v_story.cover_status = 'generating'
       and v_story.cover_started_at is not null
       and v_story.cover_started_at > pg_catalog.now() - p_stale_after then
        return pg_catalog.jsonb_build_object('claimed', false, 'reason', 'in_flight');
    end if;

    -- The attempt is counted here, in the same statement as the claim and under
    -- the same lock that decided the price. Counting it on the way out would
    -- leave every path that never reaches the exit -- a timeout, an evicted
    -- isolate, a caller that hangs up -- uncounted. release_cover_claim gives
    -- the count back on the paths that provably never reached a provider.
    --
    -- cover_last_request_id is deliberately *not* written here. It records
    -- which request produced the cover on the row, and only a finished
    -- regeneration knows that.
    update public.stories
    set cover_status = 'generating',
        cover_started_at = pg_catalog.now(),
        cover_attempt_count = cover_attempt_count + 1
    where id = p_story_id;

    return pg_catalog.jsonb_build_object(
        'claimed', true,
        -- The status to put back if this attempt fails. Restoring it matters:
        -- a story that already had a good cover must not be left reading
        -- 'failed' because a *re*generation missed.
        'previous_cover_status', v_story.cover_status,
        'regen_count', v_story.cover_regen_count,
        'attempt_count', v_story.cover_attempt_count + 1,
        'attempts_remaining', v_attempt_limit - (v_story.cover_attempt_count + 1),
        -- 1 free retry, then 1 credit. Computed here so the price and the count
        -- it is derived from are read under the same lock.
        'requires_credit', v_story.cover_regen_count >= 1,
        'title', v_story.title,
        'primary_genre', v_story.primary_genre,
        'themes', pg_catalog.to_jsonb(coalesce(v_story.themes, '{}'::text[])),
        'where_and_when', v_story.where_and_when,
        'avoid', v_story.avoid,
        'cover_prompt', v_story.cover_prompt,
        'image_style', v_story.image_style
    );
end;
$$;

revoke all on function public.claim_cover_regeneration(uuid, uuid, text, interval)
    from public, anon, authenticated;
grant execute on function public.claim_cover_regeneration(uuid, uuid, text, interval)
    to service_role;
