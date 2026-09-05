-- Production guest sessions use a real Supabase anonymous JWT. The profile and
-- welcome grant stay service-only; this table bounds fresh guest grants from a
-- coarse, salted network fingerprint without retaining an IP address.

create table if not exists public.anonymous_bootstrap_rate_limits (
    scope_hash text primary key check (scope_hash ~ '^[a-f0-9]{64}$'),
    window_started_at timestamptz not null default pg_catalog.now(),
    grant_count smallint not null default 0 check (grant_count >= 0 and grant_count <= 3)
);

alter table public.anonymous_bootstrap_rate_limits enable row level security;

create table if not exists public.anonymous_bootstrap_global_limits (
    window_key date primary key,
    grant_count smallint not null default 0 check (grant_count >= 0 and grant_count <= 300)
);

alter table public.anonymous_bootstrap_global_limits enable row level security;

create or replace function public.claim_anonymous_bootstrap_grant(
    p_scope_hash text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_limit public.anonymous_bootstrap_rate_limits;
    v_global_count integer;
begin
    if p_scope_hash is null or p_scope_hash !~ '^[a-f0-9]{64}$' then
        raise exception 'Invalid anonymous bootstrap scope';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('anonymous-bootstrap:' || p_scope_hash, 0)
    );
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('anonymous-bootstrap:global:' || (pg_catalog.now()::date)::text, 0)
    );

    insert into public.anonymous_bootstrap_global_limits (window_key, grant_count)
    values (pg_catalog.now()::date, 0)
    on conflict (window_key) do nothing;

    select grant_count into v_global_count
    from public.anonymous_bootstrap_global_limits
    where window_key = pg_catalog.now()::date
    for update;

    if v_global_count >= 300 then
        return false;
    end if;

    select *
    into v_limit
    from public.anonymous_bootstrap_rate_limits
    where scope_hash = p_scope_hash
    for update;

    if not found then
        insert into public.anonymous_bootstrap_rate_limits (
            scope_hash, grant_count
        ) values (
            p_scope_hash, 1
        );
        update public.anonymous_bootstrap_global_limits
        set grant_count = grant_count + 1
        where window_key = pg_catalog.now()::date;
        return true;
    end if;

    if v_limit.window_started_at <= pg_catalog.now() - interval '24 hours' then
        update public.anonymous_bootstrap_rate_limits
        set window_started_at = pg_catalog.now(),
            grant_count = 1
        where scope_hash = p_scope_hash;
        update public.anonymous_bootstrap_global_limits
        set grant_count = grant_count + 1
        where window_key = pg_catalog.now()::date;
        return true;
    end if;

    if v_limit.grant_count >= 3 then
        return false;
    end if;

    update public.anonymous_bootstrap_rate_limits
    set grant_count = grant_count + 1
    where scope_hash = p_scope_hash;
    update public.anonymous_bootstrap_global_limits
    set grant_count = grant_count + 1
    where window_key = pg_catalog.now()::date;
    return true;
end;
$$;

revoke all on table public.anonymous_bootstrap_rate_limits from public, anon, authenticated;
revoke all on table public.anonymous_bootstrap_global_limits from public, anon, authenticated;
revoke all on function public.claim_anonymous_bootstrap_grant(text) from public, anon, authenticated;
grant execute on function public.claim_anonymous_bootstrap_grant(text) to service_role;

create or replace function public.bootstrap_anonymous_user(
    p_user_id uuid,
    p_scope_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operation_key text := 'guest_bootstrap:' || p_user_id::text;
    v_balance integer;
    v_allowed boolean;
begin
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );

    select balance_after into v_balance
    from public.credit_ledger
    where user_id = p_user_id
    order by created_at desc, ledger_sequence desc
    limit 1;
    v_balance := coalesce(v_balance, 0);

    if exists (
        select 1 from public.credit_ledger
        where user_id = p_user_id and operation_key = v_operation_key
    ) then
        return pg_catalog.jsonb_build_object(
            'balance', v_balance,
            'welcome_granted', false,
            'rate_limited', false
        );
    end if;

    v_allowed := public.claim_anonymous_bootstrap_grant(p_scope_hash);
    if not v_allowed then
        return pg_catalog.jsonb_build_object(
            'balance', v_balance,
            'welcome_granted', false,
            'rate_limited', true
        );
    end if;

    v_balance := public.grant_credit(
        p_user_id,
        3,
        'welcome',
        p_user_id::text,
        v_operation_key
    );
    return pg_catalog.jsonb_build_object(
        'balance', v_balance,
        'welcome_granted', true,
        'rate_limited', false
    );
end;
$$;

revoke all on function public.bootstrap_anonymous_user(uuid, text)
from public, anon, authenticated;
grant execute on function public.bootstrap_anonymous_user(uuid, text)
to service_role;
