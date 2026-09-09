-- Migration 00056 (was 00046, renumbered 2026-09-09: version collided with 00046_engagement_persistence in schema_migrations): the preview is not a rationed resource
--
-- 00034 gave story shaping three limits and 00039 fixed the order they were
-- read in. Two of the three were ceilings on how many people could see a
-- shaped preview at all:
--
--   * 500 shapes a day across every anonymous user in the project, and
--   * 30 a day per anonymous network scope.
--
-- The first is a cap on the product. Onboarding is anonymous, so the five
-- hundredth new user of the day was the last one who could be shown a shaped
-- preview; everyone after them got the same empty answer as a malformed
-- response. The second is worse per person and quieter: a scope is a network,
-- so one office, cafe or campus shares thirty previews a day between everyone
-- on it, and a room full of people trying the product at once is exactly the
-- situation where they run out.
--
-- Neither number was protecting the thing it looked like it was protecting.
-- A ceiling shared by strangers cannot stop an abuser - it only decides which
-- innocent user absorbs the abuse - and the abuser and the writer were being
-- charged against the same budget. Both are removed here.
--
-- What survives is the per-user window: six requests a minute, unchanged. That
-- is the limit that actually addresses the failure it is named for, because it
-- is scoped to the caller doing the damage. A client stuck in a retry loop is
-- still stopped in the same second it starts; a person writing a story never
-- reaches it.
--
-- `p_anonymous_scope_hash` stays in the signature and is now ignored. The
-- parameter is not dropped because the deployed `shape-story` still passes it
-- and function deploys are not atomic with migrations: accepting and ignoring
-- it makes both deploy orders correct, where an arity change would make one of
-- them a hard failure for as long as the window lasted.
--
-- `anonymous_story_shape_rate_limits` and `anonymous_story_shape_global_limits`
-- are deliberately left in place, no longer read and no longer written. They
-- are dead as of this migration and dropping them is a separate, destructive
-- decision that should be taken on its own and not smuggled in behind a policy
-- change. Whoever takes it: nothing reads them after this file.

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
    v_user_action text;
begin
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('story-shape:' || p_user_id::text, 0)
    );

    -- ---------------------------------------------------------------------
    -- Decide
    -- ---------------------------------------------------------------------
    -- 00039's ordering rule is kept even though only one limit is left: read
    -- and decide before any counter moves, so a refused claim never spends
    -- part of the budget it was refused by.

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
    -- Apply
    -- ---------------------------------------------------------------------

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
