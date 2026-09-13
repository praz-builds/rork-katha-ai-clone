-- Migration 00087: the settled start price, and an auto story that buys its
-- whole run at once.
--
-- ## Numbering
--
-- Taken from `supabase migration list`, not from the directory, per AGENTS.md.
-- Remote's highest applied is `00086`; 00081 and 00083 were never files. Every
-- migration through 00086 is applied to PRODUCTION and must not be edited, so
-- everything below is a forward fix.
--
-- ## Part 1 -- starting a story costs 1 credit, not 3
--
-- AGENTS.md has carried an "UNRESOLVED PRICING DISAGREEMENT" since 2026-09-11:
-- `source-of-truth/CREDITS_AND_PRICING.md` §Summary prices a story start at
-- **1** credit -- a bundle of the cast, chapter one's words and chapter one's
-- art, which becomes the cover -- while `begin_story_generation` deducted
-- **3**. The product owner has settled it in the document's favour. One credit
-- buys all three, so a one-chapter story costs exactly 1 in total.
--
-- Chapters after the first are untouched: 1 credit, or 2 when
-- `stories.illustrate_chapters` is true (00077). A 3-chapter illustrated story
-- is now 5 = 1 + 2 + 2, which is the number §1 always quoted.
--
-- `create or replace`, not drop-and-recreate: the argument list is unchanged,
-- so there is no second overload to strand and the existing grants survive.
--
-- Two refund paths read the old number and are handled here rather than left
-- to be discovered:
--
--   * `refund_generation_operation` already clamps a story refund with
--     `least(3, actual_debit)`, so a start debited 1 refunds exactly 1 and a
--     legacy start debited 3 still refunds 3. It needs no change, and the
--     literal 3 stays a CEILING rather than a price.
--   * `refund_story_media_component` does need one -- see part 3 below.
--
-- ## Part 2 -- an auto story reserves its whole run upfront
--
-- Until now the auto write-ahead bought one chapter at a time, checking the
-- live balance before each. The product decision is that auto mode takes the
-- credits AT ONCE: when chapter one of an auto series lands, work out how many
-- of the remaining planned chapters the balance can buy, reserve all of them
-- in one transaction, write that many, and stop.
--
-- WHY THE WHOLE RUN, AND WHY ONE TRANSACTION. Auto mode is the reader saying
-- "do not ask me again", and a chain that re-checks the balance per chapter
-- can stop in the middle of a story because something else spent a credit in
-- between -- audio, a portrait, a second device. Pre-buying makes the promise
-- the mode implies: the chapters it told you it would write are already paid
-- for. The failure to design against is a PARTIAL reservation -- six chapters
-- affordable, four reserved, two credits taken for nothing -- so the whole run
-- is reserved inside one plpgsql function, which is one transaction. If the
-- last deduction raised KTH02 the first five would unwind with it.
--
-- WHY N LEDGER ROWS AND NOT ONE. The run debits `deduct_credit` once per
-- chapter, each keyed to that chapter's own operation id. A single lump debit
-- keyed to the run would have had to invent a second refund path, because
-- every existing refund -- `refund_generation_operation`,
-- `refund_story_media_component` -- finds what a chapter actually cost by
-- reading the debit keyed to its operation. Per-chapter debits inside one
-- transaction give both: atomic as a run, refundable as chapters.
--
-- WHAT STOPS A RUN BEING BOUGHT TWICE. Three things, in order of how early
-- they fire: `stories.auto_run_through_chapter` records what is already
-- bought and a second call for the same span returns it untouched; the
-- run id makes a retried call replay rather than buy; and the unique index
-- `idx_generation_operations_active_chapter` on (story_id, chapter_number)
-- where status = 'reserved' is a hard backstop that aborts the transaction
-- even if the first two were somehow both wrong.
--
-- ## Part 3 -- the bundled start has no separable component credit
--
-- `refund_story_media_component` gives back one credit when a story's cast or
-- cover never arrived. That was right at 3, where the cast and the cover each
-- had a credit of their own. At 1 it would give back the ENTIRE start price
-- for a story whose chapter the writer read and kept -- a free story, for a
-- missing picture that the concept card already stands in for (decision 39)
-- and that `regenerate-cover` offers a free retry of.
--
-- The existing `v_original_debit < v_min_debit` guard already declines in that
-- case, because a 1-credit start does not clear the 3 it requires. That is the
-- correct behaviour arrived at by accident, which is not the same as correct
-- behaviour: this migration makes it explicit and names the number, so the
-- next person to touch the guard knows it is load-bearing and not a leftover.

-- ---------------------------------------------------------------------------
-- 0. What a pre-bought run is recorded on
-- ---------------------------------------------------------------------------

alter table public.stories
    add column if not exists auto_run_through_chapter integer;

comment on column public.stories.auto_run_through_chapter is
    'The last chapter this story has ALREADY PAID FOR under an auto write-ahead run, or null for a story that has never pre-bought one. It is the durable form of the run: the client reads it off the row, so an app restart, a cold library read or a second device all still know which chapters auto mode may write without spending anything. Null is not zero -- it means "no run was ever reserved" and is what keeps a story created before migration 00087 on the old per-chapter behaviour instead of stalling for ever.';

alter table public.generation_operations
    add column if not exists auto_run_id uuid;

comment on column public.generation_operations.auto_run_id is
    'The pre-bought auto run this reservation belongs to, or null for a reservation made one chapter at a time. It is what tells `reserve_generation_operation` to CLAIM this row rather than insert a second one and charge again, and what lets `refund_auto_chapter_run` find the chapters of a run that stopped early.';

alter table public.generation_operations
    add column if not exists claimed_at timestamptz;

comment on column public.generation_operations.claimed_at is
    'When a pre-bought auto-run reservation was handed to the request that actually writes the chapter, or null while it is still waiting. Without it two concurrent requests for the same chapter would both claim the same paid row and both be told to go ahead: the first claim stamps this, and the second is refused KTH01 exactly as a duplicate reservation always has been.';

-- ---------------------------------------------------------------------------
-- 1. begin_story_generation -- 1 credit, not 3
-- ---------------------------------------------------------------------------
-- 00076's body with one number changed, restated in full because that is what
-- `create or replace` requires. The signature is identical, so this replaces
-- the deployed function rather than standing beside it, and the 00076 grants
-- and revokes still apply.

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

comment on function public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean, text[], text, text
) is 'Service-only. Idempotency check, story row and credit reservation in one transaction. Starting a story costs ONE credit, which bundles the cast, chapter one''s words and chapter one''s art (the cover) -- CREDITS_AND_PRICING.md section 1, settled 2026-09-14. p_image_style and p_story_flow are clamped to their allowed set rather than trusted, so a stale client cannot abort a paid generation on a check constraint.';

-- ---------------------------------------------------------------------------
-- 2. reserve_auto_chapter_run -- the whole run, or none of it
-- ---------------------------------------------------------------------------

create or replace function public.reserve_auto_chapter_run(
    p_user_id uuid,
    p_story_id uuid,
    p_run_id uuid,
    p_from_chapter integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_story public.stories;
    v_operation public.generation_operations;
    v_cost integer;
    v_planned integer;
    v_remaining integer;
    v_balance integer;
    v_chapters integer;
    v_chapter integer;
    v_through integer;
    v_spent integer := 0;
begin
    if p_run_id is null then
        raise exception 'A run ID is required';
    end if;
    -- Chapter one is bought by `begin_story_generation`, and a run that could
    -- start at it would buy it a second time.
    if p_from_chapter is null or p_from_chapter < 2 then
        raise exception 'An auto run starts after chapter one';
    end if;

    -- The same two locks `reserve_generation_operation` takes, in the same
    -- order. Taking them in the other order is how two of these deadlock.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_story_id::text, 1)
    );

    select * into v_story
    from public.stories
    where id = p_story_id
    for update;
    if not found or v_story.author_id <> p_user_id then
        raise exception 'Story not found';
    end if;

    perform public.ensure_credit_balance_buckets(p_user_id);
    select subscription_grant_balance + purchased_balance + earned_balance
    into v_balance
    from public.credit_balance_buckets
    where user_id = p_user_id
    for update;
    v_balance := coalesce(v_balance, 0);

    -- ONLY AN AUTO SERIES PRE-BUYS, and this refuses by returning an empty run
    -- rather than raising. An interactive story reaching here is a caller bug,
    -- not a user-visible failure, and turning it into one would fail a
    -- generation the reader has already been given after the chapter was
    -- written and paid for. Nothing is reserved and nothing is recorded on the
    -- row, so the story keeps asking before it spends.
    if v_story.story_flow is distinct from 'auto'
       or v_story.story_mode is distinct from 'series' then
        return pg_catalog.jsonb_build_object(
            'chapters', 0,
            'from_chapter', p_from_chapter,
            'through_chapter', p_from_chapter - 1,
            'credits_per_chapter', 0,
            'credits', 0,
            'balance', v_balance,
            'reserved', false
        );
    end if;

    -- ALREADY BOUGHT. A retried edge invocation, or a second one racing it
    -- behind the story lock, must report the run that exists rather than buy a
    -- second one over the top of it.
    if v_story.auto_run_through_chapter is not null
       and v_story.auto_run_through_chapter >= p_from_chapter - 1
       and exists (
           select 1 from public.generation_operations o
           where o.story_id = p_story_id and o.auto_run_id is not null
       ) then
        return pg_catalog.jsonb_build_object(
            'chapters', 0,
            'from_chapter', p_from_chapter,
            'through_chapter', v_story.auto_run_through_chapter,
            'credits_per_chapter', 0,
            'credits', 0,
            'balance', v_balance,
            'reserved', false,
            'replayed', true
        );
    end if;

    -- THE ARITHMETIC OF THE RUN, in one place.
    --
    -- Per-chapter price is the 00077 price and is taken from the STORY ROW for
    -- the same reason `reserve_generation_operation` takes it from there: the
    -- background art task reads `illustrate_chapters` before it draws
    -- anything, so a price derived from anything else could charge for
    -- pictures that task will never make.
    --
    -- The run is the smaller of what the plan still has and what the balance
    -- can buy. Integer division is deliberate: a balance of 5 against a
    -- 2-credit illustrated chapter buys two chapters, not two and a half, and
    -- the odd credit stays in the writer's hands.
    v_cost := case when v_story.illustrate_chapters then 2 else 1 end;
    v_planned := coalesce(v_story.planned_chapter_count, 3);
    v_remaining := greatest(v_planned - p_from_chapter + 1, 0);
    v_chapters := least(v_remaining, v_balance / v_cost);

    -- AN INSUFFICIENT BALANCE RESERVES NOTHING AT ALL. Not a shorter run of
    -- zero chapters with a credit taken, not a partial one: the loop below
    -- simply does not run, and `auto_run_through_chapter` is written as
    -- "nothing bought past chapter one" so the client can tell a run of zero
    -- from a story that predates runs entirely.
    v_through := p_from_chapter - 1;

    for v_chapter in p_from_chapter .. (p_from_chapter + v_chapters - 1) loop
        begin
            insert into public.generation_operations (
                user_id, request_id, story_id, chapter_number, kind, auto_run_id
            ) values (
                p_user_id,
                'autorun:' || p_run_id::text || ':' || v_chapter::text,
                p_story_id,
                v_chapter,
                'continuation',
                p_run_id
            ) returning * into v_operation;
        exception
            when unique_violation then
                -- The backstop, and the only one that survives a mistake in
                -- both guards above: `idx_generation_operations_active_chapter`
                -- is unique on (story_id, chapter_number) where the status is
                -- 'reserved'. Re-raised rather than skipped, because skipping
                -- would leave a run that silently owns fewer chapters than it
                -- reports -- and the raise unwinds every deduction made so far
                -- in this transaction, which is the whole point of doing it in
                -- one.
                raise exception using
                    errcode = 'KTH01',
                    message = 'Generation chapter already reserved';
        end;

        -- Raises KTH02 on an insufficient balance and unwinds the entire run
        -- with it. It should be unreachable -- `v_chapters` was computed from
        -- the balance read under this same lock -- and it is left in place as
        -- the thing that makes "all or none" true rather than merely intended.
        v_balance := public.deduct_credit(
            p_user_id,
            v_cost,
            'generation',
            v_operation.id::text,
            'generation:' || v_operation.id::text
        );
        v_spent := v_spent + v_cost;
        v_through := v_chapter;
    end loop;

    update public.stories
    set auto_run_through_chapter = v_through
    where id = p_story_id;

    return pg_catalog.jsonb_build_object(
        'chapters', v_chapters,
        'from_chapter', p_from_chapter,
        'through_chapter', v_through,
        'credits_per_chapter', v_cost,
        'credits', v_spent,
        'balance', v_balance,
        'reserved', v_chapters > 0
    );
end;
$$;

revoke all on function public.reserve_auto_chapter_run(uuid, uuid, uuid, integer)
from public, anon, authenticated;
grant execute on function public.reserve_auto_chapter_run(uuid, uuid, uuid, integer)
to service_role;
comment on function public.reserve_auto_chapter_run(uuid, uuid, uuid, integer) is
    'Service-only. Reserves every chapter an auto series can still afford, from p_from_chapter to its planned ending, in ONE transaction -- all of them or none. Records the last paid-for chapter on stories.auto_run_through_chapter. Refuses to stack a second run over a live one.';

-- ---------------------------------------------------------------------------
-- 3. reserve_generation_operation -- claim a pre-bought chapter, never re-buy it
-- ---------------------------------------------------------------------------
-- 00085's body with one branch added. The signature is unchanged, so
-- `create or replace` is right and the grants are preserved.
--
-- Without this branch the feature is a double charge waiting to happen:
-- `continue-story` opens every chapter by reserving it, the run has already
-- reserved that chapter, and the insert would hit the active-chapter unique
-- index and be reported as KTH01 -- a 409 on a chapter the writer has already
-- paid for, on every chapter of every auto run.
--
-- The interactive path and the chapter-end fallback reach exactly the code
-- they reached before: with no pre-bought row the branch does not fire.

create or replace function public.reserve_generation_operation(
    p_user_id uuid,
    p_request_id text,
    p_story_id uuid,
    p_chapter_number integer,
    p_kind text,
    p_illustrate_chapter boolean default false,
    p_extend_to_chapter integer default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operation public.generation_operations;
    v_balance integer;
    v_amount integer := 1;
    v_story_mode text;
    v_planned integer;
    v_written integer;
    v_plan_raised_from integer;
    v_prepaid public.generation_operations;
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

    /*
      THIS CHAPTER MAY ALREADY BE PAID FOR.

      `reserve_auto_chapter_run` buys a whole auto run upfront and leaves one
      'reserved' row per chapter. The request that eventually writes chapter N
      arrives here with a fresh request id and no idea that happened, so this
      branch hands it the row that already exists instead of inserting a second
      one -- which the active-chapter unique index would refuse anyway, turning
      every chapter of every auto run into a 409.

      Claiming is an UPDATE of the request id, which is what keeps idempotency
      intact: a retry of the same request finds the row through the ordinary
      (user_id, request_id) lookup above and replays, exactly as it would for a
      chapter bought one at a time.

      `claimed_at` is what stops two requests claiming the same paid chapter.
      Both would otherwise be told to go ahead, both would write chapter N, and
      one of them would overwrite the other's prose. The second is refused
      KTH01 -- the same answer a duplicate reservation has always got, and the
      one `continue-story` already turns into "this chapter generation is
      already in progress".

      Nothing is debited here. The credit was taken when the run was reserved,
      and `credits: 0` says so rather than leaving the caller to re-derive it.
    */
    if p_extend_to_chapter is null then
        select *
        into v_prepaid
        from public.generation_operations
        where story_id = p_story_id
          and chapter_number = p_chapter_number
          and status = 'reserved'
          and auto_run_id is not null
        for update;

        if found then
            if v_prepaid.user_id <> p_user_id
               or v_prepaid.claimed_at is not null then
                raise exception using
                    errcode = 'KTH01',
                    message = 'Generation chapter already reserved';
            end if;

            update public.generation_operations
            set request_id = p_request_id,
                claimed_at = pg_catalog.now(),
                updated_at = pg_catalog.now()
            where id = v_prepaid.id
            returning * into v_operation;

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
                'replayed', false,
                'prepaid', true,
                'balance', coalesce(v_balance, 0),
                'credits', 0,
                'planned_chapter_count', null
            );
        end if;
    end if;

    -- The plan raise, taken BEFORE the debit and inside the same transaction.
    --
    -- Deliberately after the replay branch above: a retried request whose
    -- first attempt already extended the story must not extend it a second
    -- time. It returns the earlier reservation and never reaches here.
    --
    -- Every refusal below raises KTH03 rather than silently declining to
    -- extend, because the alternative is charging a credit for a chapter the
    -- story will then refuse to number.
    if p_extend_to_chapter is not null then
        if p_kind <> 'continuation'
           or p_extend_to_chapter <> p_chapter_number
           or p_extend_to_chapter > 15 then
            raise exception using
                errcode = 'KTH03',
                message = 'Story cannot be extended';
        end if;

        select s.story_mode, s.planned_chapter_count
        into v_story_mode, v_planned
        from public.stories s
        where s.id = p_story_id
        for update;

        -- Only a series grows. A standalone has no plan to raise and no
        -- chapter two -- its ending is a rewrite, not more prose.
        if not found or v_story_mode is distinct from 'series' then
            raise exception using
                errcode = 'KTH03',
                message = 'Story cannot be extended';
        end if;

        -- ONE CHAPTER AT A TIME, ENFORCED HERE AND NOT ONLY DOCUMENTED.
        -- See 00085 for the full account: the bound is one past what the story
        -- ALREADY IS -- the larger of its plan and the chapters it owns -- and
        -- it applies only to the path that actually raises the plan, so an
        -- in-plan flag stays the paid no-op 00079 made it.
        select pg_catalog.max(c.chapter_number)
        into v_written
        from public.chapters c
        where c.story_id = p_story_id;

        if p_extend_to_chapter > coalesce(v_planned, 3)
           and p_extend_to_chapter
               <> greatest(coalesce(v_planned, 3), coalesce(v_written, 0)) + 1
        then
            raise exception using
                errcode = 'KTH03',
                message = 'Story cannot be extended';
        end if;

        -- Monotonic, and a no-op when the plan already covers this chapter: an
        -- ordinary in-plan continuation that happened to send the flag must not
        -- be able to SHRINK a story.
        if coalesce(v_planned, 3) < p_extend_to_chapter then
            update public.stories
            set planned_chapter_count = p_extend_to_chapter
            where id = p_story_id;
            v_plan_raised_from := v_planned;
        end if;
    end if;

    -- The price, decided here and nowhere else.
    --
    -- The caller asking for art is necessary but not sufficient: the story row
    -- has to say the chapter is illustrated too. `illustrate_chapters` is what
    -- the background art task reads before it draws anything, so a price
    -- derived from anything else could charge for a picture that task will
    -- never make, or hand out one nobody paid for.
    --
    -- An EXTENSION IS PRICED LIKE ANY OTHER CHAPTER. It is not discounted for
    -- being unplanned and not surcharged for it.
    --
    -- Only a continuation can cost two. A reimagine rewrites a chapter that
    -- already has its art, and 'story' is priced by `begin_story_generation`.
    if p_kind = 'continuation'
       and coalesce(p_illustrate_chapter, false)
       and coalesce(
           (select s.illustrate_chapters
            from public.stories s
            where s.id = p_story_id),
           false
       ) then
        v_amount := 2;
    end if;

    begin
        insert into public.generation_operations (
            user_id,
            request_id,
            story_id,
            chapter_number,
            kind,
            plan_raised_from
        ) values (
            p_user_id,
            p_request_id,
            p_story_id,
            p_chapter_number,
            p_kind,
            v_plan_raised_from
        ) returning * into v_operation;
    exception
        when unique_violation then
            raise exception using
                errcode = 'KTH01',
                message = 'Generation chapter already reserved';
    end;

    v_balance := public.deduct_credit(
        p_user_id,
        v_amount,
        'generation',
        v_operation.id::text,
        'generation:' || v_operation.id::text
    );

    return pg_catalog.jsonb_build_object(
        'id', v_operation.id,
        'story_id', v_operation.story_id,
        'chapter_number', v_operation.chapter_number,
        'status', v_operation.status,
        'replayed', false,
        'result_chapter_id', v_operation.result_chapter_id,
        'balance', coalesce(v_balance, 0),
        -- What was actually charged, so the caller does not have to re-derive
        -- it from the flag it sent and the row it did not read.
        'credits', v_amount,
        -- The plan this story now runs to, so a client that just extended it
        -- does not have to re-read the row to know what it bought.
        'planned_chapter_count', case
            when p_extend_to_chapter is not null
                then greatest(coalesce(v_planned, 3), p_extend_to_chapter)
            else null
        end
    );
end;
$$;

comment on function public.reserve_generation_operation(uuid, text, uuid, integer, text, boolean, integer)
    is 'Service-only. Reserves one generation operation and debits its price: 1 credit, or 2 for a continuation of a story whose illustrate_chapters is true. A chapter already bought by reserve_auto_chapter_run is CLAIMED instead, at no further charge. p_extend_to_chapter raises the plan in the same transaction as the debit.';

-- ---------------------------------------------------------------------------
-- 4. refund_auto_chapter_run -- give back exactly what was never written
-- ---------------------------------------------------------------------------
-- A run that stops early has to hand back the chapters it bought and did not
-- deliver. A provider failure at chapter 4 of a 6-chapter run refunds 3: the
-- one that failed and the two never attempted. The writer is left charged for
-- chapters they actually received and nothing else.
--
-- IT REFUNDS THROUGH `refund_generation_operation` RATHER THAN BESIDE IT. That
-- function already knows what a chapter cost (it reads the debit keyed to the
-- operation, so an illustrated chapter gives back 2), already flips the row to
-- 'refunded', and already keys the grant on `refund:<operation id>` so a
-- repeated call cannot pay twice. Reimplementing any of that here would be a
-- second answer to "what is this chapter worth", and the two would disagree
-- the first time a price moved.
--
-- IDEMPOTENCY, THE SAME WAY THE REST OF THE CREDIT SYSTEM DOES IT. Calling
-- this twice for the same chapter refunds once: the first call leaves every
-- operation at status 'refunded', and the loop below only selects 'reserved'
-- ones. `grant_credit`'s operation key is the second guard underneath that, so
-- even a row that somehow re-entered 'reserved' could not be paid twice.

create or replace function public.refund_auto_chapter_run(
    p_user_id uuid,
    p_story_id uuid,
    p_from_chapter integer,
    p_error text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operation public.generation_operations;
    v_result jsonb;
    v_debit integer;
    v_chapters integer := 0;
    v_credits integer := 0;
    v_balance integer;
begin
    if p_from_chapter is null or p_from_chapter < 2 then
        raise exception 'An auto run starts after chapter one';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_story_id::text, 1)
    );

    for v_operation in
        select *
        from public.generation_operations
        where story_id = p_story_id
          and user_id = p_user_id
          and auto_run_id is not null
          and status = 'reserved'
          and chapter_number >= p_from_chapter
        order by chapter_number
        for update
    loop
        -- Read BEFORE the refund, because the refund is what makes the row
        -- unreadable as "still owed": afterwards the ledger carries both a
        -- debit and a credit for this operation and the sum is what the writer
        -- got back, not what they paid.
        select -amount
        into v_debit
        from public.credit_ledger
        where user_id = p_user_id
          and reason = 'generation'
          and reference_id = v_operation.id::text
          and amount < 0
        order by created_at desc, ledger_sequence desc
        limit 1;

        v_result := public.refund_generation_operation(
            v_operation.id, p_user_id, p_error
        );

        if coalesce((v_result ->> 'refunded')::boolean, false) then
            v_chapters := v_chapters + 1;
            v_credits := v_credits + coalesce(v_debit, 0);
        end if;
        v_balance := (v_result ->> 'balance')::integer;
    end loop;

    -- THE RUN NOW ENDS WHERE THE REFUND STARTED.
    --
    -- Lowered rather than cleared, and never raised: the chapters below
    -- `p_from_chapter` are still bought and the client must still be allowed
    -- to write them without paying again. `least` against the stored value is
    -- what keeps a refund of the tail from accidentally EXTENDING a run that
    -- had already been cut shorter by an earlier one.
    --
    -- `is not null` and not `coalesce`, because null on this column means
    -- "this story never pre-bought anything" and is what keeps a story written
    -- before 00087 on the old per-chapter behaviour. Writing a number here
    -- would tell the client that story has a run -- an exhausted one -- and
    -- stop it continuing at all.
    update public.stories
    set auto_run_through_chapter = least(
        auto_run_through_chapter,
        p_from_chapter - 1
    )
    where id = p_story_id
      and auto_run_through_chapter is not null;

    if v_balance is null then
        perform public.ensure_credit_balance_buckets(p_user_id);
        select subscription_grant_balance + purchased_balance + earned_balance
        into v_balance
        from public.credit_balance_buckets
        where user_id = p_user_id;
    end if;

    return pg_catalog.jsonb_build_object(
        'chapters', v_chapters,
        'credits', v_credits,
        'through_chapter', p_from_chapter - 1,
        'balance', coalesce(v_balance, 0)
    );
end;
$$;

revoke all on function public.refund_auto_chapter_run(uuid, uuid, integer, text)
from public, anon, authenticated;
grant execute on function public.refund_auto_chapter_run(uuid, uuid, integer, text)
to service_role;
comment on function public.refund_auto_chapter_run(uuid, uuid, integer, text) is
    'Service-only. Refunds every still-reserved chapter of a pre-bought auto run from p_from_chapter onward -- the chapter that failed and the ones never attempted -- through refund_generation_operation, so the amount is what each chapter actually cost and a repeated call cannot refund twice.';

-- ---------------------------------------------------------------------------
-- 5. refund_story_media_component -- a bundled start has no spare credit
-- ---------------------------------------------------------------------------
-- 00077's body with the cast/cover minimum named rather than left implicit.
--
-- At the old 3-credit start the cast and the cover each had a credit of their
-- own, so giving one back when the pictures never arrived was giving back
-- exactly the part that did not happen. At 1 there is no such part: the single
-- credit bought the cast, chapter one's words and the cover together, and
-- refunding it would hand back a story the writer read and kept.
--
-- So the guard below is the price boundary, not a sanity check. A start
-- debited 3 -- every story written before this migration -- still refunds its
-- component, because those writers paid per action. A start debited 1 refunds
-- nothing, and what the reader gets instead is the concept card (decision 39
-- treats it as a legitimate published look) and a free `regenerate-cover`
-- retry, which is what `cover-regeneration.ts` already gives them.

create or replace function public.refund_story_media_component(
    p_operation_id uuid,
    p_user_id uuid,
    p_component text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operation public.generation_operations;
    v_buckets public.credit_balance_buckets;
    v_allocation public.credit_spend_allocations;
    v_current_balance integer;
    v_original_debit integer;
    v_refunded_before integer;
    v_refund_amount integer;
    v_before_grant integer;
    v_before_purchased integer;
    v_after_grant integer;
    v_after_purchased integer;
    v_restore_grant integer;
    v_restore_purchased integer;
    v_restore_earned integer;
    v_operation_key text;
    v_kind text;
    v_min_debit integer;
begin
    if p_component not in ('cast', 'cover', 'chapter_art') then
        raise exception 'Invalid story media component';
    end if;

    -- Which operation owns this component, and what it must have cost for the
    -- component to have been separately paid for.
    --
    -- `chapter_art` is unchanged: an illustrated continuation is debited 2,
    -- one credit of which is the picture, and a picture that never arrived
    -- gives that credit back.
    --
    -- `cast` and `cover` belong to a story start, and the number below is the
    -- LEGACY per-action price. A start debited 1 -- the bundled price settled
    -- on 2026-09-14 -- has no separable component credit to return, and paying
    -- one out would refund the whole story over a missing picture the concept
    -- card already covers. Lowering this to 1 is the bug, not the fix.
    if p_component = 'chapter_art' then
        v_kind := 'continuation';
        v_min_debit := 2;
    else
        v_kind := 'story';
        v_min_debit := 3;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );

    select * into v_operation
    from public.generation_operations
    where id = p_operation_id and user_id = p_user_id and kind = v_kind
    for update;
    if not found then
        raise exception 'Story generation operation not found';
    end if;

    perform public.ensure_credit_balance_buckets(p_user_id);
    select * into v_buckets
    from public.credit_balance_buckets
    where user_id = p_user_id
    for update;
    v_current_balance := v_buckets.subscription_grant_balance
        + v_buckets.purchased_balance + v_buckets.earned_balance;

    v_operation_key := 'refund_component:' || p_operation_id::text || ':' || p_component;
    if exists (
        select 1 from public.credit_ledger
        where user_id = p_user_id and operation_key = v_operation_key
    ) then
        return v_current_balance;
    end if;

    select -amount into v_original_debit
    from public.credit_ledger
    where user_id = p_user_id
      and operation_key = 'generation:' || p_operation_id::text
      and amount < 0
    order by created_at desc, ledger_sequence desc
    limit 1;
    if v_original_debit is null or v_original_debit < v_min_debit then
        return v_current_balance;
    end if;

    select * into v_allocation
    from public.credit_spend_allocations
    where user_id = p_user_id
      and operation_key = 'generation:' || p_operation_id::text
    limit 1;
    if not found then
        raise exception 'Story generation allocation not found';
    end if;

    select coalesce(pg_catalog.sum(amount), 0)::integer
    into v_refunded_before
    from public.credit_ledger
    where user_id = p_user_id
      and reference_id = p_operation_id::text
      and reason = 'refund'
      and amount > 0;
    v_refund_amount := least(1, v_original_debit - v_refunded_before);
    if v_refund_amount <= 0 then
        return v_current_balance;
    end if;

    v_before_grant := least(v_allocation.grant_amount, v_refunded_before);
    v_before_purchased := least(
        v_allocation.purchased_amount,
        greatest(v_refunded_before - v_allocation.grant_amount, 0)
    );
    v_after_grant := least(
        v_allocation.grant_amount,
        v_refunded_before + v_refund_amount
    );
    v_after_purchased := least(
        v_allocation.purchased_amount,
        greatest(
            v_refunded_before + v_refund_amount - v_allocation.grant_amount,
            0
        )
    );
    v_restore_grant := v_after_grant - v_before_grant;
    v_restore_purchased := v_after_purchased - v_before_purchased;
    v_restore_earned := v_refund_amount - v_restore_grant - v_restore_purchased;

    update public.credit_balance_buckets
    set subscription_grant_balance = subscription_grant_balance + v_restore_grant,
        purchased_balance = purchased_balance + v_restore_purchased,
        earned_balance = earned_balance + v_restore_earned,
        updated_at = pg_catalog.now()
    where user_id = p_user_id;

    insert into public.credit_ledger(
        user_id, amount, reason, reference_id, operation_key, balance_after
    ) values (
        p_user_id, v_refund_amount, 'refund', p_operation_id::text,
        v_operation_key, v_current_balance + v_refund_amount
    );
    return v_current_balance + v_refund_amount;
end;
$$;

comment on function public.refund_story_media_component(uuid, uuid, text)
    is 'Service-only. Gives back one paid media credit -- a chapter''s illustration, or a legacy 3-credit story start''s cast or cover -- without touching the completed text operation. A 1-credit bundled start has no separable component credit and refunds nothing here.';
