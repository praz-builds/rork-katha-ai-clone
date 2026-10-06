-- Migration 00102: credits bought as packs survive a subscription lapse.
--
-- Until now `lapse_credits` zeroed every bucket when a subscription expired:
-- the plan's grant, earned credits, and credits the user had bought as packs.
-- The app sells packs as "Credit packs that never expire" (CreditPacksSheet,
-- PaidOptions), so an ex-subscriber who had bought one lost credits the
-- screen had promised were permanent -- and a pack buyer who never
-- subscribed kept the identical pack forever.
--
-- Founder decision, 2026-10-06 (CREDITS_AND_PRICING.md decision 37, as
-- amended): a pack is a separate purchase and outlives the plan. On lapse,
-- `subscription_grant_balance` and `earned_balance` go to zero;
-- `purchased_balance` is untouched. This is the carve-out §3 "Carry-over is
-- the pack's real product" already recommended and the buckets were built
-- for.
--
-- Everything else is 00068's body unchanged: the same signature (so the
-- webhook and `_shared/credits.ts` need no change), the same per-user
-- advisory lock, the same supersession check against the recorded
-- RevenueCat event, and the same idempotency on `operation_key`. What moves:
--
--   * `lapsed_amount` and the ledger row record only what was voided
--     (grant + earned), and the ledger's `balance_after` is the pack balance
--     that remains, not 0.
--   * The return value is the remaining balance (the pack credits), which is
--     what every caller already treats it as.
--   * No ledger row when nothing was voided, as before.

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
    v_voided integer;
    v_recorded_event text;
begin
    -- Product rule (CREDITS_AND_PRICING.md decision 37, amended 2026-10-06):
    -- an expired subscription zeroes the plan's grant and earned credits.
    -- Credits bought as packs are kept.
    if p_reference_id is null or pg_catalog.btrim(p_reference_id) = ''
       or p_operation_key is null or pg_catalog.btrim(p_operation_key) = '' then
        raise exception 'A reference ID and operation key are required';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );

    -- The supersession check, inside the lock (00068, unchanged).
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
    v_voided := v_buckets.subscription_grant_balance + v_buckets.earned_balance;
    insert into public.credit_lapse_operations(
        user_id, operation_key, reference_id, lapsed_amount
    ) values (p_user_id, p_operation_key, p_reference_id, v_voided);
    update public.credit_balance_buckets
    set subscription_grant_balance = 0, earned_balance = 0,
        updated_at = pg_catalog.now()
    where user_id = p_user_id;
    if v_voided > 0 then
        insert into public.credit_ledger(
            user_id, amount, reason, reference_id, operation_key, balance_after
        ) values (
            p_user_id, -v_voided, 'lapse', p_reference_id,
            p_operation_key, v_buckets.purchased_balance
        );
    end if;
    return v_buckets.purchased_balance;
end;
$$;

revoke all on function public.lapse_credits(uuid, text, text, text)
    from public, anon, authenticated;
grant execute on function public.lapse_credits(uuid, text, text, text)
    to service_role;
