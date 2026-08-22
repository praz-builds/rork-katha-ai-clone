-- Harden credit accounting and story persistence.
-- This migration replaces the original UUID-reference RPCs with service-only,
-- text-reference operations because references also include provider event IDs.

drop function if exists public.deduct_credit(uuid, integer, text, uuid);
drop function if exists public.grant_credit(uuid, integer, text, uuid);

alter table public.credit_ledger
    add column if not exists operation_key text;

create unique index if not exists idx_credit_ledger_operation_key
    on public.credit_ledger(user_id, operation_key)
    where operation_key is not null;

create unique index if not exists idx_credit_ledger_external_operation_key
    on public.credit_ledger(operation_key)
    where reason in ('purchase', 'subscription')
      and operation_key is not null;

create table if not exists public.generation_operations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id),
    request_id text not null,
    story_id uuid not null references public.stories(id) on delete cascade,
    chapter_number integer not null,
    kind text not null check (kind in ('story', 'continuation')),
    status text not null default 'reserved'
        check (status in ('reserved', 'completed', 'refunded')),
    result_chapter_id uuid references public.chapters(id) on delete set null,
    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(user_id, request_id)
);

create unique index if not exists idx_generation_operations_active_chapter
    on public.generation_operations(story_id, chapter_number)
    where status = 'reserved';

alter table public.generation_operations enable row level security;

create policy "Users can view own generation operations"
    on public.generation_operations for select
    using (auth.uid() = user_id);

alter table public.comments
    add column if not exists request_id text,
    add column if not exists reward_granted boolean not null default false;

create unique index if not exists idx_comments_request_id
    on public.comments(user_id, request_id)
    where request_id is not null;

drop policy if exists "Chapters viewable if story is accessible"
    on public.chapters;
create policy "Chapters viewable if story is accessible"
    on public.chapters for select using (
        exists (
            select 1
            from public.stories s
            where s.id = chapters.story_id
              and (
                  auth.uid() = s.author_id
                  or (
                      chapters.is_published = true
                      and (s.is_public = true or s.is_curated = true)
                  )
              )
        )
    );

drop policy if exists "Comments are viewable by authenticated users"
    on public.comments;
drop policy if exists "Users can insert own comments"
    on public.comments;

create policy "Accessible story comments are viewable"
    on public.comments for select using (
        auth.role() = 'authenticated'
        and exists (
            select 1
            from public.stories s
            where s.id = comments.story_id
              and (
                  s.is_public = true
                  or s.is_curated = true
                  or auth.uid() = s.author_id
              )
        )
    );

create policy "Users can insert accessible story comments"
    on public.comments for insert with check (
        auth.uid() = user_id
        and exists (
            select 1
            from public.stories s
            where s.id = comments.story_id
              and (s.is_public = true or s.is_curated = true)
        )
        and (
            chapter_id is null
            or exists (
                select 1
                from public.chapters c
                where c.id = comments.chapter_id
                  and c.story_id = comments.story_id
            )
        )
    );

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
    v_current_balance integer;
    v_new_balance integer;
begin
    if p_amount is null or p_amount <= 0 or p_amount > 1000 then
        raise exception 'Credit amount must be between 1 and 1000';
    end if;

    if p_reason <> 'generation' then
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

    if exists (
        select 1
        from public.credit_ledger
        where user_id = p_user_id
          and operation_key = p_operation_key
    ) then
        raise exception 'Duplicate credit operation';
    end if;

    select balance_after
    into v_current_balance
    from public.credit_ledger
    where user_id = p_user_id
    order by created_at desc, id desc
    limit 1;

    v_current_balance := coalesce(v_current_balance, 0);
    if v_current_balance < p_amount then
        raise exception 'Insufficient credits';
    end if;

    v_new_balance := v_current_balance - p_amount;

    insert into public.credit_ledger (
        user_id,
        amount,
        reason,
        reference_id,
        operation_key,
        balance_after
    ) values (
        p_user_id,
        -p_amount,
        p_reason,
        p_reference_id,
        p_operation_key,
        v_new_balance
    );

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
    v_current_balance integer;
    v_new_balance integer;
    v_existing_amount integer;
    v_existing_reason text;
    v_existing_reference text;
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

    select amount, reason, reference_id
    into v_existing_amount, v_existing_reason, v_existing_reference
    from public.credit_ledger
    where user_id = p_user_id
      and (
          operation_key = p_operation_key
          or (
              operation_key is null
              and reason = p_reason
              and reference_id = p_reference_id
          )
      )
    limit 1;

    select balance_after
    into v_current_balance
    from public.credit_ledger
    where user_id = p_user_id
    order by created_at desc, id desc
    limit 1;

    v_current_balance := coalesce(v_current_balance, 0);

    if v_existing_amount is not null then
        if v_existing_amount <> p_amount
           or v_existing_reason <> p_reason
           or v_existing_reference <> p_reference_id then
            raise exception 'Idempotency key reused with different credit data';
        end if;
        return v_current_balance;
    end if;

    v_new_balance := v_current_balance + p_amount;

    insert into public.credit_ledger (
        user_id,
        amount,
        reason,
        reference_id,
        operation_key,
        balance_after
    ) values (
        p_user_id,
        p_amount,
        p_reason,
        p_reference_id,
        p_operation_key,
        v_new_balance
    );

    return v_new_balance;
end;
$$;

create or replace function public.complete_story_generation(
    p_operation_id uuid,
    p_story_id uuid,
    p_author_id uuid,
    p_title text,
    p_content text,
    p_word_count integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_chapter public.chapters;
begin
    perform 1
    from public.generation_operations
    where id = p_operation_id
      and user_id = p_author_id
      and story_id = p_story_id
      and chapter_number = 1
      and kind = 'story'
      and status = 'reserved'
    for update;

    if not found then
        raise exception 'Reserved story operation not found';
    end if;

    if p_title is null or pg_catalog.btrim(p_title) = '' then
        raise exception 'Story title is required';
    end if;

    if p_content is null or pg_catalog.btrim(p_content) = '' then
        raise exception 'Story content is required';
    end if;

    update public.stories
    set title = p_title,
        word_count = p_word_count,
        status = 'complete'
    where id = p_story_id
      and author_id = p_author_id
      and status = 'generating';

    if not found then
        raise exception 'Generating story not found';
    end if;

    insert into public.chapters (
        story_id,
        chapter_number,
        title,
        content,
        word_count
    ) values (
        p_story_id,
        1,
        'Chapter 1',
        p_content,
        p_word_count
    ) returning * into v_chapter;

    update public.generation_operations
    set status = 'completed',
        result_chapter_id = v_chapter.id,
        updated_at = pg_catalog.now()
    where id = p_operation_id;

    return pg_catalog.to_jsonb(v_chapter);
end;
$$;

create or replace function public.reserve_generation_operation(
    p_user_id uuid,
    p_request_id text,
    p_story_id uuid,
    p_chapter_number integer,
    p_kind text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operation public.generation_operations;
    v_balance integer;
begin
    if p_request_id is null
       or pg_catalog.btrim(p_request_id) = ''
       or pg_catalog.char_length(p_request_id) > 128 then
        raise exception 'Invalid generation request ID';
    end if;

    if p_chapter_number <= 0 or p_kind not in ('story', 'continuation') then
        raise exception 'Invalid generation operation';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_story_id::text, 1)
    );

    select *
    into v_operation
    from public.generation_operations
    where user_id = p_user_id
      and request_id = p_request_id;

    if found then
        select balance_after
        into v_balance
        from public.credit_ledger
        where user_id = p_user_id
        order by created_at desc, id desc
        limit 1;

        return pg_catalog.jsonb_build_object(
            'id', v_operation.id,
            'story_id', v_operation.story_id,
            'chapter_number', v_operation.chapter_number,
            'status', v_operation.status,
            'result_chapter_id', v_operation.result_chapter_id,
            'replayed', true,
            'balance', coalesce(v_balance, 0)
        );
    end if;

    insert into public.generation_operations (
        user_id,
        request_id,
        story_id,
        chapter_number,
        kind
    ) values (
        p_user_id,
        p_request_id,
        p_story_id,
        p_chapter_number,
        p_kind
    ) returning * into v_operation;

    v_balance := public.deduct_credit(
        p_user_id,
        1,
        'generation',
        v_operation.id::text,
        'generation:' || v_operation.id::text
    );

    return pg_catalog.jsonb_build_object(
        'id', v_operation.id,
        'story_id', v_operation.story_id,
        'chapter_number', v_operation.chapter_number,
        'status', v_operation.status,
        'result_chapter_id', v_operation.result_chapter_id,
        'replayed', false,
        'balance', v_balance
    );
end;
$$;

create or replace function public.complete_continuation_generation(
    p_operation_id uuid,
    p_user_id uuid,
    p_title text,
    p_content text,
    p_word_count integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_operation public.generation_operations;
    v_chapter public.chapters;
begin
    select *
    into v_operation
    from public.generation_operations
    where id = p_operation_id
      and user_id = p_user_id
      and kind = 'continuation'
      and status = 'reserved'
    for update;

    if not found then
        raise exception 'Reserved continuation operation not found';
    end if;

    if p_content is null or pg_catalog.btrim(p_content) = '' then
        raise exception 'Chapter content is required';
    end if;

    insert into public.chapters (
        story_id,
        chapter_number,
        title,
        content,
        word_count
    ) values (
        v_operation.story_id,
        v_operation.chapter_number,
        p_title,
        p_content,
        p_word_count
    ) returning * into v_chapter;

    update public.generation_operations
    set status = 'completed',
        result_chapter_id = v_chapter.id,
        updated_at = pg_catalog.now()
    where id = p_operation_id;

    return pg_catalog.to_jsonb(v_chapter);
end;
$$;

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

    if v_operation.status = 'reserved' then
        v_balance := public.grant_credit(
            p_user_id,
            1,
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

create or replace function public.create_feedback(
    p_user_id uuid,
    p_request_id text,
    p_story_id uuid,
    p_chapter_id uuid,
    p_content text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_story_author_id uuid;
    v_story_is_public boolean;
    v_story_is_curated boolean;
    v_comment public.comments;
    v_balance integer;
    v_credit_granted boolean := false;
begin
    if p_request_id is null
       or pg_catalog.btrim(p_request_id) = ''
       or pg_catalog.char_length(p_request_id) > 128 then
        raise exception 'Invalid feedback request ID';
    end if;

    if p_content is null
       or pg_catalog.btrim(p_content) = ''
       or pg_catalog.char_length(pg_catalog.btrim(p_content)) > 2000 then
        raise exception 'Feedback must contain between 1 and 2000 characters';
    end if;

    select author_id, is_public, is_curated
    into v_story_author_id, v_story_is_public, v_story_is_curated
    from public.stories
    where id = p_story_id;

    if not found or not (
        coalesce(v_story_is_public, false)
        or coalesce(v_story_is_curated, false)
    ) then
        raise exception 'Story not found';
    end if;

    if p_chapter_id is not null and not exists (
        select 1
        from public.chapters
        where id = p_chapter_id
          and story_id = p_story_id
    ) then
        raise exception 'Chapter not found';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );

    select *
    into v_comment
    from public.comments
    where user_id = p_user_id
      and request_id = p_request_id;

    if found then
        select balance_after
        into v_balance
        from public.credit_ledger
        where user_id = p_user_id
        order by created_at desc, id desc
        limit 1;

        return pg_catalog.jsonb_build_object(
            'comment', pg_catalog.to_jsonb(v_comment),
            'credit_granted', v_comment.reward_granted,
            'balance', coalesce(v_balance, 0),
            'replayed', true
        );
    end if;

    insert into public.comments (
        user_id,
        story_id,
        chapter_id,
        content,
        request_id
    ) values (
        p_user_id,
        p_story_id,
        p_chapter_id,
        pg_catalog.btrim(p_content),
        p_request_id
    ) returning * into v_comment;

    select balance_after
    into v_balance
    from public.credit_ledger
    where user_id = p_user_id
    order by created_at desc, id desc
    limit 1;
    v_balance := coalesce(v_balance, 0);

    if v_story_author_id <> p_user_id
       and not exists (
           select 1
           from public.credit_ledger
           where user_id = p_user_id
             and reason = 'feedback'
             and reference_id = p_story_id::text
       )
       and not exists (
           select 1
           from public.credit_ledger
           where user_id = p_user_id
             and reason = 'feedback'
             and created_at >= (
                 pg_catalog.date_trunc(
                     'day',
                     pg_catalog.now() at time zone 'UTC'
                 ) at time zone 'UTC'
             )
       ) then
        v_balance := public.grant_credit(
            p_user_id,
            1,
            'feedback',
            p_story_id::text,
            'feedback:' || p_story_id::text
        );
        v_credit_granted := true;

        update public.comments
        set reward_granted = true
        where id = v_comment.id
        returning * into v_comment;
    end if;

    return pg_catalog.jsonb_build_object(
        'comment', pg_catalog.to_jsonb(v_comment),
        'credit_granted', v_credit_granted,
        'balance', v_balance,
        'replayed', false
    );
end;
$$;

revoke all on function public.deduct_credit(uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.grant_credit(uuid, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_story_generation(uuid, uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.reserve_generation_operation(uuid, text, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.complete_continuation_generation(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.refund_generation_operation(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.create_feedback(uuid, text, uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.deduct_credit(uuid, integer, text, text, text) to service_role;
grant execute on function public.grant_credit(uuid, integer, text, text, text) to service_role;
grant execute on function public.complete_story_generation(uuid, uuid, uuid, text, text, integer) to service_role;
grant execute on function public.reserve_generation_operation(uuid, text, uuid, integer, text) to service_role;
grant execute on function public.complete_continuation_generation(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.refund_generation_operation(uuid, uuid, text) to service_role;
grant execute on function public.create_feedback(uuid, text, uuid, uuid, text) to service_role;

comment on function public.deduct_credit(uuid, integer, text, text, text)
    is 'Service-only, serialized, idempotent credit deduction.';
comment on function public.grant_credit(uuid, integer, text, text, text)
    is 'Service-only, serialized, idempotent credit grant.';
comment on function public.complete_story_generation(uuid, uuid, uuid, text, text, integer)
    is 'Service-only atomic story completion and first-chapter insert.';
comment on function public.reserve_generation_operation(uuid, text, uuid, integer, text)
    is 'Service-only idempotent generation reservation and credit debit.';
comment on function public.complete_continuation_generation(uuid, uuid, text, text, integer)
    is 'Service-only atomic continuation insert and operation completion.';
comment on function public.refund_generation_operation(uuid, uuid, text)
    is 'Service-only idempotent generation refund and failure recording.';
comment on function public.create_feedback(uuid, text, uuid, uuid, text)
    is 'Service-only atomic feedback insert and daily idempotent reward.';
