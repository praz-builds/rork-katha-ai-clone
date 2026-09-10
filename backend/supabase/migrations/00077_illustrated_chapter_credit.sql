-- Migration 00077: an illustrated chapter costs two credits, in one
-- transaction, and gives the second one back when the art never arrives.
--
-- `source-of-truth/CREDITS_AND_PRICING.md` §1: starting a story is 3 (cast +
-- chapter 1's words + chapter 1's art, which is the cover), and every chapter
-- after that is **1, or 2 if it is illustrated**. A 3-chapter illustrated story
-- is 7 = 3 + 2 + 2, because `begin_story_generation` deducts 3 to start (see
-- the unresolved pricing note in AGENTS.md: CREDITS_AND_PRICING.md says 1, and
-- the code says 3). Chapter 1's art is bundled into the start price and is
-- never billed a second time.
--
-- Until now `continue-story` reserved the text credit only, because nothing
-- generated chapter art: `stories.illustrate_chapters` has been stored since
-- 00027 and read by nothing. Now that `_shared/media.ts` draws it, the second
-- credit has to be taken with the first, under the same advisory lock and the
-- same operation key. Two reservations would mean a writer whose balance runs
-- out between them gets a chapter whose art was never paid for, or a charge
-- for art against a chapter that was never written.
--
-- Three functions change:
--
-- 1. `reserve_generation_operation` -- takes the price from the STORY ROW, not
--    from the caller, so an illustrated chapter cannot be reserved at the plain
--    price and a plain one cannot be charged the illustrated price.
-- 2. `refund_generation_operation` -- refunds what was actually debited for a
--    continuation. It refunded a flat 1, which would have kept the art credit
--    for art that was never drawn on every failed illustrated chapter.
-- 3. `refund_story_media_component` -- learns the `chapter_art` component, so a
--    chapter whose text was delivered and whose picture failed gives back
--    exactly the picture's credit, the way a failed cover already does.
--
-- Repo rule this migration is written under (00071 paid for it): NULLIF,
-- COALESCE, GREATEST and LEAST are parser constructs, not `pg_catalog`
-- functions. Under `set search_path = ''` every real function is qualified and
-- these four must NOT be -- qualifying one raises 42883 at RUN time, long after
-- the migration deployed cleanly.

-- ---------------------------------------------------------------------------
-- 1. reserve_generation_operation
-- ---------------------------------------------------------------------------
-- 00057's body, with the price made conditional.
--
-- Dropped and recreated rather than replaced: a parameter list of a different
-- length is a different function to Postgres, so `create or replace` would
-- leave the 5-argument version in place beside this one and a 5-argument call
-- would then have two equally good candidates. The new parameter is LAST and
-- defaulted, which is what keeps an older deploy of `continue-story` or
-- `reimagine-chapter` -- neither of which names it -- resolving to this
-- function during the window where code and schema disagree. An older deploy
-- resolving here charges 1, which is exactly what it charges today.

drop function if exists public.reserve_generation_operation(
    uuid, text, uuid, integer, text
);

create or replace function public.reserve_generation_operation(
    p_user_id uuid,
    p_request_id text,
    p_story_id uuid,
    p_chapter_number integer,
    p_kind text,
    p_illustrate_chapter boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operation public.generation_operations;
    v_balance integer;
    v_amount integer := 1;
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

    -- The price, decided here and nowhere else.
    --
    -- The caller asking for art is necessary but not sufficient: the story row
    -- has to say the chapter is illustrated too. `illustrate_chapters` is what
    -- the background art task reads before it draws anything, so a price
    -- derived from anything else could charge for a picture that task will
    -- never make, or hand out one nobody paid for.
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
        'credits', v_amount
    );
end;
$$;

revoke all on function public.reserve_generation_operation(uuid, text, uuid, integer, text, boolean)
from public, anon, authenticated;
grant execute on function public.reserve_generation_operation(uuid, text, uuid, integer, text, boolean)
to service_role;
comment on function public.reserve_generation_operation(uuid, text, uuid, integer, text, boolean)
    is 'Service-only. Reserves one generation operation and debits its price: 1 credit, or 2 for a continuation of a story whose illustrate_chapters is true (CREDITS_AND_PRICING.md section 1).';

-- ---------------------------------------------------------------------------
-- 2. refund_generation_operation
-- ---------------------------------------------------------------------------
-- 00040's body. A continuation is no longer worth a flat 1 credit, so the
-- refund stops assuming it is.
--
-- The debit is the authority: it is the number this user actually paid for
-- this operation, it is already read here to clamp the story case, and it
-- cannot disagree with the price table the way a second hardcoded 1 can. The
-- story case keeps its `least(3, debit)` ceiling -- a story's cast and cover
-- credits are refunded separately by `refund_story_media_component`, and this
-- function must not be able to give back more than the reservation took.

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
    end if;

    return pg_catalog.jsonb_build_object(
        'status', 'refunded',
        'balance', v_balance,
        'refunded', true
    );
end;
$$;

revoke all on function public.refund_generation_operation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.refund_generation_operation(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. refund_story_media_component
-- ---------------------------------------------------------------------------
-- 00034's body, with a third component.
--
-- `cast` and `cover` belong to a 'story' operation that debited 3; `chapter_art`
-- belongs to a 'continuation' that debited 2. Everything else about the refund
-- is identical -- the same per-component operation key for idempotency, the
-- same bucket restoration in grant/purchased/earned order -- which is why this
-- is one function with a component table rather than a second copy of it.

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
    -- component to have been part of it. A refund against an operation that
    -- never bought this component is a credit invented out of nothing.
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

revoke all on function public.refund_story_media_component(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.refund_story_media_component(uuid, uuid, text)
to service_role;
comment on function public.refund_story_media_component(uuid, uuid, text)
    is 'Service-only. Gives back one paid media credit -- the story cast, the story cover, or one chapter''s illustration -- without touching the completed text operation.';
