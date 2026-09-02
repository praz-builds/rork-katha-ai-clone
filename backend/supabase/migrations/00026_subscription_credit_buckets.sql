-- Separate renewable subscription grants from purchased and earned credits.
-- The ledger remains append-only and balance_after remains the user-visible total.

alter table public.credit_ledger
    drop constraint if exists credit_ledger_reason_check;
alter table public.credit_ledger
    add constraint credit_ledger_reason_check check (reason in (
        'purchase', 'subscription', 'ad_reward', 'streak', 'feedback',
        'referral', 'social', 'generation', 'welcome', 'refund',
        'reader_earning', 'chargeback', 'lapse'
    )) not valid;
alter table public.credit_ledger
    validate constraint credit_ledger_reason_check;

alter table public.payment_event_backlog
    drop constraint if exists payment_event_backlog_provider_check;
alter table public.payment_event_backlog
    add constraint payment_event_backlog_provider_check
        check (provider in ('adapty', 'revenuecat'));

-- UUIDs are not chronological. This sequence is the final tie-breaker for
-- rows created in the same transaction (including a grant reset's two rows).
create sequence if not exists public.credit_ledger_sequence;
alter table public.credit_ledger
    add column if not exists ledger_sequence bigint;
alter sequence public.credit_ledger_sequence
    owned by public.credit_ledger.ledger_sequence;
alter table public.credit_ledger
    alter column ledger_sequence set default nextval('public.credit_ledger_sequence');
update public.credit_ledger
set ledger_sequence = nextval('public.credit_ledger_sequence')
where ledger_sequence is null;
alter table public.credit_ledger
    alter column ledger_sequence set not null;
create unique index if not exists idx_credit_ledger_sequence
    on public.credit_ledger(ledger_sequence);

create table if not exists public.credit_balance_buckets (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    subscription_grant_balance integer not null default 0
        check (subscription_grant_balance >= 0),
    purchased_balance integer not null default 0
        check (purchased_balance >= 0),
    earned_balance integer not null default 0
        check (earned_balance >= 0),
    updated_at timestamptz not null default now()
);

create table if not exists public.credit_chargebacks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    operation_key text not null,
    reference_id text not null,
    requested_amount integer not null check (requested_amount > 0),
    debited_amount integer not null check (debited_amount >= 0),
    shortfall_amount integer not null check (shortfall_amount >= 0),
    created_at timestamptz not null default now(),
    unique(user_id, operation_key),
    check (requested_amount = debited_amount + shortfall_amount)
);

-- Records which bucket funded a debit so an automatic generation refund
-- returns credits to that same bucket instead of accidentally carrying a
-- consumed subscription grant into a later billing period.
create table if not exists public.credit_spend_allocations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    operation_key text not null,
    reference_id text not null,
    grant_amount integer not null default 0 check (grant_amount >= 0),
    purchased_amount integer not null default 0 check (purchased_amount >= 0),
    earned_amount integer not null default 0 check (earned_amount >= 0),
    created_at timestamptz not null default now(),
    unique(user_id, operation_key),
    check (grant_amount + purchased_amount + earned_amount > 0)
);

create table if not exists public.credit_lapse_operations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    operation_key text not null,
    reference_id text not null,
    lapsed_amount integer not null check (lapsed_amount >= 0),
    created_at timestamptz not null default now(),
    unique(user_id, operation_key)
);

create table if not exists public.revenuecat_subscriptions (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    product_id text not null,
    entitlement_id text not null,
    tier text not null check (tier in ('reader', 'writer')),
    interval text not null check (interval in ('weekly', 'monthly', 'yearly')),
    period_type text not null check (period_type in ('TRIAL', 'NORMAL')),
    is_active boolean not null default true,
    will_renew boolean not null default true,
    expires_at timestamptz,
    last_event_id text not null unique,
    last_event_at timestamptz not null,
    updated_at timestamptz not null default now()
);

alter table public.credit_balance_buckets enable row level security;
alter table public.credit_chargebacks enable row level security;
alter table public.credit_spend_allocations enable row level security;
alter table public.credit_lapse_operations enable row level security;
alter table public.revenuecat_subscriptions enable row level security;

create index if not exists idx_revenuecat_subscriptions_monthly_refresh
    on public.revenuecat_subscriptions(interval, is_active, expires_at)
    where interval = 'yearly' and is_active = true;

create index if not exists idx_credit_spend_allocations_user_reference
    on public.credit_spend_allocations(user_id, reference_id);

-- Legacy rows predate provenance tracking. Preserve their full balance as earned
-- rather than guessing it was a subscription grant or a pack purchase.
create or replace function public.ensure_credit_balance_buckets(
    p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_legacy_balance integer;
begin
    select balance_after
    into v_legacy_balance
    from public.credit_ledger
    where user_id = p_user_id
    order by created_at desc, ledger_sequence desc
    limit 1;

    insert into public.credit_balance_buckets(
        user_id, subscription_grant_balance, purchased_balance, earned_balance
    ) values (
        p_user_id, 0, 0, coalesce(v_legacy_balance, 0)
    ) on conflict (user_id) do nothing;
end;
$$;

create or replace function public.deduct_credit(
    p_user_id uuid,
    p_amount integer,
    p_reason text,
    p_reference_id text,
    p_operation_key text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_buckets public.credit_balance_buckets;
    v_current_balance integer;
    v_debit_amount integer;
    v_shortfall integer;
    v_from_grant integer;
    v_from_purchased integer;
    v_from_earned integer;
    v_new_balance integer;
begin
    if p_amount is null or p_amount <= 0 or p_amount > 1000 then
        raise exception 'Credit amount must be between 1 and 1000';
    end if;
    if p_reason not in ('generation', 'chargeback') then
        raise exception 'Invalid deduction reason';
    end if;
    if p_reference_id is null or pg_catalog.btrim(p_reference_id) = '' then
        raise exception 'A reference ID is required';
    end if;
    if p_operation_key is null or pg_catalog.btrim(p_operation_key) = '' then
        raise exception 'An operation key is required';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );
    perform public.ensure_credit_balance_buckets(p_user_id);
    select * into v_buckets
    from public.credit_balance_buckets
    where user_id = p_user_id
    for update;
    v_current_balance := v_buckets.subscription_grant_balance
        + v_buckets.purchased_balance + v_buckets.earned_balance;

    if p_reason = 'chargeback' and exists (
        select 1 from public.credit_chargebacks
        where user_id = p_user_id and operation_key = p_operation_key
    ) then
        return v_current_balance;
    end if;
    if p_reason <> 'chargeback' and exists (
        select 1 from public.credit_ledger
        where user_id = p_user_id and operation_key = p_operation_key
    ) then
        raise exception 'Duplicate credit operation';
    end if;

    if p_reason <> 'chargeback' and v_current_balance < p_amount then
        raise exception using errcode = 'KTH02', message = 'Insufficient credits';
    end if;

    v_debit_amount := case when p_reason = 'chargeback'
        then least(p_amount, v_current_balance) else p_amount end;
    v_shortfall := p_amount - v_debit_amount;
    v_from_grant := least(v_buckets.subscription_grant_balance, v_debit_amount);
    v_from_purchased := least(
        v_buckets.purchased_balance, v_debit_amount - v_from_grant
    );
    v_from_earned := v_debit_amount - v_from_grant - v_from_purchased;
    v_new_balance := v_current_balance - v_debit_amount;

    update public.credit_balance_buckets
    set subscription_grant_balance = subscription_grant_balance - v_from_grant,
        purchased_balance = purchased_balance - v_from_purchased,
        earned_balance = earned_balance - v_from_earned,
        updated_at = pg_catalog.now()
    where user_id = p_user_id;

    if p_reason = 'chargeback' then
        insert into public.credit_chargebacks(
            user_id, operation_key, reference_id, requested_amount,
            debited_amount, shortfall_amount
        ) values (
            p_user_id, p_operation_key, p_reference_id, p_amount,
            v_debit_amount, v_shortfall
        );
    end if;

    if v_debit_amount > 0 then
        insert into public.credit_ledger(
            user_id, amount, reason, reference_id, operation_key, balance_after
        ) values (
            p_user_id, -v_debit_amount, p_reason, p_reference_id,
            p_operation_key, v_new_balance
        );
    end if;
    if p_reason <> 'chargeback' then
        insert into public.credit_spend_allocations(
            user_id, operation_key, reference_id, grant_amount,
            purchased_amount, earned_amount
        ) values (
            p_user_id, p_operation_key, p_reference_id, v_from_grant,
            v_from_purchased, v_from_earned
        );
    end if;
    return v_new_balance;
end;
$$;

create or replace function public.grant_credit(
    p_user_id uuid,
    p_amount integer,
    p_reason text,
    p_reference_id text,
    p_operation_key text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_buckets public.credit_balance_buckets;
    v_current_balance integer;
    v_new_balance integer;
    v_existing_amount integer;
    v_existing_reason text;
    v_existing_reference text;
    v_refund_grant integer := 0;
    v_refund_purchased integer := 0;
    v_refund_earned integer := 0;
begin
    if p_amount is null or p_amount <= 0 or p_amount > 1000 then
        raise exception 'Credit amount must be between 1 and 1000';
    end if;
    if p_reason not in (
        'purchase', 'subscription', 'ad_reward', 'streak', 'feedback',
        'referral', 'social', 'welcome', 'refund', 'reader_earning'
    ) then
        raise exception 'Invalid grant reason';
    end if;
    if p_reference_id is null or pg_catalog.btrim(p_reference_id) = '' then
        raise exception 'A reference ID is required';
    end if;
    if p_operation_key is null or pg_catalog.btrim(p_operation_key) = '' then
        raise exception 'An operation key is required';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );
    perform public.ensure_credit_balance_buckets(p_user_id);
    select * into v_buckets
    from public.credit_balance_buckets
    where user_id = p_user_id
    for update;
    v_current_balance := v_buckets.subscription_grant_balance
        + v_buckets.purchased_balance + v_buckets.earned_balance;

    select amount, reason, reference_id
    into v_existing_amount, v_existing_reason, v_existing_reference
    from public.credit_ledger
    where user_id = p_user_id and operation_key = p_operation_key
    order by created_at desc, ledger_sequence desc limit 1;
    if v_existing_amount is not null then
        if v_existing_amount <> p_amount or v_existing_reason <> p_reason
           or v_existing_reference <> p_reference_id then
            raise exception 'Idempotency key reused with different credit data';
        end if;
        return v_current_balance;
    end if;

    if p_reason = 'refund' then
        select grant_amount, purchased_amount, earned_amount
        into v_refund_grant, v_refund_purchased, v_refund_earned
        from public.credit_spend_allocations
        where user_id = p_user_id and reference_id = p_reference_id
        order by created_at desc, id desc
        limit 1;
        v_refund_grant := coalesce(v_refund_grant, 0);
        v_refund_purchased := coalesce(v_refund_purchased, 0);
        v_refund_earned := coalesce(v_refund_earned, 0);
        -- A partial refund restores only the portion of each bucket that was
        -- spent. The earned bucket receives the exact remainder so the three
        -- restored parts always sum to p_amount.
        v_refund_grant := least(v_refund_grant, p_amount);
        v_refund_purchased := least(v_refund_purchased, p_amount - v_refund_grant);
        v_refund_earned := p_amount - v_refund_grant - v_refund_purchased;
    end if;

    update public.credit_balance_buckets
    set subscription_grant_balance = subscription_grant_balance +
            case
                when p_reason = 'subscription' then p_amount
                when p_reason = 'refund' then v_refund_grant
                else 0
            end,
        purchased_balance = purchased_balance +
            case
                when p_reason = 'purchase' then p_amount
                when p_reason = 'refund' then v_refund_purchased
                else 0
            end,
        earned_balance = earned_balance +
            case
                when p_reason = 'refund' then v_refund_earned
                when p_reason not in ('subscription', 'purchase') then p_amount
                else 0
            end,
        updated_at = pg_catalog.now()
    where user_id = p_user_id;
    v_new_balance := v_current_balance + p_amount;
    insert into public.credit_ledger(
        user_id, amount, reason, reference_id, operation_key, balance_after
    ) values (
        p_user_id, p_amount, p_reason, p_reference_id, p_operation_key,
        v_new_balance
    );
    return v_new_balance;
end;
$$;

-- Resetting a grant uses a debit plus grant pair when there is unused grant
-- credit, making the reset auditable while preserving one user-visible balance.
create or replace function public.refresh_subscription_grant(
    p_user_id uuid,
    p_amount integer,
    p_reference_id text,
    p_operation_key text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_buckets public.credit_balance_buckets;
    v_current_balance integer;
    v_balance_without_grant integer;
    v_grant_operation_key text;
begin
    if p_amount is null or p_amount <= 0 or p_amount > 1000 then
        raise exception 'Credit amount must be between 1 and 1000';
    end if;
    if p_reference_id is null or pg_catalog.btrim(p_reference_id) = ''
       or p_operation_key is null or pg_catalog.btrim(p_operation_key) = '' then
        raise exception 'A reference ID and operation key are required';
    end if;
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );
    perform public.ensure_credit_balance_buckets(p_user_id);
    select * into v_buckets from public.credit_balance_buckets
    where user_id = p_user_id for update;
    v_current_balance := v_buckets.subscription_grant_balance
        + v_buckets.purchased_balance + v_buckets.earned_balance;

    if exists (
        select 1 from public.credit_ledger
        where user_id = p_user_id and operation_key = p_operation_key
    ) then
        return v_current_balance;
    end if;

    if v_buckets.subscription_grant_balance > 0 then
        v_balance_without_grant := v_current_balance - v_buckets.subscription_grant_balance;
        insert into public.credit_ledger(
            user_id, amount, reason, reference_id, operation_key, balance_after
        ) values (
            p_user_id, -v_buckets.subscription_grant_balance, 'subscription',
            p_reference_id || ':reset', p_operation_key, v_balance_without_grant
        );
        v_grant_operation_key := 'subscription-grant:' || p_operation_key;
    else
        v_balance_without_grant := v_current_balance;
        v_grant_operation_key := p_operation_key;
    end if;

    update public.credit_balance_buckets
    set subscription_grant_balance = p_amount, updated_at = pg_catalog.now()
    where user_id = p_user_id;
    insert into public.credit_ledger(
        user_id, amount, reason, reference_id, operation_key, balance_after
    ) values (
        p_user_id, p_amount, 'subscription', p_reference_id,
        v_grant_operation_key, v_balance_without_grant + p_amount
    );
    return v_balance_without_grant + p_amount;
end;
$$;

create or replace function public.lapse_credits(
    p_user_id uuid,
    p_reference_id text,
    p_operation_key text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_buckets public.credit_balance_buckets;
    v_current_balance integer;
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

create or replace function public.record_revenuecat_subscription(
    p_user_id uuid,
    p_product_id text,
    p_entitlement_id text,
    p_tier text,
    p_interval text,
    p_period_type text,
    p_is_active boolean,
    p_will_renew boolean,
    p_expires_at timestamptz,
    p_event_id text,
    p_event_at timestamptz
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_event_id is null or pg_catalog.btrim(p_event_id) = '' then
        raise exception 'RevenueCat event ID is required';
    end if;
    insert into public.revenuecat_subscriptions(
        user_id, product_id, entitlement_id, tier, interval, period_type,
        is_active, will_renew, expires_at, last_event_id, last_event_at
    ) values (
        p_user_id, p_product_id, p_entitlement_id, p_tier, p_interval,
        p_period_type, p_is_active, p_will_renew, p_expires_at, p_event_id,
        p_event_at
    ) on conflict (user_id) do update
    set product_id = excluded.product_id,
        entitlement_id = excluded.entitlement_id,
        tier = excluded.tier,
        interval = excluded.interval,
        period_type = excluded.period_type,
        is_active = excluded.is_active,
        will_renew = excluded.will_renew,
        expires_at = excluded.expires_at,
        last_event_id = excluded.last_event_id,
        last_event_at = excluded.last_event_at,
        updated_at = pg_catalog.now()
    where public.revenuecat_subscriptions.last_event_at <= excluded.last_event_at;
end;
$$;

revoke all on function public.ensure_credit_balance_buckets(uuid) from public, anon, authenticated;
revoke all on function public.deduct_credit(uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.grant_credit(uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.refresh_subscription_grant(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.lapse_credits(uuid, text, text) from public, anon, authenticated;
revoke all on function public.record_revenuecat_subscription(uuid, text, text, text, text, text, boolean, boolean, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.deduct_credit(uuid, integer, text, text, text) to service_role;
grant execute on function public.grant_credit(uuid, integer, text, text, text) to service_role;
grant execute on function public.refresh_subscription_grant(uuid, integer, text, text) to service_role;
grant execute on function public.lapse_credits(uuid, text, text) to service_role;
grant execute on function public.record_revenuecat_subscription(uuid, text, text, text, text, text, boolean, boolean, timestamptz, text, timestamptz) to service_role;
