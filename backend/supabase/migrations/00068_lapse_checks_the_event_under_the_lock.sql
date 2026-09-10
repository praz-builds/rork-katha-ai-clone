-- Migration 00068: the expiration guard belongs inside the lock.
--
-- The change that ships with this one made `revenuecat-webhook` read
-- `revenuecat_subscriptions` back after recording an EXPIRATION and skip the
-- lapse unless this event is the one on record. That closes the ordering hole
-- -- a straggling expiration from the previous period, or an upgrade's
-- old-product expiration arriving after the user moved on -- but it does it
-- with two separate round trips, and between them a concurrent RENEWAL can
-- grant a month of credits that this call then erases. Narrower than the bug
-- it replaced, and still wrong.
--
-- So the check moves to where the money is: inside `lapse_credits`, after the
-- per-user advisory lock that every credit operation already takes.
-- `grant_credit` and `refresh_subscription_grant` take that same lock, so a
-- racing renewal either commits fully before this function reads the
-- subscription row -- in which case its event id is there and we stop -- or
-- waits behind us and grants after the lapse has committed. The window is
-- gone rather than narrowed.
--
-- `p_require_event_id` defaults to null, meaning "lapse unconditionally",
-- which is the behaviour every existing caller and test relies on. Only the
-- webhook passes it. The body below is otherwise character-for-character the
-- one 00026 wrote; the only edit is the guard.
--
-- Unchanged, deliberately: an expiration that IS current still zeroes every
-- bucket, packs and earned credits included. That is decision 37, a product
-- call, and not this migration's to make.

-- The old three-argument signature is DROPPED, not left alongside. Adding a
-- parameter with a default creates an OVERLOAD: `lapse_credits(uuid, text,
-- text)` would still exist, and every existing three-argument call would then
-- fail with "function lapse_credits(...) is not unique". Dropping first is
-- what makes this a replacement.
drop function if exists public.lapse_credits(uuid, text, text);

create or replace function public.lapse_credits(
    p_user_id uuid,
    p_reference_id text,
    p_operation_key text,
    p_require_event_id text default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_buckets public.credit_balance_buckets;
    v_current_balance integer;
    v_recorded_event text;
begin
    -- Deliberate product rule: an expired subscription zeroes every bucket,
    -- including pack and earned credits (CREDITS_AND_PRICING.md decision 37;
    -- §12 open item 5 records the pending App Review confirmation).
    if p_reference_id is null or pg_catalog.btrim(p_reference_id) = ''
       or p_operation_key is null or pg_catalog.btrim(p_operation_key) = '' then
        raise exception 'A reference ID and operation key are required';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );

    -- The supersession check, inside the lock.
    --
    -- `record_revenuecat_subscription` only updates when
    -- `last_event_at <= excluded.last_event_at`, so the row names whichever
    -- subscription event is most recent. If that is not the event asking for
    -- this lapse, the expiration has been overtaken and must not touch the
    -- money. A missing row is not a supersession: nothing has overtaken this
    -- expiration, so it stands -- refusing there would leave credits alive for
    -- an account whose subscription record never arrived.
    if p_require_event_id is not null then
        select last_event_id into v_recorded_event
        from public.revenuecat_subscriptions
        where user_id = p_user_id;

        if v_recorded_event is not null
           and v_recorded_event is distinct from p_require_event_id then
            select * into v_buckets from public.credit_balance_buckets
            where user_id = p_user_id;
            return coalesce(v_buckets.subscription_grant_balance, 0)
                 + coalesce(v_buckets.purchased_balance, 0)
                 + coalesce(v_buckets.earned_balance, 0);
        end if;
    end if;
    perform public.ensure_credit_balance_buckets(p_user_id);
    select * into v_buckets from public.credit_balance_buckets
    where user_id = p_user_id for update;
    v_current_balance := v_buckets.subscription_grant_balance
        + v_buckets.purchased_balance + v_buckets.earned_balance;
    if exists (
        select 1 from public.credit_lapse_operations
        where user_id = p_user_id and operation_key = p_operation_key
    ) then
        return v_current_balance;
    end if;
    insert into public.credit_lapse_operations(
        user_id, operation_key, reference_id, lapsed_amount
    ) values (p_user_id, p_operation_key, p_reference_id, v_current_balance);
    update public.credit_balance_buckets
    set subscription_grant_balance = 0, purchased_balance = 0,
        earned_balance = 0, updated_at = pg_catalog.now()
    where user_id = p_user_id;
    if v_current_balance > 0 then
        insert into public.credit_ledger(
            user_id, amount, reason, reference_id, operation_key, balance_after
        ) values (
            p_user_id, -v_current_balance, 'lapse', p_reference_id,
            p_operation_key, 0
        );
    end if;
    return 0;
end;
$$;

revoke all on function public.lapse_credits(uuid, text, text, text)
    from public, anon, authenticated;
grant execute on function public.lapse_credits(uuid, text, text, text)
    to service_role;
