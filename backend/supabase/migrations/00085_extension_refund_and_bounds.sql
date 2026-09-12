-- Migration 00085: the extension path's two real defects, both found in review
-- before either reached production.
--
-- `00079` shipped extension: `reserve_generation_operation` takes
-- `p_extend_to_chapter` and raises `planned_chapter_count` inside the same
-- transaction that deducts the credit. Two things were wrong with it.
--
-- ## 1. A refunded extension kept the plan it raised
--
-- `refund_generation_operation` (00077) never learned about the raise, so a
-- refunded reservation returned the credit and kept the plan. The story then
-- claimed a chapter it does not have, and the next attempt at that chapter was
-- no longer an extension -- `next > plan` is false -- so it was written as a
-- FINALE. A one-chapter story whose first extension failed could never be
-- extended properly again: the retry closed it.
--
-- Confirmed by executing the chain rather than by reading it: reserve with
-- `p_extend_to_chapter = 2` on a 1-chapter story, refund, and the row still
-- reads 2.
--
-- ## 2. Nothing stopped an extension skipping chapters
--
-- 00079 checked the kind, that the target matched the chapter being reserved,
-- and the ceiling of 15. It never checked that the target is one past what the
-- story already is, though its own column comment promised exactly that.
-- `continue-story` derives the chapter number from the newest stored chapter so
-- no client can skip, but this function is SECURITY DEFINER and reachable by
-- `service_role`, and an invariant enforced only by the caller is a convention
-- waiting for a second caller. A call reserving chapter 10 of a story that owns
-- one would have set the plan to 10, charged for a single chapter, and left a
-- hole nothing ever fills.
--
-- ## Numbering
--
-- Taken from `supabase migration list`, not from the directory, per AGENTS.md:
-- remote's highest applied is `00084`. 00079 is applied; the extension path is
-- unreachable in production regardless, because the deployed functions predate
-- it and never send the flag. Both functions keep their signatures, so
-- `create or replace` is correct and the existing grants are preserved.

alter table public.generation_operations
    add column if not exists plan_raised_from integer;

comment on column public.generation_operations.plan_raised_from is
    'The story''s planned_chapter_count immediately BEFORE this operation raised it, or null when this operation did not raise it. Written only by reserve_generation_operation and read only by refund_generation_operation, which restores it. It exists because "this operation extended the plan" and "this operation was the last chapter of the plan" are otherwise indistinguishable on the row: both have kind=continuation and chapter_number = planned_chapter_count.';

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

    -- The plan raise, taken BEFORE the debit and inside the same transaction.
    --
    -- Deliberately after the replay branch above: a retried request whose
    -- first attempt already extended the story must not extend it a second
    -- time. It returns the earlier reservation and never reaches here.
    --
    -- Every refusal below raises KTH03 rather than silently declining to
    -- extend, because the alternative is charging a credit for a chapter the
    -- story will then refuse to number. The edge function checks the same
    -- rules against the row it read; these are the checks that hold under the
    -- lock, where a second tap racing the first cannot slip past them.
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
        --
        -- 00079 checked the kind, that the target matched the chapter being
        -- reserved, and the ceiling of 15 -- but never that the target is the
        -- plan plus one, while the column comment and the flow document both
        -- asserted exactly that. `continue-story` derives the chapter number
        -- from the newest stored chapter so it cannot skip, but this function
        -- is SECURITY DEFINER and service-role callable, and an invariant that
        -- lives only in the caller is not an invariant.
        --
        -- What it prevented: a call reserving chapter 10 of a story that has
        -- one chapter would have set the plan to 10 and charged for a single
        -- chapter, leaving a story that claims ten chapters, owns two, and has
        -- a hole where three through nine should be. Every later continuation
        -- numbers from the newest chapter, so the gap never closes.
        -- The bound is ONE PAST WHAT THE STORY ALREADY IS, and "what it
        -- already is" is the larger of its plan and its chapters.
        --
        -- Written as `<> plan + 1` first, which was wrong twice over: it
        -- refused the in-plan flag 00079 deliberately treats as a paid no-op
        -- (its own comment calls it "an ordinary in-plan continuation that
        -- happened to send the flag", and a 00079 test pins it), and it read a
        -- legacy series with a null plan and five chapters as a three-chapter
        -- story -- so extending it to six was refused for ever while the
        -- reader was told it "cannot be extended any further".
        --
        -- `>` rather than `<>` keeps the no-op; the chapter count in the floor
        -- fixes the legacy row. Skipping is still refused, which is the whole
        -- reason the check exists: chapter 10 of a story that owns one would
        -- set the plan to 10, charge for a single chapter, and leave a hole
        -- nothing ever fills.
        select pg_catalog.max(c.chapter_number)
        into v_written
        from public.chapters c
        where c.story_id = p_story_id;

        -- The bound applies to the path that actually RAISES the plan. A flag
        -- sent for a chapter already inside the plan changes nothing, and
        -- 00079 deliberately made that a paid no-op; refusing it there was the
        -- first version's mistake.
        --
        -- When it does raise, the target must be exactly one past what the
        -- story ALREADY IS -- the larger of its plan and the chapters it owns,
        -- not merely "not too far past". Bounding only the upper side let a
        -- service-role caller jump the plan from 1 to 10 on a story with one
        -- chapter, charging for a single chapter and leaving a hole nothing
        -- fills, because every later continuation numbers from the newest
        -- chapter.
        --
        -- The floor takes BOTH, and each half is load-bearing. Written alone
        -- refuses the ordinary case: `begin_story_generation` records no
        -- chapter row, so a plan-3 story with nothing written yet would be
        -- unable to extend to 4. Plan alone refuses the legacy case: a null
        -- plan reads as 3 while the story owns five chapters, so extending to
        -- six would be refused for ever.
        if p_extend_to_chapter > coalesce(v_planned, 3)
           and p_extend_to_chapter
               <> greatest(coalesce(v_planned, 3), coalesce(v_written, 0)) + 1
        then
            raise exception using
                errcode = 'KTH03',
                message = 'Story cannot be extended';
        end if;

        -- Monotonic, and a no-op when the plan already covers this chapter:
        -- an ordinary in-plan continuation that happened to send the flag must
        -- not be able to SHRINK a story.
        if coalesce(v_planned, 3) < p_extend_to_chapter then
            update public.stories
            set planned_chapter_count = p_extend_to_chapter
            where id = p_story_id;
            -- Recorded so a refund can put back exactly this, and so that an
            -- operation which did NOT raise the plan is distinguishable from
            -- one that did. `v_planned` is the value read under the lock a few
            -- lines above, so it is the plan as it was before this statement.
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
    -- being unplanned and not surcharged for it; the reader is buying one more
    -- chapter of the same story, at the same price the chapter before it cost.
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
        'result_chapter_id', v_operation.result_chapter_id,
        'replayed', false,
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
            v_expected_refund := case
                when v_operation.kind = 'story'
                    then least(v_expected_refund, v_original_debit)
                -- An illustrated chapter was debited 2. Refunding 1 would keep
                -- the credit that bought art for a chapter that was never
                -- written.
                else v_original_debit
            end;
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

        /*
          GIVE THE PLAN BACK TOO, not just the credit.

          An extension raises `planned_chapter_count` inside the reservation
          (00079), and nothing lowered it when that reservation was refunded.
          The credit came back and the plan did not, so the story was left
          claiming a chapter it does not have -- and the damage was not cosmetic:

            * the next attempt at that chapter is no longer an extension, since
              `next > planned` is now false, so `continue-story` writes it as a
              FINALE -- chapter_role 'finale', hook_type 'none',
              next_chapter_pressure blanked. A one-chapter story whose first
              extension failed could never be extended properly again.
            * Home offers "finish your series, 1 of 2" for a story its author
              planned at one chapter.
            * an auto story writes the raised chapter by itself on the next
              pass, because it reads the same false plan.

          READ FROM THE ROW, NOT INFERRED. The first version restored
          `chapter_number - 1` whenever the plan equalled the chapter -- which
          is also true of an ordinary LAST in-plan chapter. A three-chapter
          story whose chapter 3 failed had its plan quietly cut to 2: the story
          became "complete" one chapter early and its ending was unreachable.
          `plan_raised_from` is null unless this operation actually raised the
          plan, so an in-plan failure now restores nothing.

          The other two conditions are still load-bearing:

            * `planned_chapter_count = chapter_number` -- the plan is still the
              one this operation set. If a later extension raised it further,
              lowering it here would corrupt that story instead.
            * no `chapters` row at that number -- the chapter was never written.
              A refund cannot reach a completed operation, but this makes the
              restore depend on the fact rather than on the status.
            * `chapter_number > 1` -- the CHECK constraint requires at least 1,
              and chapter 1 is never an extension anyway.

          Exact, not approximate: 00081 requires an extension target to be
          exactly `plan + 1`, so restoring to anything but `chapter_number - 1`
          would make the writer's next attempt fail with KTH03.
        */
        if v_operation.plan_raised_from is not null then
            update public.stories s
            set planned_chapter_count = v_operation.plan_raised_from
            where s.id = v_operation.story_id
              and s.planned_chapter_count = v_operation.chapter_number
              and not exists (
                  select 1
                  from public.chapters c
                  where c.story_id = s.id
                    and c.chapter_number = v_operation.chapter_number
              );
        end if;
    end if;

    return pg_catalog.jsonb_build_object(
        'status', 'refunded',
        'balance', v_balance,
        'refunded', true
    );
end;
$$;
