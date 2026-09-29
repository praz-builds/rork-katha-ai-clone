-- Migration 00101: the faith axis, persisted on the story.
--
-- `_shared/traditions.ts` holds the reviewed representation policy for the four
-- Phase 1 traditions, and `_shared/tradition-classify.ts` decides, from the
-- writer's own idea, whether one was asked for. Until this migration the answer
-- lived only in the request that wrote chapter one.
--
-- WHY IT IS A COLUMN AND NOT A REQUEST FIELD, for two independent reasons and
-- either one is sufficient:
--
--   1. CONTINUATIONS RE-READ THE ROW. A chapter-two request carries a story id
--      and nothing else about the brief; `continue-story` rebuilds the whole
--      prompt from `stories`. A faith constraint that expired after chapter one
--      would be WORSE than never having had one: chapter two would contradict
--      chapter one on the single axis the reader chose the story for, inside
--      the same story, and no error would be raised anywhere.
--   2. THE COVER IS MADE LATER, BY SOMETHING ELSE. `publish-story` builds the
--      cover prompt from the story row long after the generation request is
--      gone, and the depiction rules in `traditions.ts` -- what may not be
--      drawn at all, whose face may not appear -- are exactly the rules that
--      must reach it. A row without the tradition is a row the image layer
--      cannot make a safe cover from.
--
-- NULLABLE, WITH NO DEFAULT AND NO BACKFILL. Absent is absent, and it is the
-- overwhelmingly common case: every story ever written here has no tradition,
-- and a story with a NULL here must behave in every respect exactly as it does
-- today -- same prompt, same cover, same reader. There is no safe value to
-- guess: putting a faith on a family's story that is not theirs is the one
-- mistake this whole contract exists to avoid, so the column stays empty until
-- something states otherwise.
--
-- CHECKED AGAINST THE PHASE 1 SET, and deliberately not against the full
-- declared id list in `traditions.ts`. The declared-but-unsupported ids
-- (buddhist, sikh, shinto, secular and the rest) normalise to absent in
-- `normalizeTradition` precisely because no reviewed policy exists for them, so
-- a row carrying one would be a row whose prompt and whose cover disagree about
-- whether a policy applies. The constraint keeps the column and the contract
-- saying the same thing. Widening it is a one-line migration on the day a
-- tradition's `supported` flag is flipped.

alter table public.stories
    add column if not exists tradition text;

alter table public.stories
    drop constraint if exists stories_tradition_check;

alter table public.stories
    add constraint stories_tradition_check
    check (tradition is null
           or tradition in ('christian', 'muslim', 'jewish', 'hindu'));

comment on column public.stories.tradition is
    'The faith tradition this story is written for, or null for the overwhelming majority that have none. One of the Phase 1 supported ids in _shared/traditions.ts. Read by every continuation (so chapters 2..N keep the constraint chapter one was written under) and by the cover pipeline at publish time (so the depiction rules reach the image). Independent of the culture axis and never derived from it: IN+christian, JP+buddhist, a convert and an interfaith family are all ordinary, and inferring either axis from the other erases every one of them. Null means no preference, and a null row is byte-for-byte the product that existed before this column.';


-- ---------------------------------------------------------------------------
-- begin_story_generation
-- ---------------------------------------------------------------------------
-- 00087's body with one new parameter and one new inserted column, restated in
-- full because that is what replacing a plpgsql function requires.
--
-- DROPPED AND RECREATED, following 00075 and 00076 exactly. A parameter list of
-- a different length is a different function to Postgres, so `create or
-- replace` alone would leave the 22-argument version standing beside this one
-- and make a 22-argument call ambiguous. The drop names the old signature.
--
-- THE NEW PARAMETER GOES LAST AND CARRIES A DEFAULT, for the same reason
-- `p_image_style` and `p_story_flow` did: during the window where the migration
-- has landed and the `generate-story` deploy has not, a 22-argument call from
-- the old code still resolves here and still writes a story. Nobody's paid
-- generation fails on a deploy ordering.
--
-- CLAMPED RATHER THAN TRUSTED, like the two before it. An unrecognised value
-- would hit `stories_tradition_check` and abort the transaction that also takes
-- the credit -- so a stale or wrong client would fail a paid generation over a
-- soft preference. Falling back to null is the safe direction: it is exactly
-- what a story with no preference has always been.

drop function if exists public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean, text[], text, text
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
    p_story_flow text default 'interactive',
    p_tradition text default null
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
    v_tradition text;
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
    -- again here is not redundant: the check constraint would otherwise abort
    -- the whole transaction, and a plan one beat too long is not a reason to
    -- refuse to write someone's story.
    v_beats := case
        when p_beats is null then '{}'::text[]
        when p_planned_chapter_count is null then p_beats
        else p_beats[1:p_planned_chapter_count]
    end;

    -- Same reasoning as the beat clamp, and the same failure it prevents: a
    -- style this function did not recognise would hit stories_image_style_check
    -- and abort the transaction that also takes the credit, so a stale client
    -- would fail a paid generation rather than get the default look. `lower`
    -- and `btrim` are real functions and must be qualified under
    -- `search_path = ''`; `coalesce` is a parser construct and must NOT be
    -- (migration 00071).
    v_image_style := pg_catalog.lower(
        pg_catalog.btrim(coalesce(p_image_style, 'auto'))
    );
    if v_image_style not in ('auto', 'anime', 'cinematic', 'comic', 'watercolor')
    then
        v_image_style := 'auto';
    end if;

    -- Clamped for exactly the reason the style above is: an unrecognised value
    -- would hit stories_story_flow_check and abort the transaction that also
    -- takes the credit, so a stale client would fail a paid generation over a
    -- preference. 'interactive' is the safe direction to fall back to: it is
    -- the mode that asks before it spends.
    v_story_flow := pg_catalog.lower(
        pg_catalog.btrim(coalesce(p_story_flow, 'interactive'))
    );
    if v_story_flow not in ('interactive', 'auto') then
        v_story_flow := 'interactive';
    end if;

    -- The third clamp, and the one whose fallback carries a meaning rather than
    -- a default. An id this function does not recognise becomes NULL, which is
    -- "no preference" -- the story is written exactly as every story written
    -- before the faith axis existed. `normalizeTradition` in traditions.ts does
    -- the same thing for the same reason: refusing a paid generation over a
    -- soft preference would cost the writer their story. Null passes through
    -- `lower`/`btrim` as null, and the empty string is treated as absent.
    v_tradition := pg_catalog.lower(pg_catalog.btrim(coalesce(p_tradition, '')));
    if v_tradition not in ('christian', 'muslim', 'jewish', 'hindu') then
        v_tradition := null;
    end if;

    insert into public.stories (
        author_id, title, genre, primary_genre, audience_mode,
        identity_lenses, spice_level, story_mode, topic, language, where_and_when,
        chapter_length, planned_chapter_count, moments, story_values,
        writing_style, avoid, illustrate_chapters, beats, image_style,
        story_flow, tradition, status
    ) values (
        p_user_id, p_title, v_genres, p_primary_genre,
        p_audience_mode, p_identity_lenses, p_spice_level, p_story_mode,
        p_topic, p_language, p_where_and_when, p_chapter_length, p_planned_chapter_count,
        p_moments, p_story_values, p_writing_style, p_avoid,
        p_illustrate_chapters, v_beats, v_image_style, v_story_flow,
        v_tradition, 'generating'
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

    -- ONE CREDIT, AND IT BUYS THREE THINGS.
    --
    -- The cast, chapter one's words, and chapter one's art -- which is the
    -- cover. This was 3, one per action, and the disagreement with
    -- `source-of-truth/CREDITS_AND_PRICING.md` §Summary was recorded in
    -- AGENTS.md rather than quietly resolved, because it is a price and only
    -- the product owner can pick one. They picked the document.
    --
    -- The consequence worth stating where the number is: a ONE-CHAPTER story
    -- now costs exactly 1 credit in total, because nothing else is charged for
    -- it. Every surface that quotes a total has to agree, which is why
    -- `expo/src/lib/pricing-limits.ts` names this number once rather than
    -- repeating the literal.
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
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean, text[], text,
    text, text
) from public, anon, authenticated;

grant execute on function public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean, text[], text,
    text, text
) to service_role;

comment on function public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean, text[], text,
    text, text
) is 'Service-only. Idempotency check, story row and credit reservation in one transaction. Starting a story costs ONE credit, which bundles the cast, chapter one''s words and chapter one''s art (the cover) -- CREDITS_AND_PRICING.md section 1, settled 2026-09-14. p_image_style, p_story_flow and p_tradition are clamped to their allowed set rather than trusted, so a stale client cannot abort a paid generation on a check constraint; an unrecognised tradition becomes null, which means no preference.';


-- ---------------------------------------------------------------------------
-- claim_cover_regeneration
-- ---------------------------------------------------------------------------
-- Unchanged from 00075 apart from one more field in the returned object, and
-- restated in full because that is what `create or replace` requires of a
-- plpgsql body.
--
-- THE SIGNATURE IS IDENTICAL, so this replaces the deployed function rather
-- than standing beside it, the 00044 grants and revokes still apply, and every
-- existing caller keeps working untouched: the change is one additional key in
-- a jsonb result, which a caller that does not read it cannot notice. That is
-- the same shape 00075 used when it added `image_style`, and it is why this
-- function -- unlike `begin_story_generation` above -- is not dropped first.

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
        'image_style', v_story.image_style,
        -- THE DEPICTION RULES, AND THE REASON THIS FUNCTION IS IN THIS
        -- MIGRATION AT ALL.
        --
        -- `regenerate-cover` builds its whole input from this object and
        -- deliberately does not re-read the row -- the comment above `title`
        -- says why, and 00075 added `image_style` here for exactly that
        -- reason. A tradition missing from here is a tradition the
        -- regeneration cannot know about, so a story's FIRST cover would
        -- respect its depiction policy and a REGENERATED one would silently
        -- not: it fails quietly, only on the second attempt, and the writer
        -- has paid a credit for the cover that broke the rule.
        'tradition', v_story.tradition
    );
end;
$$;
