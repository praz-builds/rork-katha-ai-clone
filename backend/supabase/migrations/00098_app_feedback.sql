-- 00098: in-app feedback, the "Send feedback" sheet on Profile.
--
-- The `feedback` edge function is NOT this. Despite its name it posts a
-- COMMENT on a story (00005's `create_feedback`), and it needs a story id.
-- Feedback about the app itself had nowhere to go: the only written channel
-- was the reason box on the delete-account sheet, which by construction only
-- hears from people who are leaving. This is the channel for everyone else.
--
-- ## Who may write, and how often
--
-- Any caller with a session: a named account or an anonymous (pre-email)
-- identity. `app-feedback` verifies the JWT and calls `submit_app_feedback`
-- as service role; no client role can touch the table directly, not even to
-- read its own rows back.
--
-- Bounded per user: 5 in any rolling hour and 20 in any rolling day. Enough
-- for somebody reporting three bugs in one sitting; not enough to turn the
-- table into a free write endpoint. The bound is keyed on the user id, and a
-- new anonymous identity per burst is already bounded upstream by
-- `bootstrap-user`'s per-network limits (00035). A refusal is a return value
-- (`rate_limited: true`), not an exception, so the function can answer 429
-- without string-matching an error.
--
-- ## Retries
--
-- `request_id` is client-stable per submission. A retry after a dropped
-- response replays the first row (`replayed: true`) instead of filing it
-- twice, and a replay neither counts against the bound nor is refused by it:
-- somebody whose first attempt landed must not be told they sent too much.
--
-- ## Account deletion
--
-- Profiles are tombstoned, never deleted (00070), so an ON DELETE rule on the
-- foreign key would never fire. Free text is exactly what 00070 refuses to
-- keep beside a person, so a trigger on the tombstoning update deletes every
-- feedback row the account wrote. `account_deletion_reasons` is how the
-- product keeps hearing from people after they go; this table is not.
--
-- Repo rule (00071): NULLIF, COALESCE, GREATEST and LEAST are parser
-- constructs, not `pg_catalog` functions. Under `set search_path = ''` every
-- real function is qualified and these four must NOT be.

create table if not exists public.app_feedback (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    request_id text not null,
    category text not null default 'other',
    message text not null,
    app_version text,
    platform text,
    screen text,
    created_at timestamptz not null default now(),
    constraint app_feedback_request_unique unique (user_id, request_id),
    constraint app_feedback_request_id_length
        check (char_length(request_id) between 1 and 128),
    constraint app_feedback_category_check
        check (category in ('bug', 'idea', 'story', 'other')),
    constraint app_feedback_message_length
        check (char_length(btrim(message)) between 1 and 2000),
    constraint app_feedback_app_version_length
        check (app_version is null or char_length(app_version) <= 32),
    constraint app_feedback_platform_check
        check (platform is null or platform in ('ios', 'android', 'web')),
    constraint app_feedback_screen_length
        check (screen is null or char_length(screen) <= 64)
);

comment on table public.app_feedback is
    'Feedback about the app itself, from the Profile "Send feedback" sheet (00098). Not story comments -- those are `comments`, posted through the misleadingly named `feedback` function. Written only by `submit_app_feedback` as service role; no client role can read or write it. Rows are deleted when the account is (trigger on profiles.deleted_at).';

create index if not exists idx_app_feedback_user_created
    on public.app_feedback (user_id, created_at desc);

create index if not exists idx_app_feedback_created
    on public.app_feedback (created_at desc);

alter table public.app_feedback enable row level security;
revoke all on table public.app_feedback from public, anon, authenticated;
grant select, insert, delete on table public.app_feedback to service_role;

/**
 * File one piece of app feedback, bounded per user and idempotent per request.
 *
 * Returns one of:
 *   {"id": <uuid>, "replayed": false, "rate_limited": false}  -- filed now
 *   {"id": <uuid>, "replayed": true,  "rate_limited": false}  -- a retry of a filed one
 *   {"rate_limited": true}                                    -- over the bound, nothing filed
 *   {"gone": true}                                            -- the account is deleted, nothing filed
 *
 * Invalid input raises (check constraint 23514 / KTH01): the edge function
 * validates first, so reaching one of those is a bug, not a user error.
 */
create or replace function public.submit_app_feedback(
    p_user_id uuid,
    p_request_id text,
    p_category text,
    p_message text,
    p_app_version text,
    p_platform text,
    p_screen text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_existing uuid;
    v_hour integer;
    v_day integer;
    v_id uuid;
begin
    if p_user_id is null then
        raise exception 'user is required' using errcode = 'KTH01';
    end if;

    -- One submitter at a time per user, so two parallel requests cannot both
    -- read "4 this hour" and both insert the fifth and sixth.
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('app_feedback:' || p_user_id::text, 0)
    );

    -- A deleted account can still hold a valid access token for a while
    -- (sign-out on the device is local), but its feedback rows were erased by
    -- the trigger below when it was deleted. Filing a new one would outlive
    -- the deletion, so a tombstoned account files nothing. A guest with no
    -- profile row yet is not deleted, and may file.
    if exists (
        select 1 from public.profiles
        where id = p_user_id and deleted_at is not null
    ) then
        return pg_catalog.jsonb_build_object('gone', true);
    end if;

    select id into v_existing
    from public.app_feedback
    where user_id = p_user_id and request_id = p_request_id;
    if v_existing is not null then
        return pg_catalog.jsonb_build_object(
            'id', v_existing, 'replayed', true, 'rate_limited', false
        );
    end if;

    select
        pg_catalog.count(*) filter (
            where created_at > pg_catalog.now() - interval '1 hour'
        ),
        pg_catalog.count(*)
    into v_hour, v_day
    from public.app_feedback
    where user_id = p_user_id
      and created_at > pg_catalog.now() - interval '1 day';

    if v_hour >= 5 or v_day >= 20 then
        return pg_catalog.jsonb_build_object('rate_limited', true);
    end if;

    insert into public.app_feedback (
        user_id, request_id, category, message, app_version, platform, screen
    ) values (
        p_user_id,
        p_request_id,
        coalesce(p_category, 'other'),
        pg_catalog.btrim(p_message),
        nullif(pg_catalog.btrim(p_app_version), ''),
        nullif(pg_catalog.btrim(p_platform), ''),
        nullif(pg_catalog.btrim(p_screen), '')
    )
    returning id into v_id;

    return pg_catalog.jsonb_build_object(
        'id', v_id, 'replayed', false, 'rate_limited', false
    );
end;
$$;

revoke all on function public.submit_app_feedback(uuid, text, text, text, text, text, text)
    from public, anon, authenticated;
grant execute on function public.submit_app_feedback(uuid, text, text, text, text, text, text)
    to service_role;

comment on function public.submit_app_feedback(uuid, text, text, text, text, text, text) is
    'Service-only. Files one app_feedback row: 5 per rolling hour and 20 per rolling day per user, idempotent on (user_id, request_id). Returns rate_limited instead of raising when over the bound.';

-- Account deletion erases what the account wrote here. See the header.
create or replace function public.erase_app_feedback_on_account_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    delete from public.app_feedback where user_id = new.id;
    return new;
end;
$$;

revoke all on function public.erase_app_feedback_on_account_deletion()
    from public, anon, authenticated;

drop trigger if exists erase_app_feedback_on_account_deletion on public.profiles;
create trigger erase_app_feedback_on_account_deletion
    after update of deleted_at on public.profiles
    for each row
    when (old.deleted_at is null and new.deleted_at is not null)
    execute function public.erase_app_feedback_on_account_deletion();
