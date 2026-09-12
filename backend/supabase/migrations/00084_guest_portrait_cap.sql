-- 00084: a lifetime ceiling on portraits drawn for an account nobody signed up
-- for.
--
-- 00055 bounded `generate-character-image` at 12 requests per hour per user and
-- named its own gap in the same breath: "an anonymous caller minting sessions
-- can still exceed the per-user cap". Character onboarding (2026-09-11) turned
-- that gap into the product's front door. The aha is now made BEFORE the email
-- is asked for -- `bootstrapUser` mints an anonymous session, the portrait is
-- generated on it, and only then does the flow ask who you are. So the very
-- first thing a brand-new, unverified identity can do is spend real money at
-- the image provider, and a fresh identity is one `signInAnonymously` call away.
--
-- An hourly window is the wrong shape for that. It bounds a runaway loop on one
-- session; it does nothing about a thousand sessions each using their first
-- twelve. What onboarding needs is a bound on how much a person who has never
-- identified themselves may consume in total, and the ceiling has to be small
-- enough that minting a new session to reset it is obviously the cheaper path
-- for an attacker to take -- which is the point. That is a different
-- fact about a different subject, so it gets its own counter.
--
--     guest_portrait_quotas            4 requests / anonymous identity / ever
--     character_portrait_rate_limits   12 requests / 60 minutes / user  (00055)
--
-- Both apply to an anonymous caller, and the hourly one runs first. Neither
-- replaces the other: the window still bounds burst, this bounds total.
--
-- ## Why four
--
-- Onboarding makes exactly one character and offers one reimagine. That is two
-- requests on the happy path. Four leaves room for a failed generation the user
-- retries (a failure calls `release_guest_portrait_request`, so it does not
-- burn a slot -- but a 200 the user simply disliked does) and for a second
-- character made from the library later in the same anonymous session, while
-- still being far below the hourly window. It is also the number the paywall
-- already promises free users -- `FREE_PORTRAITS_PER_ACCOUNT` in
-- `expo/src/lib/entitlements.ts`, `CREDITS_AND_PRICING.md` §9 -- so a guest who
-- signs in has spent the free allowance the product told them about, not a
-- hidden second one.
--
-- ## Why the account id, and not a device
--
-- The obvious counter-key is a device or install identifier, which survives
-- signing out and re-minting a session, and it is the thing this migration
-- deliberately does not use. Katha collects no device identifiers, and starting
-- to collect one -- IDFV, an install UUID, any fingerprint -- is a privacy and
-- App Store disclosure decision, not a rate-limit implementation detail. So the
-- key is `auth.users.id` for the anonymous identity, which we already have, and
-- the residual hole (mint a new anonymous session, get four more) is accepted
-- and stated rather than closed. It is bounded on the other side: 00035 caps
-- fresh guest bootstraps at 3 per network per day, so churning identities to
-- farm portraits runs into that first.
--
-- ## What happens when the guest becomes a named user
--
-- Nothing, on purpose. This counter is consulted only when the verified user
-- payload says `is_anonymous` is true, so it simply stops mattering the moment
-- the identity is converted or abandoned. Named users are not capped by it --
-- their bound is 00055's hourly window today, and the 4-free-then-1-credit
-- ledger when that lands.
--
-- Specifically, `claim_guest_characters` (00082) does NOT carry this count to
-- the claiming owner, and this migration does not touch it. 00082 moves
-- `user_characters` rows and nothing else; adding the guest's portrait count to
-- a named account would be charging a signed-in person for work done before
-- they signed in, against a cap that does not apply to them. The in-place
-- conversion keeps the same `auth.users.id`, so the row below simply survives
-- next to a profile that no longer reads it. That is the intended end state,
-- not leftover data.
--
-- Failure is a refusal, never an exception: the caller gets `false` and returns
-- a clean 403, the same contract `claim_character_portrait_request` has.

create table if not exists public.guest_portrait_quotas (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    claimed_count smallint not null default 0 check (claimed_count >= 0),
    first_claimed_at timestamptz not null default pg_catalog.now(),
    updated_at timestamptz not null default pg_catalog.now()
);

comment on table public.guest_portrait_quotas is
  'Lifetime cap on generate-character-image for an anonymous identity. Never reset, never carried to a named account; see 00084.';

alter table public.guest_portrait_quotas enable row level security;

-- No policy, deliberately, for the same reason 00055 declares none: with RLS on
-- and no policy, `anon` and `authenticated` read nothing and write nothing, and
-- the two security-definer functions below are the only door. This is also why
-- it is a table of its own rather than a column on `profiles` -- `profiles` is
-- selectable by its owner and carries column-level UPDATE grants for
-- `authenticated` (00038), so an abuse counter living there would be readable
-- by the account it bounds and one forgotten column in a future grant list away
-- from being writable by it. It is not a column on
-- `character_portrait_rate_limits` either: that table's whole contract is that
-- its counter RESETS when the window rolls, and a lifetime total sitting one
-- line away from a `request_count = 1` is a trap set for the next person.

create or replace function public.claim_guest_portrait_request(
    p_user_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_claimed smallint;
    v_max constant smallint := 4;
begin
    if p_user_id is null then
        return false;
    end if;

    -- Serialised per identity so two simultaneous taps cannot both read the
    -- same count and both write count + 1. An advisory lock rather than a row
    -- lock because the row does not exist until the first request.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('guest-portrait:' || p_user_id::text, 0)
    );

    select claimed_count into v_claimed
    from public.guest_portrait_quotas
    where user_id = p_user_id
    limit 1;

    if v_claimed is not null and v_claimed >= v_max then
        return false;
    end if;

    insert into public.guest_portrait_quotas (user_id, claimed_count)
    values (p_user_id, 1)
    -- The guard is restated here rather than trusted from the select above: a
    -- concurrent first request can still win the race between the two if its
    -- advisory lock was taken in a transaction that has since committed.
    on conflict (user_id) do update
        set claimed_count = public.guest_portrait_quotas.claimed_count + 1,
            updated_at = pg_catalog.now()
        where public.guest_portrait_quotas.claimed_count < v_max;

    -- `not found` here means the ON CONFLICT guard refused the update, which is
    -- the race above losing. Treat it exactly like being at the cap.
    if not found then
        return false;
    end if;

    return true;
end;
$$;

comment on function public.claim_guest_portrait_request(uuid) is
  'Claims one of an anonymous identity lifetime portrait slots. Returns false once 4 are spent. Service role only; see 00084.';

-- The other half of the claim, and the reason the cap is honest.
--
-- `generate-character-image` has no credit reservation to refund, so a claim
-- that is never released is a slot the user paid for with a failed generation.
-- Onboarding shows "We couldn't find {Name} this time. / Try again" on that
-- path and promises the retry is free; without this the third failure in a row
-- would silently end the flow. Floors at zero rather than trusting the caller
-- to release once: a double release must not mint a slot.
create or replace function public.release_guest_portrait_request(
    p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_user_id is null then
        return;
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('guest-portrait:' || p_user_id::text, 0)
    );

    update public.guest_portrait_quotas
    set claimed_count = claimed_count - 1,
        updated_at = pg_catalog.now()
    where user_id = p_user_id
      and claimed_count > 0;
end;
$$;

comment on function public.release_guest_portrait_request(uuid) is
  'Returns an unspent portrait slot after a failed generation. Floors at zero. Service role only; see 00084.';

revoke all on table public.guest_portrait_quotas
    from public, anon, authenticated;
revoke all on function public.claim_guest_portrait_request(uuid)
    from public, anon, authenticated;
revoke all on function public.release_guest_portrait_request(uuid)
    from public, anon, authenticated;
grant execute on function public.claim_guest_portrait_request(uuid)
    to service_role;
grant execute on function public.release_guest_portrait_request(uuid)
    to service_role;
