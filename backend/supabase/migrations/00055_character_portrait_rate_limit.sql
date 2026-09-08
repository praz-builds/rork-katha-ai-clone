-- 00055: bound `generate-character-image`, which spends money with nothing in
-- front of it.
--
-- Every other paid path in this codebase passes a gate before it costs
-- anything. `generate-story` opens with `begin_story_generation`: idempotency
-- check, story row, credit reservation, in one RPC. `regenerate-cover` charges
-- after the first free retry. `shape-story` is free but rate-limited by 00034.
--
-- `generate-character-image` had none of the three. No credit, no rate limit,
-- no idempotency key -- and it is not cheap. One call enters `runImageChain`,
-- which walks two Gemini providers across three safety levels, so a single
-- request can be up to **six** paid image generations at roughly $0.039-$0.077
-- each. Since 2026-09-09 it also accepts a style-reference photo of up to 6 MB
-- of base64, re-sent on every rung that keeps it, so the input tokens are not
-- free either.
--
-- The client offers no protection worth the name: the Craft sheet mints a
-- fresh request id on every tap, so there is no dedupe key to collide on, and
-- its in-flight guard is React state -- true only for a browser that is
-- running our code.
--
-- ## What this is, and what it is not
--
-- This is a rate limit, not pricing. `CREDITS_AND_PRICING.md` §10.6 records
-- that per-cast portraits have no settled credit cost, and inventing one in a
-- migration would be making a pricing decision in the wrong place. A cap does
-- not need that decision to be made: it bounds the damage a loop can do while
-- leaving the product question open.
--
--     character_portrait_rate_limits   12 requests / 60 minutes / user
--
-- Why twelve. A cast is capped at 3 characters, and a writer who reimagines
-- every one of them four times has done a great deal of deliberate work in an
-- hour. Twelve is comfortably above that and caps a runaway loop at 12 calls
-- an hour per account -- at the very worst 72 provider requests, versus the
-- unbounded number available before.
--
-- One window, not two. 00051 needed a second network-scoped window because the
-- thing it guards runs BEFORE any credit check, so a fresh anonymous JWT was
-- free to mint and reset the counter. That reasoning applies here too, and is
-- the honest gap in this migration: an anonymous caller minting sessions can
-- still exceed the per-user cap. It is bounded rather than closed because the
-- portrait path already requires a resolved user, and because adding a
-- network-scoped table means carrying the request into a place that currently
-- only sees a user id. Recorded here so the next person does not mistake the
-- omission for a judgement that it is safe.
--
-- Failure is a refusal, never an exception: the caller gets `false` and returns
-- a clean 429, the same contract `claim_grounding_fallback_request` has.

create table if not exists public.character_portrait_rate_limits (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    window_started_at timestamptz not null default pg_catalog.now(),
    request_count smallint not null default 0 check (request_count >= 0)
);

comment on table public.character_portrait_rate_limits is
  'Per-user hourly cap on generate-character-image. Bounds provider spend on a path with no credit check; see 00055 for why this is a cap and not a price.';

alter table public.character_portrait_rate_limits enable row level security;

-- No policy is declared on purpose. With RLS enabled and no policy, `anon` and
-- `authenticated` can read nothing and write nothing; the function below is
-- `security definer` and is the only door. A counter a client can reset is not
-- a rate limit.

create or replace function public.claim_character_portrait_request(
    p_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_limit public.character_portrait_rate_limits;
    v_window constant interval := interval '60 minutes';
    v_max constant smallint := 12;
begin
    if p_user_id is null then
        return false;
    end if;

    -- Serialised per user so two simultaneous taps cannot both read the same
    -- count and both write count + 1. An advisory lock rather than a row lock
    -- because the row may not exist yet on the first request.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('character-portrait:' || p_user_id::text, 0)
    );

    select * into v_limit
    from public.character_portrait_rate_limits
    where user_id = p_user_id
    limit 1;

    if not found then
        insert into public.character_portrait_rate_limits
            (user_id, window_started_at, request_count)
        values (p_user_id, pg_catalog.now(), 1)
        -- A concurrent first request can win the race between `select` and
        -- here even under the advisory lock if the lock was taken in another
        -- transaction that has since committed.
        on conflict (user_id) do update
            set request_count = public.character_portrait_rate_limits.request_count + 1;
        return true;
    end if;

    -- A rolling window, restarted rather than decayed: simpler to reason about
    -- than a sliding count, and the difference does not matter at this cap.
    if v_limit.window_started_at < pg_catalog.now() - v_window then
        update public.character_portrait_rate_limits
        set window_started_at = pg_catalog.now(),
            request_count = 1
        where user_id = p_user_id;
        return true;
    end if;

    if v_limit.request_count >= v_max then
        return false;
    end if;

    update public.character_portrait_rate_limits
    set request_count = public.character_portrait_rate_limits.request_count + 1
    where user_id = p_user_id;
    return true;
end;
$$;

revoke all on table public.character_portrait_rate_limits
    from public, anon, authenticated;
revoke all on function public.claim_character_portrait_request(uuid)
    from public, anon, authenticated;
grant execute on function public.claim_character_portrait_request(uuid)
    to service_role;
