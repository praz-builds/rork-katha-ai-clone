-- 00034: persist the creator-visible genre list and bound free story shaping.
--
-- `primary_genre` remains the routing value. `genre` stores primary first plus
-- up to two secondary shelf tags from the reviewed Shape screen. The shaping
-- rate limit contains only user identifiers and counters, never idea text.

drop function if exists public.begin_story_generation(
    uuid, text, text, text, text, text[], text, text, text, text, text,
    integer, text[], text[], text, text, boolean
);

create function public.begin_story_generation(
    p_user_id uuid,
    p_request_id text,
    p_title text,
    p_primary_genre text,
    p_genres text[],
    p_audience_mode text,
    p_identity_lenses text[],
    p_spice_level text,
    p_story_mode text,
    p_topic text,
    p_language text,
    p_where_and_when text,
    p_chapter_length text,
    p_planned_chapter_count integer,
    p_moments text[],
    p_story_values text[],
    p_writing_style text,
    p_avoid text,
    p_illustrate_chapters boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operation public.generation_operations;
    v_story public.stories;
    v_balance integer;
    v_genres text[];
begin
    if p_request_id is null
       or pg_catalog.btrim(p_request_id) = ''
       or pg_catalog.char_length(p_request_id) > 128 then
        raise exception 'Invalid generation request ID';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );

    select * into v_operation
    from public.generation_operations
    where user_id = p_user_id and request_id = p_request_id
    order by created_at desc, id desc
    limit 1;

    if found then
        select balance_after into v_balance
        from public.credit_ledger
        where user_id = p_user_id
        order by created_at desc, id desc
        limit 1;

        return pg_catalog.jsonb_build_object(
            'replayed', true,
            'operation_id', v_operation.id,
            'story_id', v_operation.story_id,
            'chapter_number', v_operation.chapter_number,
            'status', v_operation.status,
            'result_chapter_id', v_operation.result_chapter_id,
            'updated_at', v_operation.updated_at,
            'balance', coalesce(v_balance, 0)
        );
    end if;

    v_genres := case
        when p_genres is null or pg_catalog.cardinality(p_genres) = 0
            then array[p_primary_genre]
        else p_genres
    end;

    insert into public.stories (
        author_id, title, genre, primary_genre, audience_mode,
        identity_lenses, spice_level, story_mode, topic, language, where_and_when,
        chapter_length, planned_chapter_count, moments, story_values,
        writing_style, avoid, illustrate_chapters, status
    ) values (
        p_user_id, p_title, v_genres, p_primary_genre,
        p_audience_mode, p_identity_lenses, p_spice_level, p_story_mode,
        p_topic, p_language, p_where_and_when, p_chapter_length, p_planned_chapter_count,
        p_moments, p_story_values, p_writing_style, p_avoid,
        p_illustrate_chapters, 'generating'
    ) returning * into v_story;

    begin
        insert into public.generation_operations (
            user_id, request_id, story_id, chapter_number, kind
        ) values (
            p_user_id, p_request_id, v_story.id, 1, 'story'
        ) returning * into v_operation;
    exception when unique_violation then
        raise exception using
            errcode = 'KTH01',
            message = 'Generation chapter already reserved';
    end;

    v_balance := public.deduct_credit(
        p_user_id, 3, 'generation', v_operation.id::text,
        'generation:' || v_operation.id::text
    );

    return pg_catalog.jsonb_build_object(
        'replayed', false,
        'operation_id', v_operation.id,
        'story_id', v_story.id,
        'chapter_number', v_operation.chapter_number,
        'status', v_operation.status,
        'result_chapter_id', v_operation.result_chapter_id,
        'balance', v_balance,
        'story', pg_catalog.to_jsonb(v_story)
    );
end;
$$;

revoke all on function public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean
) from public, anon, authenticated;

grant execute on function public.begin_story_generation(
    uuid, text, text, text, text[], text, text[], text, text, text, text,
    text, text, integer, text[], text[], text, text, boolean
) to service_role;

-- New stories include the cast, first chapter, and first illustration, so their
-- atomic reservation is three credits. Continuations remain a single-credit
-- chapter action. Read the original debit as a compatibility ceiling: an
-- in-flight story reservation made before this migration was only charged one
-- credit and must never receive a windfall refund after the deploy.
create or replace function public.refund_generation_operation(
    p_operation_id uuid,
    p_user_id uuid,
    p_error text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operation public.generation_operations;
    v_balance integer;
    v_expected_refund integer;
    v_original_debit integer;
begin
    select *
    into v_operation
    from public.generation_operations
    where id = p_operation_id
      and user_id = p_user_id
    for update;

    if not found then
        raise exception 'Generation operation not found';
    end if;

    select balance_after
    into v_balance
    from public.credit_ledger
    where user_id = p_user_id
    order by created_at desc, id desc
    limit 1;
    v_balance := coalesce(v_balance, 0);

    if v_operation.status = 'completed' then
        return pg_catalog.jsonb_build_object(
            'status', v_operation.status,
            'balance', v_balance,
            'refunded', false,
            'result_chapter_id', v_operation.result_chapter_id
        );
    end if;

    if v_operation.status = 'refunded' then
        return pg_catalog.jsonb_build_object(
            'status', v_operation.status,
            'balance', v_balance,
            'refunded', false,
            'result_chapter_id', v_operation.result_chapter_id
        );
    end if;

    if v_operation.status = 'reserved' then
        v_expected_refund := case
            when v_operation.kind = 'story' then 3
            else 1
        end;

        select -amount
        into v_original_debit
        from public.credit_ledger
        where user_id = p_user_id
          and reason = 'generation'
          and reference_id = v_operation.id::text
          and amount < 0
        order by created_at desc, id desc
        limit 1;

        if v_original_debit is not null then
            v_expected_refund := least(v_expected_refund, v_original_debit);
        end if;

        v_balance := public.grant_credit(
            p_user_id,
            v_expected_refund,
            'refund',
            v_operation.id::text,
            'refund:' || v_operation.id::text
        );

        update public.generation_operations
        set status = 'refunded',
            last_error = pg_catalog.left(p_error, 1000),
            updated_at = pg_catalog.now()
        where id = p_operation_id;

        if v_operation.kind = 'story' then
            update public.stories
            set status = 'failed'
            where id = v_operation.story_id
              and status = 'generating';
        end if;
    end if;

    return pg_catalog.jsonb_build_object(
        'status', 'refunded',
        'balance', v_balance,
        'refunded', true
    );
end;
$$;

revoke all on function public.refund_generation_operation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.refund_generation_operation(uuid, uuid, text) to service_role;

-- Text completion closes the generation operation, but cover and cast work
-- continues in the background. Refund each missing paid component independently
-- without changing the completed text operation or restoring the wrong credit
-- bucket. Component keys make retries structurally idempotent.
create or replace function public.refund_story_media_component(
    p_operation_id uuid,
    p_user_id uuid,
    p_component text
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operation public.generation_operations;
    v_buckets public.credit_balance_buckets;
    v_allocation public.credit_spend_allocations;
    v_current_balance integer;
    v_original_debit integer;
    v_refunded_before integer;
    v_refund_amount integer;
    v_before_grant integer;
    v_before_purchased integer;
    v_after_grant integer;
    v_after_purchased integer;
    v_restore_grant integer;
    v_restore_purchased integer;
    v_restore_earned integer;
    v_operation_key text;
begin
    if p_component not in ('cast', 'cover') then
        raise exception 'Invalid story media component';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );

    select * into v_operation
    from public.generation_operations
    where id = p_operation_id and user_id = p_user_id and kind = 'story'
    for update;
    if not found then
        raise exception 'Story generation operation not found';
    end if;

    perform public.ensure_credit_balance_buckets(p_user_id);
    select * into v_buckets
    from public.credit_balance_buckets
    where user_id = p_user_id
    for update;
    v_current_balance := v_buckets.subscription_grant_balance
        + v_buckets.purchased_balance + v_buckets.earned_balance;

    v_operation_key := 'refund_component:' || p_operation_id::text || ':' || p_component;
    if exists (
        select 1 from public.credit_ledger
        where user_id = p_user_id and operation_key = v_operation_key
    ) then
        return v_current_balance;
    end if;

    select -amount into v_original_debit
    from public.credit_ledger
    where user_id = p_user_id
      and operation_key = 'generation:' || p_operation_id::text
      and amount < 0
    order by created_at desc, ledger_sequence desc
    limit 1;
    if v_original_debit is null or v_original_debit < 3 then
        return v_current_balance;
    end if;

    select * into v_allocation
    from public.credit_spend_allocations
    where user_id = p_user_id
      and operation_key = 'generation:' || p_operation_id::text
    limit 1;
    if not found then
        raise exception 'Story generation allocation not found';
    end if;

    select coalesce(pg_catalog.sum(amount), 0)::integer
    into v_refunded_before
    from public.credit_ledger
    where user_id = p_user_id
      and reference_id = p_operation_id::text
      and reason = 'refund'
      and amount > 0;
    v_refund_amount := least(1, v_original_debit - v_refunded_before);
    if v_refund_amount <= 0 then
        return v_current_balance;
    end if;

    v_before_grant := least(v_allocation.grant_amount, v_refunded_before);
    v_before_purchased := least(
        v_allocation.purchased_amount,
        greatest(v_refunded_before - v_allocation.grant_amount, 0)
    );
    v_after_grant := least(
        v_allocation.grant_amount,
        v_refunded_before + v_refund_amount
    );
    v_after_purchased := least(
        v_allocation.purchased_amount,
        greatest(
            v_refunded_before + v_refund_amount - v_allocation.grant_amount,
            0
        )
    );
    v_restore_grant := v_after_grant - v_before_grant;
    v_restore_purchased := v_after_purchased - v_before_purchased;
    v_restore_earned := v_refund_amount - v_restore_grant - v_restore_purchased;

    update public.credit_balance_buckets
    set subscription_grant_balance = subscription_grant_balance + v_restore_grant,
        purchased_balance = purchased_balance + v_restore_purchased,
        earned_balance = earned_balance + v_restore_earned,
        updated_at = pg_catalog.now()
    where user_id = p_user_id;

    insert into public.credit_ledger(
        user_id, amount, reason, reference_id, operation_key, balance_after
    ) values (
        p_user_id, v_refund_amount, 'refund', p_operation_id::text,
        v_operation_key, v_current_balance + v_refund_amount
    );
    return v_current_balance + v_refund_amount;
end;
$$;

revoke all on function public.refund_story_media_component(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.refund_story_media_component(uuid, uuid, text)
to service_role;

-- Story creation and publication are service-owned. Direct table inserts or
-- visibility updates would bypass guest publication checks and curation rules.
drop policy if exists "Users can insert own stories" on public.stories;
drop policy if exists "Users can update own non-curated stories" on public.stories;
revoke insert, update on public.stories from authenticated;

create table if not exists public.story_shape_rate_limits (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    window_started_at timestamptz not null default now(),
    request_count smallint not null default 0 check (request_count >= 0)
);

alter table public.story_shape_rate_limits enable row level security;

create table if not exists public.anonymous_story_shape_rate_limits (
    scope_hash text primary key check (scope_hash ~ '^[a-f0-9]{64}$'),
    window_started_at timestamptz not null default pg_catalog.now(),
    request_count smallint not null default 0 check (request_count >= 0 and request_count <= 30)
);

create table if not exists public.anonymous_story_shape_global_limits (
    window_key date primary key,
    request_count smallint not null default 0 check (request_count >= 0 and request_count <= 500)
);

alter table public.anonymous_story_shape_rate_limits enable row level security;
alter table public.anonymous_story_shape_global_limits enable row level security;

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
    v_global_count integer;
begin
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('story-shape:' || p_user_id::text, 0)
    );

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
            insert into public.anonymous_story_shape_rate_limits (scope_hash, request_count)
            values (p_anonymous_scope_hash, 1);
        elsif v_anonymous_limit.window_started_at <= pg_catalog.now() - interval '24 hours' then
            update public.anonymous_story_shape_rate_limits
            set window_started_at = pg_catalog.now(), request_count = 1
            where scope_hash = p_anonymous_scope_hash;
        elsif v_anonymous_limit.request_count >= 30 then
            return false;
        else
            update public.anonymous_story_shape_rate_limits
            set request_count = request_count + 1
            where scope_hash = p_anonymous_scope_hash;
        end if;

        update public.anonymous_story_shape_global_limits
        set request_count = request_count + 1
        where window_key = pg_catalog.now()::date;
    end if;

    select * into v_limit
    from public.story_shape_rate_limits
    where user_id = p_user_id
    for update;

    if not found then
        insert into public.story_shape_rate_limits (user_id, request_count)
        values (p_user_id, 1);
        return true;
    end if;

    if v_limit.window_started_at <= pg_catalog.now() - interval '1 minute' then
        update public.story_shape_rate_limits
        set window_started_at = pg_catalog.now(), request_count = 1
        where user_id = p_user_id;
        return true;
    end if;

    if v_limit.request_count >= 6 then
        return false;
    end if;

    update public.story_shape_rate_limits
    set request_count = request_count + 1
    where user_id = p_user_id;
    return true;
end;
$$;

revoke all on table public.story_shape_rate_limits from public, anon, authenticated;
revoke all on table public.anonymous_story_shape_rate_limits from public, anon, authenticated;
revoke all on table public.anonymous_story_shape_global_limits from public, anon, authenticated;
revoke all on function public.claim_story_shape_request(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_story_shape_request(uuid, text) to service_role;
