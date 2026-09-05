-- Migration 00039: a rejected story-shape request must not spend the budget
--
-- 00034 incremented the anonymous counters as soon as the global ceiling was
-- clear, and only then read the per-user limit -- which can return false. A
-- plpgsql `return` inside a function is not a rollback, so the increments it
-- has already made are committed by the caller's transaction. A guest whose
-- per-minute limit has run out therefore still consumed one of the project's
-- 500 daily anonymous shape requests on every retry, and a client polling in a
-- tight loop could exhaust the global budget for everybody without ever
-- receiving a single shape.
--
-- The fix is ordering, not policy: decide first, write afterwards. Every limit
-- is read and checked before any counter moves, so the only path that reaches
-- a write is the one that is going to return true. Limits, windows, locks and
-- error text are carried forward from 00034 unchanged.

create or replace function public.claim_story_shape_request(
    p_user_id uuid,
    p_anonymous_scope_hash text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_limit public.story_shape_rate_limits;
    v_anonymous_limit public.anonymous_story_shape_rate_limits;
    v_anonymous_action text;
    v_user_action text;
    v_global_count integer;
begin
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('story-shape:' || p_user_id::text, 0)
    );

    -- ---------------------------------------------------------------------
    -- Decide
    -- ---------------------------------------------------------------------

    if p_anonymous_scope_hash is not null then
        if p_anonymous_scope_hash !~ '^[a-f0-9]{64}$' then
            raise exception 'Invalid anonymous story shape scope';
        end if;

        perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('story-shape-network:' || p_anonymous_scope_hash, 0)
        );
        perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('story-shape-global:' || (pg_catalog.now()::date)::text, 0)
        );

        insert into public.anonymous_story_shape_global_limits (window_key, request_count)
        values (pg_catalog.now()::date, 0)
        on conflict (window_key) do nothing;

        select request_count into v_global_count
        from public.anonymous_story_shape_global_limits
        where window_key = pg_catalog.now()::date
        for update;

        if v_global_count >= 500 then
            return false;
        end if;

        select * into v_anonymous_limit
        from public.anonymous_story_shape_rate_limits
        where scope_hash = p_anonymous_scope_hash
        for update;

        if not found then
            v_anonymous_action := 'insert';
        elsif v_anonymous_limit.window_started_at <= pg_catalog.now() - interval '24 hours' then
            v_anonymous_action := 'reset';
        elsif v_anonymous_limit.request_count >= 30 then
            return false;
        else
            v_anonymous_action := 'increment';
        end if;
    end if;

    select * into v_limit
    from public.story_shape_rate_limits
    where user_id = p_user_id
    for update;

    if not found then
        v_user_action := 'insert';
    elsif v_limit.window_started_at <= pg_catalog.now() - interval '1 minute' then
        v_user_action := 'reset';
    elsif v_limit.request_count >= 6 then
        return false;
    else
        v_user_action := 'increment';
    end if;

    -- ---------------------------------------------------------------------
    -- Apply: past this point the request is granted, so every counter moves
    -- ---------------------------------------------------------------------

    if p_anonymous_scope_hash is not null then
        if v_anonymous_action = 'insert' then
            insert into public.anonymous_story_shape_rate_limits (scope_hash, request_count)
            values (p_anonymous_scope_hash, 1);
        elsif v_anonymous_action = 'reset' then
            update public.anonymous_story_shape_rate_limits
            set window_started_at = pg_catalog.now(), request_count = 1
            where scope_hash = p_anonymous_scope_hash;
        else
            update public.anonymous_story_shape_rate_limits
            set request_count = request_count + 1
            where scope_hash = p_anonymous_scope_hash;
        end if;

        update public.anonymous_story_shape_global_limits
        set request_count = request_count + 1
        where window_key = pg_catalog.now()::date;
    end if;

    if v_user_action = 'insert' then
        insert into public.story_shape_rate_limits (user_id, request_count)
        values (p_user_id, 1);
    elsif v_user_action = 'reset' then
        update public.story_shape_rate_limits
        set window_started_at = pg_catalog.now(), request_count = 1
        where user_id = p_user_id;
    else
        update public.story_shape_rate_limits
        set request_count = request_count + 1
        where user_id = p_user_id;
    end if;

    return true;
end;
$$;

revoke all on function public.claim_story_shape_request(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_story_shape_request(uuid, text) to service_role;
