-- Migration 00079: a story's plan is a range, and a reader can raise it one
-- chapter at a time in the same transaction that pays for the chapter.
--
-- Two things change, and they are one feature.
--
-- 1. `stories_planned_chapter_count_check` becomes a RANGE. Since 00027 it has
--    been `IN (3, 7, 15)`, which was true while the picker was the only writer
--    of the column. The picker now also offers 1, and -- more importantly -- a
--    reader at the end of a finished story can extend it, which raises the
--    stored plan by exactly one. So 2, 4, 5, 8 and every other value up to the
--    ceiling are legitimate rows. 15 stays the ceiling: a story that wants
--    more than fifteen chapters is a new story.
--
-- 2. `reserve_generation_operation` learns `p_extend_to_chapter`. The raise
--    MUST happen inside the reservation and not beside it. Issued as its own
--    statement from the edge function it would be a second transaction, and
--    both orderings are broken in production-visible ways: raise-then-reserve
--    leaves a story permanently claiming a chapter that a 402 meant nobody
--    ever paid for, and reserve-then-raise debits the credit and then -- if
--    the worker dies in between, or the update loses a race -- refuses the
--    very chapter it just charged for. Inside the RPC the raise sits behind
--    the same `pg_advisory_xact_lock` on the story that already serialises
--    concurrent chapter reservations, and commits with the debit or not at all.
--
-- Safe against live data. 00075-00078 are deployed; the new constraint is
-- strictly WIDER than the one it replaces, so every existing row (all of them
-- 3, 7, 15 or null) satisfies it. That is why this one is validated here
-- rather than deferred to a follow-up the way 00027 had to defer to 00028 --
-- a widening check cannot fail validation.
--
-- Repo rule this migration is written under (00071 paid for it): NULLIF,
-- COALESCE, GREATEST and LEAST are parser constructs, not `pg_catalog`
-- functions. Under `set search_path = ''` every real function is qualified and
-- these four must NOT be -- qualifying one raises 42883 at RUN time, long
-- after the migration deployed cleanly.

-- ---------------------------------------------------------------------------
-- 1. The plan is a bounded range
-- ---------------------------------------------------------------------------

alter table public.stories
  drop constraint if exists stories_planned_chapter_count_check;

alter table public.stories
  add constraint stories_planned_chapter_count_check
  check (
    planned_chapter_count is null
    or (planned_chapter_count >= 1 and planned_chapter_count <= 15)
  )
  not valid;

alter table public.stories
  validate constraint stories_planned_chapter_count_check;

comment on column public.stories.planned_chapter_count is
  'How many chapters this story is planned to run: null, or 1..15. The picker offers 1, 3, 7 and 15; every other value in range is reached by a reader extending a finished story one chapter at a time (reserve_generation_operation.p_extend_to_chapter).';

-- ---------------------------------------------------------------------------
-- 2. reserve_generation_operation
-- ---------------------------------------------------------------------------
-- 00077's body, with the plan raise folded in.
--
-- Dropped and recreated rather than replaced, for the reason 00075/00076/00077
-- each recorded: a parameter list of a different length is a different
-- function to Postgres, so `create or replace` would leave the 6-argument
-- version standing beside this one and a 6-argument call would then have two
-- equally good candidates. The new parameter is LAST and defaulted, which is
-- what keeps the currently deployed `continue-story`, `reimagine-chapter` and
-- `cover-regeneration` -- none of which name it -- resolving here during the
-- window where code and schema disagree. An older deploy resolving here passes
-- null and extends nothing, which is exactly what it does today.

drop function if exists public.reserve_generation_operation(
    uuid, text, uuid, integer, text, boolean
);

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

        -- Monotonic, and a no-op when the plan already covers this chapter:
        -- an ordinary in-plan continuation that happened to send the flag must
        -- not be able to SHRINK a story.
        if coalesce(v_planned, 3) < p_extend_to_chapter then
            update public.stories
            set planned_chapter_count = p_extend_to_chapter
            where id = p_story_id;
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

revoke all on function public.reserve_generation_operation(uuid, text, uuid, integer, text, boolean, integer)
from public, anon, authenticated;
grant execute on function public.reserve_generation_operation(uuid, text, uuid, integer, text, boolean, integer)
to service_role;
comment on function public.reserve_generation_operation(uuid, text, uuid, integer, text, boolean, integer)
    is 'Service-only. Reserves one generation operation and debits its price: 1 credit, or 2 for a continuation of a story whose illustrate_chapters is true (CREDITS_AND_PRICING.md section 1). p_extend_to_chapter raises a series'' planned_chapter_count to that chapter in the same transaction, capped at 15, and raises KTH03 if it cannot.';
