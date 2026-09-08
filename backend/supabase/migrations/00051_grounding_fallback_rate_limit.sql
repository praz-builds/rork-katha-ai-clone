-- 00051: rate-limit the grounding FALLBACK, not the credit it stands in front of.
--
-- `resolveGrounding` is started in `generate-story` / `generate-story-stream`
-- *before* `begin_story_generation`, and deliberately so -- that ordering is
-- what lets the classifier's ~9s budget overlap `begin_story_generation`'s
-- measured 1.4-2.2s round trip instead of adding to every paid generation. See
-- the long comment at that call site for the full argument; this migration
-- does not reorder it.
--
-- The residual that ordering leaves open: a request that `begin_story_generation`
-- will go on to reject -- no credits, or a replayed request id -- has already
-- paid for an LLM classification call, because grounding started first. A
-- caller with zero credits can replay that for free, over and over, and the
-- entity cache in 00045 does not save it: a *novel* idea each time still costs
-- one real classification call.
--
-- This is the fallback's limit specifically, not shaping's (00034 already
-- bounds `shape-story`) and not generation itself (credits already bound
-- that). It only ever gates the branch where the client sent no cards -- the
-- unshaped Create-studio path -- because that is the only branch that starts
-- `resolveGrounding` here at all.
--
-- Two windows, mirroring the split 00034 and 00035 already use for the same
-- reason: a signed-in identity is durable, but an anonymous one is not -- a
-- fresh anonymous JWT is free to mint, so a per-user_id counter alone resets
-- itself on every new session. A coarse, salted network scope (the same
-- `anonymousGrantScope` fingerprint 00035 already computes) is what actually
-- bounds that.
--
--     grounding_fallback_rate_limits            8 requests / 10 minutes / user
--     anonymous_grounding_fallback_rate_limits  15 requests / 60 minutes / network
--
-- Why these numbers: the fallback fires at most once per `generate-story` call,
-- and a real writer in the Create studio is not starting eight ungrounded
-- generations inside ten minutes -- each one is a deliberate, several-second
-- action, and most callers shape first, which skips the fallback entirely.
-- Eight is comfortably above any real retry-after-failure burst while capping
-- a credit-less loop at 48/hour. The network window is wider (an hour, not ten
-- minutes) and slightly more generous in absolute count (15) because it has to
-- cover several genuine people sharing one connection, not one caller; it
-- still caps a script that mints a fresh anonymous session per request to 15
-- classification calls per hour per network, regardless of how many sessions
-- it mints.
--
-- Deliberately no global daily table here, unlike 00034/00035's shared budget.
-- Both of those protect a *paid* resource (a free credit grant, a free
-- shaping call available to every visitor with no credit check at all). This
-- protects only an LLM call that stands in front of a credit check the caller
-- still has to pass to get anything paid-for; the per-network cap above is
-- already the bound that matters, and a second global table would only add a
-- row lock to a check that has to stay a few milliseconds.
--
-- Cost: `claim_grounding_fallback_request` is one RPC round trip. Internally
-- it is one or two primary-key reads behind an in-memory advisory lock, same
-- shape as `claim_story_shape_request` -- no sequential scan, no join.

create table if not exists public.grounding_fallback_rate_limits (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    window_started_at timestamptz not null default pg_catalog.now(),
    request_count smallint not null default 0 check (request_count >= 0)
);

alter table public.grounding_fallback_rate_limits enable row level security;

create table if not exists public.anonymous_grounding_fallback_rate_limits (
    scope_hash text primary key check (scope_hash ~ '^[a-f0-9]{64}$'),
    window_started_at timestamptz not null default pg_catalog.now(),
    request_count smallint not null default 0
        check (request_count >= 0 and request_count <= 100)
);

alter table public.anonymous_grounding_fallback_rate_limits enable row level security;

-- Checks the network scope first (when the caller is anonymous), then the
-- per-user counter, so a request already refused at the network level never
-- consumes a unit of the per-user budget it will never get to use again this
-- window. Returns false on either limit; the caller's contract (in
-- `_shared/grounding-rate-limit.ts`) is that false means "generate ungrounded",
-- never an error.
create or replace function public.claim_grounding_fallback_request(
    p_user_id uuid,
    p_anonymous_scope_hash text default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_limit public.grounding_fallback_rate_limits;
    v_anonymous_limit public.anonymous_grounding_fallback_rate_limits;
begin
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('grounding-fallback:' || p_user_id::text, 0)
    );

    if p_anonymous_scope_hash is not null then
        if p_anonymous_scope_hash !~ '^[a-f0-9]{64}$' then
            raise exception 'Invalid anonymous grounding fallback scope';
        end if;

        perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(
                'grounding-fallback-network:' || p_anonymous_scope_hash, 0
            )
        );

        select * into v_anonymous_limit
        from public.anonymous_grounding_fallback_rate_limits
        where scope_hash = p_anonymous_scope_hash
        for update;

        if not found then
            insert into public.anonymous_grounding_fallback_rate_limits (
                scope_hash, request_count
            ) values (p_anonymous_scope_hash, 1);
        elsif v_anonymous_limit.window_started_at
                <= pg_catalog.now() - interval '60 minutes' then
            update public.anonymous_grounding_fallback_rate_limits
            set window_started_at = pg_catalog.now(), request_count = 1
            where scope_hash = p_anonymous_scope_hash;
        elsif v_anonymous_limit.request_count >= 15 then
            return false;
        else
            update public.anonymous_grounding_fallback_rate_limits
            set request_count = request_count + 1
            where scope_hash = p_anonymous_scope_hash;
        end if;
    end if;

    select * into v_limit
    from public.grounding_fallback_rate_limits
    where user_id = p_user_id
    for update;

    if not found then
        insert into public.grounding_fallback_rate_limits (user_id, request_count)
        values (p_user_id, 1);
        return true;
    end if;

    if v_limit.window_started_at <= pg_catalog.now() - interval '10 minutes' then
        update public.grounding_fallback_rate_limits
        set window_started_at = pg_catalog.now(), request_count = 1
        where user_id = p_user_id;
        return true;
    end if;

    if v_limit.request_count >= 8 then
        return false;
    end if;

    update public.grounding_fallback_rate_limits
    set request_count = request_count + 1
    where user_id = p_user_id;
    return true;
end;
$$;

comment on function public.claim_grounding_fallback_request(uuid, text) is
  'Rate-gates the grounding fallback in generate-story / generate-story-stream: 8 requests per 10 minutes per user, and (for anonymous callers) 15 per 60 minutes per hashed network scope. False means skip the fallback and generate ungrounded, never an error. Never called for the shaped path, where the client already supplied cards.';

-- Service-role only, same posture as 00034's shaping limits and 00045's
-- grounding cache: these tables carry no user-facing read and no client should
-- ever be able to reset or enumerate them.
revoke all on table public.grounding_fallback_rate_limits
    from public, anon, authenticated;
revoke all on table public.anonymous_grounding_fallback_rate_limits
    from public, anon, authenticated;
revoke all on function public.claim_grounding_fallback_request(uuid, text)
    from public, anon, authenticated;
grant execute on function public.claim_grounding_fallback_request(uuid, text)
    to service_role;
