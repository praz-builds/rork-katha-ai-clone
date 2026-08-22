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

create or replace function public.deduct_credit(
    p_user_id uuid,
    p_amount integer,
    p_reason text,
    p_reference_id text default null
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

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );

    if exists (
        select 1
        from public.credit_ledger
        where user_id = p_user_id
          and operation_key = p_reference_id
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
        p_reference_id,
        v_new_balance
    );

    return v_new_balance;
end;
$$;

create or replace function public.grant_credit(
    p_user_id uuid,
    p_amount integer,
    p_reason text,
    p_reference_id text default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_current_balance integer;
    v_new_balance integer;
    v_existing_amount integer;
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

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );

    select amount
    into v_existing_amount
    from public.credit_ledger
    where user_id = p_user_id
      and reason = p_reason
      and (
          operation_key = p_reference_id
          or (
              operation_key is null
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
        if v_existing_amount <> p_amount then
            raise exception 'Idempotency key reused with a different amount';
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
        p_reference_id,
        v_new_balance
    );

    return v_new_balance;
end;
$$;

create or replace function public.complete_story_generation(
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

    return pg_catalog.to_jsonb(v_chapter);
end;
$$;

create or replace function public.create_feedback(
    p_user_id uuid,
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

    insert into public.comments (user_id, story_id, chapter_id, content)
    values (p_user_id, p_story_id, p_chapter_id, pg_catalog.btrim(p_content))
    returning * into v_comment;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );

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
            p_story_id::text
        );
        v_credit_granted := true;
    end if;

    return pg_catalog.jsonb_build_object(
        'comment', pg_catalog.to_jsonb(v_comment),
        'credit_granted', v_credit_granted,
        'balance', v_balance
    );
end;
$$;

revoke all on function public.deduct_credit(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.grant_credit(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.complete_story_generation(uuid, uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.create_feedback(uuid, uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.deduct_credit(uuid, integer, text, text) to service_role;
grant execute on function public.grant_credit(uuid, integer, text, text) to service_role;
grant execute on function public.complete_story_generation(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.create_feedback(uuid, uuid, uuid, text) to service_role;

comment on function public.deduct_credit(uuid, integer, text, text)
    is 'Service-only, serialized, idempotent credit deduction.';
comment on function public.grant_credit(uuid, integer, text, text)
    is 'Service-only, serialized, idempotent credit grant.';
comment on function public.complete_story_generation(uuid, uuid, text, text, integer)
    is 'Service-only atomic story completion and first-chapter insert.';
comment on function public.create_feedback(uuid, uuid, uuid, text)
    is 'Service-only atomic feedback insert and daily idempotent reward.';
