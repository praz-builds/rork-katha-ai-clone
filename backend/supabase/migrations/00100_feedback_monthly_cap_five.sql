-- 00100: the feedback claim's monthly cap drops from six to five.
--
-- WHY. A product-owner decision on 2026-09-27, recorded in
-- `source-of-truth/CREDITS_AND_PRICING.md`, section "Feedback credits -- the
-- claimed comment". Nothing else about the mechanic moves: still 1 credit per
-- comment, still 40 characters, still a qualifying read before the comment,
-- still one per story and one per UTC day, still frozen once paid. Only the
-- monthly ceiling changes.
--
-- The cap is load-bearing, not a tuning knob -- principle 7 holds steady-state
-- earnable free credits at or below half the cheapest paid tier, and the
-- feedback claim is the only recurring earn in the product. Five moves further
-- inside that line than six did; the document carries the arithmetic.
--
-- WHAT THIS TOUCHES. Two functions, one number each:
--
--   `comment_credit_block_reason`  the `monthly_cap` predicate, 6 -> 5
--   `comment_credit_claims`        the `remaining.month` readout, 6 -> 5
--
-- `claim_comment_credit` is deliberately NOT redefined. It re-derives its
-- verdict by calling `comment_credit_block_reason` under the advisory lock
-- immediately before it pays, so the enforcement stays in exactly one place
-- and a second copy of the number here would be a second place to get wrong.
--
-- WHICH BODY EACH ONE IS COPIED FROM, AND WHY IT MATTERS.
-- `create or replace` replaces whatever is live, so a replacement built from
-- the wrong ancestor silently reverts everything added in between. These two
-- functions have different latest definitions:
--
--   `comment_credit_block_reason`  last defined in **00090**, which added the
--                                  60-second server-set read gate on top of
--                                  00089's 120-second duration sum. Both
--                                  refusals report `not_read`. 00090 also
--                                  attached a `comment on function`, which a
--                                  bare replace would drop, so it is restated.
--   `comment_credit_claims`        last defined in **00089**; never revised.
--
-- Copying 00089's block-reason body here would have re-opened the one-request
-- forgery 00090 closed. 00090's test caught it. Each body below is therefore
-- its own latest version reproduced verbatim apart from the digit, so a diff
-- against that ancestor shows the change and nothing else.
--
-- `create or replace` does not carry grants forward reliably, so both
-- revoke/grant pairs are restated rather than assumed.
--
-- NO BACKFILL, AND NOTHING TO MIGRATE. The caps are counted from
-- `credit_ledger` at claim time, never stored. Somebody who has already been
-- paid six times this calendar month keeps all six -- they are spent or
-- spendable and are not clawed back -- and is simply refused the seventh,
-- as they would have been anyway. From next month the ceiling is five.

create or replace function public.comment_credit_block_reason(
    p_user_id uuid,
    p_comment_id uuid
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_comment public.comments;
    v_author_id uuid;
    v_day_start timestamptz := (pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'UTC')) at time zone 'UTC';
    v_month_start timestamptz := (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')) at time zone 'UTC';
begin
    select * into v_comment from public.comments where id = p_comment_id;
    if not found or v_comment.user_id is distinct from p_user_id then
        return 'invalid';
    end if;

    if v_comment.credit_claimed_at is not null then
        return 'already_claimed';
    end if;

    if exists (select 1 from public.tester_accounts t where t.user_id = p_user_id) then
        return 'tester';
    end if;

    if v_comment.deleted_at is not null then
        return 'deleted';
    end if;

    if pg_catalog.char_length(pg_catalog.btrim(coalesce(v_comment.content, ''))) < 40 then
        return 'too_short';
    end if;

    select author_id into v_author_id from public.stories where id = v_comment.story_id;
    if v_author_id is null or v_author_id = p_user_id then
        return 'own_story';
    end if;

    if exists (
        select 1 from public.content_reports r
        where r.comment_id = p_comment_id and r.status = 'actioned'
    ) then
        return 'reported';
    end if;

    -- A qualifying read is two minutes on the story, recorded before the
    -- comment. `story_reads` carries one duration per chapter read, so the
    -- story's reads are summed: two minutes across three chapters is a read.
    -- `duration_seconds` is the client's number, so it is necessary and not
    -- sufficient; see the long note above this function.
    if coalesce((
        select pg_catalog.sum(sr.duration_seconds)
        from public.story_reads sr
        where sr.user_id = p_user_id
          and sr.story_id = v_comment.story_id
          and sr.read_at < v_comment.created_at
    ), 0) < 120 then
        return 'not_read';
    end if;

    -- ...and one of those reads has to have been written down by the server a
    -- full minute before the comment was. `read_at` defaults to `now()` and
    -- no caller sets it, which is what makes this the one part of the
    -- evidence a forged request cannot choose.
    if not exists (
        select 1
        from public.story_reads sr
        where sr.user_id = p_user_id
          and sr.story_id = v_comment.story_id
          and sr.read_at <= v_comment.created_at - interval '60 seconds'
    ) then
        return 'not_read';
    end if;

    -- The caps are read from the ledger, not from comments, so deleting a
    -- claimed comment never resets them.
    if exists (
        select 1 from public.credit_ledger l
        where l.user_id = p_user_id
          and l.reason = 'feedback'
          and l.reference_id = v_comment.story_id::text
    ) then
        return 'story_cap';
    end if;

    if exists (
        select 1 from public.credit_ledger l
        where l.user_id = p_user_id
          and l.reason = 'feedback'
          and l.created_at >= v_day_start
    ) then
        return 'daily_cap';
    end if;

    if (
        select pg_catalog.count(*) from public.credit_ledger l
        where l.user_id = p_user_id
          and l.reason = 'feedback'
          and l.created_at >= v_month_start
    ) >= 5 then
        return 'monthly_cap';
    end if;

    return null;
end;
$$;

comment on function public.comment_credit_block_reason(uuid, uuid) is
    'Why this comment cannot be claimed for a feedback credit, or null. The read gate needs both: 120 seconds of client-reported duration across the story, and at least one read whose server-set read_at is 60 seconds older than the comment. Both refusals report not_read.';

revoke all on function public.comment_credit_block_reason(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.comment_credit_block_reason(uuid, uuid) to service_role;

create or replace function public.comment_credit_claims(
    p_user_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_claims jsonb;
    v_today integer;
    v_month integer;
    v_day_start timestamptz := (pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'UTC')) at time zone 'UTC';
    v_month_start timestamptz := (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')) at time zone 'UTC';
begin
    select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
            'comment_id', c.id,
            'story_id', c.story_id,
            'story_title', st.title,
            'excerpt', left(c.content, 140),
            'created_at', c.created_at,
            'status', case
                when c.credit_claimed_at is not null then 'claimed'
                when reason.value is null then 'claimable'
                else 'ineligible'
            end,
            'reason', case
                when c.credit_claimed_at is not null then null
                else reason.value
            end
        ) order by c.created_at desc
    ), '[]'::jsonb)
    into v_claims
    from (
        select c.*
        from public.comments c
        join public.stories s on s.id = c.story_id
        where c.user_id = p_user_id
          and s.author_id is distinct from p_user_id
        order by c.created_at desc
        limit 30
    ) c
    join public.stories st on st.id = c.story_id
    cross join lateral (
        select public.comment_credit_block_reason(p_user_id, c.id) as value
    ) reason;

    select count(*)::integer into v_today
    from public.credit_ledger l
    where l.user_id = p_user_id and l.reason = 'feedback' and l.created_at >= v_day_start;

    select count(*)::integer into v_month
    from public.credit_ledger l
    where l.user_id = p_user_id and l.reason = 'feedback' and l.created_at >= v_month_start;

    return pg_catalog.jsonb_build_object(
        'claims', v_claims,
        'remaining', pg_catalog.jsonb_build_object(
            'today', greatest(1 - v_today, 0),
            'month', greatest(5 - v_month, 0)
        )
    );
end;
$$;

revoke all on function public.comment_credit_claims(uuid) from public, anon, authenticated;
grant execute on function public.comment_credit_claims(uuid) to service_role;
