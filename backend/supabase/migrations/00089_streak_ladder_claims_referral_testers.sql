-- Migration 00089: the streak ladder, feedback claims, invite codes, creature
-- avatars, and the two test accounts the store review needs.
--
-- Six things land together because the profile, credits and journey screens
-- ship as one change and every one of them reads from here. Nothing below is
-- destructive to existing rows; every new column is nullable or defaulted and
-- every replaced function keeps its signature.
--
--   1. STREAK LADDER. `streak_ladder()` is the single definition of the five
--      rungs (day 2/5/10/15/21 pay 2/4/6/8/10, 30 lifetime, nothing repeats).
--      `streak_milestones` records the rung the moment `touch_streak` sees the
--      streak reach it, and grants through `grant_credit` with op key
--      `streak:{user_id}:{milestone}`, so the ledger's own uniqueness is what
--      makes a rung unrepeatable. Existing accounts are backfilled as
--      achieved-but-uncredited: the economy did not pay for those days when
--      they happened and does not pay for them retroactively.
--
--   2. FEEDBACK CLAIMS. The old `create_feedback` faucet (one credit for a
--      one-character comment, daily, uncapped) stops granting. In its place
--      `claim_comment_credit` pays one credit for a comment the reader
--      explicitly claims, under every rule product decision D9 lists, all
--      enforced here and none in the client. A claimed comment is frozen:
--      the owner UPDATE policy no longer matches it.
--
--   3. INVITE CODES. `profiles.referral_code`, `claim_referral_code` and
--      `settle_referrals`. A referral pays 10 to the referrer and 5 to the
--      invitee, in one transaction, once the invitee has generated a story
--      AND is 24 hours old. `complete_story_generation` and
--      `complete_continuation_generation` stamp `first_generation_at` and
--      try to settle; the profile fetch tries again so a payout blocked only
--      by the age rule lands on the next open.
--
--   4. IDENTITY. `ensure_identity` preassigns a username, a creature avatar
--      and an invite code to any profile missing them. `avatar_id` and
--      `avatar_url` are mutually exclusive: choosing one clears the other.
--
--   5. TEST ACCOUNTS. `tester_accounts` binds an email to a pre-provisioned
--      auth user, `reviewer_signin_attempts` gives the fixed-code sign-in a
--      lockout, and `profiles.entitlement_override` lets a tester read as a
--      subscriber without a receipt. Testers are excluded from every earn
--      path this file creates.
--
--   6. REPORT REASONS. Story reports accept `copyright`,
--      `inappropriate_content` and `inappropriate_cover`; the edge function
--      decides which reasons apply to which target.
--
-- Also: `revenuecat_subscriptions.tier` accepts 'katha', the single plan that
-- replaced reader/writer; `profile_overview` returns everything the owner's
-- profile now shows.

-- ===========================================================================
-- 1. Streak ladder
-- ===========================================================================

create or replace function public.streak_ladder()
returns table(milestone integer, credits integer)
language sql
immutable
set search_path = ''
as $$
    select * from (values (2, 2), (5, 4), (10, 6), (15, 8), (21, 10))
        as ladder(milestone, credits)
    order by 1;
$$;

comment on function public.streak_ladder() is
    'The five streak rungs and what each pays. The only place the ladder is written down on the server; the client renders whatever this returns.';

create table if not exists public.streak_milestones (
    user_id uuid not null references public.profiles(id) on delete cascade,
    milestone integer not null,
    credits integer not null check (credits > 0),
    achieved_at timestamptz not null default pg_catalog.now(),
    credited boolean not null default false,
    primary key (user_id, milestone)
);

comment on table public.streak_milestones is
    'One row per rung a user has reached. Written by touch_streak the moment current_streak reaches it (credited = true) and by the 00089 backfill for rungs reached before the ladder paid (credited = false). A rung can be reached once per lifetime.';

alter table public.streak_milestones enable row level security;
revoke all on table public.streak_milestones from public, anon, authenticated;
grant select, insert, update on table public.streak_milestones to service_role;

create or replace function public.touch_streak(
    p_user_id uuid
) returns table(
    current_streak integer,
    longest_streak integer,
    last_activity_date date
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_today date := (now() at time zone 'UTC')::date;
    v_current integer;
    v_longest integer;
    v_last date;
    v_rung record;
begin
    if p_user_id is null then
        raise exception 'user_id is required';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('streak:' || p_user_id::text, 0)
    );

    -- Kept from 00069: the calendar wants every active day, recorded before
    -- the same-day early return below, and idempotently.
    insert into public.activity_days (user_id, day)
    values (p_user_id, v_today)
    on conflict (user_id, day) do nothing;

    select s.current_streak, s.longest_streak, s.last_activity_date
    into v_current, v_longest, v_last
    from public.streaks s
    where s.user_id = p_user_id
    for update;

    if not found then
        insert into public.streaks (
            user_id,
            current_streak,
            longest_streak,
            last_activity_date
        ) values (
            p_user_id,
            1,
            1,
            v_today
        );
        return query select 1, 1, v_today;
        return;
    end if;

    if v_last = v_today then
        return query select coalesce(v_current, 0), coalesce(v_longest, 0), v_last;
        return;
    end if;

    if v_last = v_today - 1 then
        v_current := coalesce(v_current, 0) + 1;
    else
        v_current := 1;
    end if;
    v_longest := greatest(coalesce(v_longest, 0), v_current);

    update public.streaks
    set current_streak = v_current,
        longest_streak = v_longest,
        last_activity_date = v_today,
        updated_at = now()
    where user_id = p_user_id;

    -- Every rung at or below today's streak that has never been recorded is
    -- reached now. `<=` rather than `=` so a row that somehow skipped a rung
    -- (a repaired streak, a manual correction) still pays it exactly once;
    -- the primary key and the ledger op key each refuse a second payment on
    -- their own.
    for v_rung in
        select l.milestone, l.credits
        from public.streak_ladder() l
        where l.milestone <= v_current
          and not exists (
              select 1 from public.streak_milestones m
              where m.user_id = p_user_id and m.milestone = l.milestone
          )
        order by l.milestone
    loop
        -- Testers earn nothing: the reviewer account is seeded directly.
        if exists (
            select 1 from public.tester_accounts t where t.user_id = p_user_id
        ) then
            insert into public.streak_milestones (
                user_id, milestone, credits, achieved_at, credited
            ) values (p_user_id, v_rung.milestone, v_rung.credits, now(), false)
            on conflict do nothing;
            continue;
        end if;

        insert into public.streak_milestones (
            user_id, milestone, credits, achieved_at, credited
        ) values (p_user_id, v_rung.milestone, v_rung.credits, now(), true)
        on conflict do nothing;

        perform public.grant_credit(
            p_user_id,
            v_rung.credits,
            'streak',
            'streak:' || v_rung.milestone::text,
            'streak:' || p_user_id::text || ':' || v_rung.milestone::text
        );
    end loop;

    return query select v_current, v_longest, v_today;
end;
$$;

revoke all on function public.touch_streak(uuid) from public, anon, authenticated;
grant execute on function public.touch_streak(uuid) to service_role;

-- ===========================================================================
-- 5 (first, because the streak function above refers to it). Test accounts
-- ===========================================================================

create table if not exists public.tester_accounts (
    email text primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    premium boolean not null default true,
    code_hmac text,
    created_at timestamptz not null default pg_catalog.now()
);

comment on table public.tester_accounts is
    'Accounts the store reviewer and the owner use. code_hmac, when set, is hmac_sha256(email || '':'' || code, REVIEWER_CODE_PEPPER) and lets reviewer-signin mint a session for a fixed 6-digit code; null means the account signs in with a real OTP. Every earn path (streak, feedback, referral) refuses a tester.';

create unique index if not exists idx_tester_accounts_user_id
    on public.tester_accounts (user_id);

alter table public.tester_accounts enable row level security;
revoke all on table public.tester_accounts from public, anon, authenticated;
grant select, insert, update, delete on table public.tester_accounts to service_role;

create table if not exists public.reviewer_signin_attempts (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    ip text,
    ok boolean not null,
    at timestamptz not null default pg_catalog.now()
);

comment on table public.reviewer_signin_attempts is
    'Lockout ledger for reviewer-signin. email and ip hold sha256 hex digests, never the raw values: the table exists to count attempts, not to know who made them. Pruned to a day by reviewer_signin_locked.';

create index if not exists idx_reviewer_signin_attempts_email
    on public.reviewer_signin_attempts (email, at desc);
create index if not exists idx_reviewer_signin_attempts_ip
    on public.reviewer_signin_attempts (ip, at desc);

alter table public.reviewer_signin_attempts enable row level security;
revoke all on table public.reviewer_signin_attempts from public, anon, authenticated;
grant select, insert, delete on table public.reviewer_signin_attempts to service_role;

/**
 * Is this (email, ip) pair locked out?
 *
 * 5 failures per email in 15 minutes, 100 attempts of any kind per IP in an
 * hour. Both arguments are digests. Also prunes attempts older than a day so
 * the table never needs a job.
 */
create or replace function public.reviewer_signin_locked(
    p_email_hash text,
    p_ip_hash text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_email_failures integer;
    v_ip_attempts integer;
begin
    delete from public.reviewer_signin_attempts
    where at < pg_catalog.now() - interval '1 day';

    select count(*)::integer into v_email_failures
    from public.reviewer_signin_attempts a
    where a.email = p_email_hash
      and a.ok = false
      and a.at > pg_catalog.now() - interval '15 minutes';

    select count(*)::integer into v_ip_attempts
    from public.reviewer_signin_attempts a
    where p_ip_hash is not null
      and a.ip = p_ip_hash
      and a.at > pg_catalog.now() - interval '1 hour';

    return v_email_failures >= 5 or v_ip_attempts >= 100;
end;
$$;

revoke all on function public.reviewer_signin_locked(text, text)
    from public, anon, authenticated;
grant execute on function public.reviewer_signin_locked(text, text) to service_role;

alter table public.profiles
    add column if not exists entitlement_override text;

alter table public.profiles
    drop constraint if exists profiles_entitlement_override_check;
alter table public.profiles
    add constraint profiles_entitlement_override_check
    check (entitlement_override is null or entitlement_override in ('katha'));

comment on column public.profiles.entitlement_override is
    'Server-granted plan for test accounts: ''katha'' reads as a subscriber without a RevenueCat receipt. Honoured by every entitlement read; never by an operational kill switch such as NARRATION_GENERATION_ENABLED.';

-- The one plan. `revenuecat_subscriptions.tier` was reader/writer; the SKUs
-- that replaced them share a single entitlement and a single tier.
alter table public.revenuecat_subscriptions
    drop constraint if exists revenuecat_subscriptions_tier_check;
alter table public.revenuecat_subscriptions
    add constraint revenuecat_subscriptions_tier_check
    check (tier in ('reader', 'writer', 'katha'));

-- ===========================================================================
-- 4. Identity: creature avatars, preassigned handles, invite codes
-- ===========================================================================

alter table public.profiles
    add column if not exists avatar_id text;

alter table public.profiles
    drop constraint if exists profiles_avatar_id_shape;
alter table public.profiles
    add constraint profiles_avatar_id_shape
    check (avatar_id is null or avatar_id ~ '^k(0[1-9]|[12][0-9]|3[0-6])$');

comment on column public.profiles.avatar_id is
    'One of the 36 creature avatars, k01..k36. Mutually exclusive with avatar_url: set_creature_avatar clears the photo and set_avatar clears this.';

alter table public.profiles
    add column if not exists referral_code text;

alter table public.profiles
    drop constraint if exists profiles_referral_code_shape;
alter table public.profiles
    add constraint profiles_referral_code_shape
    check (referral_code is null or referral_code ~ '^[a-z0-9][a-z0-9_]{2,22}$');

create unique index if not exists idx_profiles_referral_code
    on public.profiles (referral_code)
    where referral_code is not null;

comment on column public.profiles.referral_code is
    'The code this person shares. Derived from the username when one was free, otherwise generated. Fixed once assigned: a later username change does not move it.';

/**
 * Choose a creature, and put the photo away.
 */
create or replace function public.set_creature_avatar(
    p_user_id uuid,
    p_avatar_id text
) returns table(avatar_id text)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_user_id is null then
        raise exception 'user_id is required';
    end if;
    if p_avatar_id is null or p_avatar_id !~ '^k(0[1-9]|[12][0-9]|3[0-6])$' then
        raise exception 'invalid avatar_id';
    end if;

    update public.profiles
    set avatar_id = p_avatar_id,
        avatar_url = null
    where id = p_user_id
      and deleted_at is null;

    if not found then
        raise exception 'Profile not found';
    end if;

    return query select p_avatar_id;
end;
$$;

revoke all on function public.set_creature_avatar(uuid, text)
    from public, anon, authenticated;
grant execute on function public.set_creature_avatar(uuid, text) to service_role;

-- A photo replaces the creature. Same body as 00074 plus the one clear.
create or replace function public.set_avatar(
    p_user_id uuid,
    p_storage_path text,
    p_public_url text
) returns table(avatar_url text)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_user_id is null or p_storage_path is null or p_public_url is null then
        raise exception 'user_id, storage_path and public_url are required';
    end if;

    if p_storage_path !~ ('^' || p_user_id::text || '/[A-Za-z0-9._-]+$') then
        raise exception 'storage_path must live under the owner''s folder';
    end if;

    if pg_catalog.strpos(p_public_url, p_storage_path) = 0 then
        raise exception 'public_url must address storage_path';
    end if;

    update public.profiles
    set avatar_url = p_public_url,
        avatar_id = null
    where id = p_user_id
      and deleted_at is null;

    if not found then
        raise exception 'Profile not found';
    end if;

    return query select p_public_url;
end;
$$;

/**
 * Give a profile the three things it is shown with, when it has none.
 *
 * Username: adjective_noun_NN, lowercase, inside 00060's shape and never on
 * its reserved list, unique by retry against the index rather than by a
 * pre-check. Avatar: a creature chosen deterministically from the user id,
 * so the same account always gets the same creature until it picks one.
 * Invite code: the username when that string is free as a code, otherwise
 * the username with two digits, otherwise random.
 *
 * Idempotent and cheap when nothing is missing. Refuses a tombstone.
 */
create or replace function public.ensure_identity(
    p_user_id uuid
) returns table(username text, avatar_id text, referral_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_adjectives text[] := array[
        'amber', 'bold', 'brave', 'bright', 'calm', 'clever', 'cosmic',
        'crisp', 'curious', 'dusky', 'eager', 'fabled', 'gentle', 'golden',
        'hidden', 'humble', 'ivory', 'jolly', 'keen', 'lively', 'lunar',
        'merry', 'misty', 'noble', 'quiet', 'rapid', 'rosy', 'silver',
        'solar', 'starry', 'swift', 'tidal', 'velvet', 'vivid', 'wandering',
        'wild', 'witty', 'zesty'
    ];
    v_nouns text[] := array[
        'badger', 'comet', 'ember', 'falcon', 'fern', 'fox', 'harbor',
        'heron', 'lantern', 'lark', 'lynx', 'maple', 'meadow', 'moth',
        'otter', 'owl', 'pebble', 'quill', 'raven', 'reed', 'river',
        'sparrow', 'thistle', 'tiger', 'wren', 'willow', 'yarrow', 'zephyr',
        'scribe', 'teller', 'reader', 'dreamer', 'walker', 'seeker'
    ];
    v_profile public.profiles;
    v_candidate text;
    v_attempt integer;
begin
    if p_user_id is null then
        raise exception 'user_id is required';
    end if;

    select * into v_profile from public.profiles where id = p_user_id for update;
    if not found or v_profile.deleted_at is not null then
        return query select null::text, null::text, null::text;
        return;
    end if;

    if v_profile.username is null then
        for v_attempt in 1..24 loop
            if v_attempt <= 20 then
                v_candidate := v_adjectives[1 + floor(random() * array_length(v_adjectives, 1))::int]
                    || '_'
                    || v_nouns[1 + floor(random() * array_length(v_nouns, 1))::int]
                    || '_'
                    || lpad((10 + floor(random() * 90))::int::text, 2, '0');
            else
                v_candidate := 'reader_' || substr(md5(p_user_id::text || v_attempt::text), 1, 8);
            end if;
            begin
                update public.profiles
                set username = v_candidate
                where id = p_user_id;
                v_profile.username := v_candidate;
                exit;
            exception
                when unique_violation or check_violation then
                    -- Taken, or (vanishingly) on the reserved list. Try again.
                    null;
            end;
        end loop;
    end if;

    if v_profile.avatar_id is null and v_profile.avatar_url is null then
        v_candidate := 'k' || lpad(
            (1 + ((('x' || substr(md5(p_user_id::text), 1, 8))::bit(32)::int & 2147483647) % 36))::text,
            2, '0'
        );
        update public.profiles set avatar_id = v_candidate where id = p_user_id;
        v_profile.avatar_id := v_candidate;
    end if;

    if v_profile.referral_code is null then
        for v_attempt in 1..24 loop
            if v_attempt = 1 and v_profile.username is not null then
                v_candidate := v_profile.username;
            elsif v_attempt <= 6 and v_profile.username is not null then
                v_candidate := left(v_profile.username, 20)
                    || lpad((10 + floor(random() * 90))::int::text, 2, '0');
            else
                v_candidate := 'kt' || substr(md5(p_user_id::text || v_attempt::text || random()::text), 1, 8);
            end if;
            begin
                update public.profiles
                set referral_code = v_candidate
                where id = p_user_id;
                v_profile.referral_code := v_candidate;
                exit;
            exception
                when unique_violation or check_violation then
                    null;
            end;
        end loop;
    end if;

    return query select v_profile.username, v_profile.avatar_id, v_profile.referral_code;
end;
$$;

revoke all on function public.ensure_identity(uuid) from public, anon, authenticated;
grant execute on function public.ensure_identity(uuid) to service_role;

-- ===========================================================================
-- 6. Report reasons
-- ===========================================================================

alter table public.content_reports
    drop constraint if exists content_reports_reason_check;
alter table public.content_reports
    add constraint content_reports_reason_check check (reason in (
        'spam', 'harassment', 'hate_speech', 'sexual_content',
        'violence', 'self_harm', 'misinformation', 'other',
        'copyright', 'inappropriate_content', 'inappropriate_cover'
    ));

-- ===========================================================================
-- 2. Feedback claims
-- ===========================================================================

alter table public.comments
    add column if not exists credit_claimed_at timestamptz,
    add column if not exists credit_ledger_id uuid references public.credit_ledger(id),
    add column if not exists credit_request_id text;

comment on column public.comments.credit_claimed_at is
    'When the author claimed the one feedback credit for this comment. Non-null freezes the content: the owner UPDATE policy excludes claimed rows.';

-- Frozen once claimed. The USING clause is what excludes the row; WITH CHECK
-- matches so a partial policy cannot be routed around by the update itself.
drop policy if exists "Users can update own comments" on public.comments;
create policy "Users can update own comments"
    on public.comments for update
    using (auth.uid() = user_id and credit_claimed_at is null)
    with check (auth.uid() = user_id and credit_claimed_at is null);

create index if not exists idx_comments_user_created
    on public.comments (user_id, created_at desc);

/**
 * Why this comment cannot be claimed right now, or null when it can.
 *
 * One predicate, used by the list (to label each comment) and by the claim
 * (under the lock, immediately before paying). The reasons are the contract's
 * enum, in the order a reader would want to hear them.
 */
create or replace function public.comment_credit_block_reason(
    p_user_id uuid,
    p_comment_id uuid
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_comment public.comments;
    v_author_id uuid;
    v_day_start timestamptz := (pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'UTC')) at time zone 'UTC';
    v_month_start timestamptz := (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')) at time zone 'UTC';
begin
    select * into v_comment from public.comments where id = p_comment_id;
    if not found or v_comment.user_id is distinct from p_user_id then
        return 'invalid';
    end if;

    if v_comment.credit_claimed_at is not null then
        return 'already_claimed';
    end if;

    if exists (select 1 from public.tester_accounts t where t.user_id = p_user_id) then
        return 'tester';
    end if;

    if v_comment.deleted_at is not null then
        return 'deleted';
    end if;

    if pg_catalog.char_length(pg_catalog.btrim(coalesce(v_comment.content, ''))) < 40 then
        return 'too_short';
    end if;

    select author_id into v_author_id from public.stories where id = v_comment.story_id;
    if v_author_id is null or v_author_id = p_user_id then
        return 'own_story';
    end if;

    if exists (
        select 1 from public.content_reports r
        where r.comment_id = p_comment_id and r.status = 'actioned'
    ) then
        return 'reported';
    end if;

    -- A qualifying read is two minutes on the story, recorded before the
    -- comment. `story_reads` carries one duration per chapter read, so the
    -- story's reads are summed: two minutes across three chapters is a read.
    if coalesce((
        select sum(sr.duration_seconds)
        from public.story_reads sr
        where sr.user_id = p_user_id
          and sr.story_id = v_comment.story_id
          and sr.read_at < v_comment.created_at
    ), 0) < 120 then
        return 'not_read';
    end if;

    -- The caps are read from the ledger, not from comments, so deleting a
    -- claimed comment never resets them.
    if exists (
        select 1 from public.credit_ledger l
        where l.user_id = p_user_id
          and l.reason = 'feedback'
          and l.reference_id = v_comment.story_id::text
    ) then
        return 'story_cap';
    end if;

    if exists (
        select 1 from public.credit_ledger l
        where l.user_id = p_user_id
          and l.reason = 'feedback'
          and l.created_at >= v_day_start
    ) then
        return 'daily_cap';
    end if;

    if (
        select count(*) from public.credit_ledger l
        where l.user_id = p_user_id
          and l.reason = 'feedback'
          and l.created_at >= v_month_start
    ) >= 6 then
        return 'monthly_cap';
    end if;

    return null;
end;
$$;

revoke all on function public.comment_credit_block_reason(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.comment_credit_block_reason(uuid, uuid) to service_role;

/**
 * The caller's recent comments on other people's stories, each labelled.
 */
create or replace function public.comment_credit_claims(
    p_user_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_claims jsonb;
    v_today integer;
    v_month integer;
    v_day_start timestamptz := (pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'UTC')) at time zone 'UTC';
    v_month_start timestamptz := (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')) at time zone 'UTC';
begin
    select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
            'comment_id', c.id,
            'story_id', c.story_id,
            'story_title', st.title,
            'excerpt', left(c.content, 140),
            'created_at', c.created_at,
            'status', case
                when c.credit_claimed_at is not null then 'claimed'
                when reason.value is null then 'claimable'
                else 'ineligible'
            end,
            'reason', case
                when c.credit_claimed_at is not null then null
                else reason.value
            end
        ) order by c.created_at desc
    ), '[]'::jsonb)
    into v_claims
    from (
        select c.*
        from public.comments c
        join public.stories s on s.id = c.story_id
        where c.user_id = p_user_id
          and s.author_id is distinct from p_user_id
        order by c.created_at desc
        limit 30
    ) c
    join public.stories st on st.id = c.story_id
    cross join lateral (
        select public.comment_credit_block_reason(p_user_id, c.id) as value
    ) reason;

    select count(*)::integer into v_today
    from public.credit_ledger l
    where l.user_id = p_user_id and l.reason = 'feedback' and l.created_at >= v_day_start;

    select count(*)::integer into v_month
    from public.credit_ledger l
    where l.user_id = p_user_id and l.reason = 'feedback' and l.created_at >= v_month_start;

    return pg_catalog.jsonb_build_object(
        'claims', v_claims,
        'remaining', pg_catalog.jsonb_build_object(
            'today', greatest(1 - v_today, 0),
            'month', greatest(6 - v_month, 0)
        )
    );
end;
$$;

revoke all on function public.comment_credit_claims(uuid) from public, anon, authenticated;
grant execute on function public.comment_credit_claims(uuid) to service_role;

/**
 * Pay one credit for a comment, or say why not.
 *
 * Idempotent on the ledger op key `feedback:{comment_id}`: a replay of the
 * same request id answers ok again without a second row, and a different
 * request against an already-claimed comment is told so.
 */
create or replace function public.claim_comment_credit(
    p_user_id uuid,
    p_comment_id uuid,
    p_request_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_comment public.comments;
    v_reason text;
    v_balance integer;
    v_ledger_id uuid;
begin
    if p_user_id is null or p_comment_id is null then
        raise exception 'user_id and comment_id are required';
    end if;
    if p_request_id is null
       or pg_catalog.btrim(p_request_id) = ''
       or pg_catalog.char_length(p_request_id) > 128 then
        raise exception 'Invalid claim request ID';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );

    select * into v_comment
    from public.comments
    where id = p_comment_id
    for update;

    if not found or v_comment.user_id is distinct from p_user_id then
        raise exception using errcode = 'KTH03', message = 'Comment not found';
    end if;

    if v_comment.credit_claimed_at is not null then
        select balance_after into v_balance
        from public.credit_ledger
        where user_id = p_user_id
        order by created_at desc, ledger_sequence desc
        limit 1;

        if v_comment.credit_request_id = p_request_id then
            return pg_catalog.jsonb_build_object(
                'ok', true, 'credits', 1, 'balance', coalesce(v_balance, 0),
                'replayed', true
            );
        end if;
        return pg_catalog.jsonb_build_object('ok', false, 'reason', 'already_claimed');
    end if;

    v_reason := public.comment_credit_block_reason(p_user_id, p_comment_id);
    if v_reason is not null then
        return pg_catalog.jsonb_build_object('ok', false, 'reason', v_reason);
    end if;

    v_balance := public.grant_credit(
        p_user_id,
        1,
        'feedback',
        v_comment.story_id::text,
        'feedback:' || p_comment_id::text
    );

    select id into v_ledger_id
    from public.credit_ledger
    where user_id = p_user_id
      and operation_key = 'feedback:' || p_comment_id::text
    order by created_at desc, ledger_sequence desc
    limit 1;

    update public.comments
    set credit_claimed_at = pg_catalog.now(),
        credit_ledger_id = v_ledger_id,
        credit_request_id = p_request_id
    where id = p_comment_id;

    return pg_catalog.jsonb_build_object(
        'ok', true, 'credits', 1, 'balance', v_balance, 'replayed', false
    );
end;
$$;

revoke all on function public.claim_comment_credit(uuid, uuid, text)
    from public, anon, authenticated;
grant execute on function public.claim_comment_credit(uuid, uuid, text) to service_role;

-- The legacy faucet. Same body as 00040 with the grant removed: the comment
-- still lands, `credit_granted` is always false, and the replay branch
-- reports whatever an older row recorded.
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
        raise exception using
            errcode = 'KTH03',
            message = 'Story not found';
    end if;

    if p_chapter_id is not null and not exists (
        select 1
        from public.chapters
        where id = p_chapter_id
          and story_id = p_story_id
    ) then
        raise exception using
            errcode = 'KTH04',
            message = 'Chapter not found';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );

    select *
    into v_comment
    from public.comments
    where user_id = p_user_id
      and request_id = p_request_id
    order by created_at desc, id desc
    limit 1;

    if found then
        if v_comment.story_id is distinct from p_story_id then
            raise exception using
                errcode = 'KTH05',
                message = 'Feedback request belongs to another story';
        end if;

        select balance_after
        into v_balance
        from public.credit_ledger
        where user_id = p_user_id
        order by created_at desc, ledger_sequence desc
        limit 1;

        return pg_catalog.jsonb_build_object(
            'comment', pg_catalog.to_jsonb(v_comment),
            'credit_granted', coalesce(v_comment.reward_granted, false),
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
    order by created_at desc, ledger_sequence desc
    limit 1;

    return pg_catalog.jsonb_build_object(
        'comment', pg_catalog.to_jsonb(v_comment),
        'credit_granted', false,
        'balance', coalesce(v_balance, 0),
        'replayed', false
    );
end;
$$;

-- ===========================================================================
-- 3. Invite codes
-- ===========================================================================

alter table public.referrals
    add column if not exists claimed_at timestamptz not null default pg_catalog.now(),
    add column if not exists credited_at timestamptz;

create unique index if not exists idx_referrals_referred_id
    on public.referrals (referred_id);

create index if not exists idx_referrals_referrer_credited
    on public.referrals (referrer_id, credited_at);

alter table public.referrals
    drop constraint if exists referrals_not_self;
alter table public.referrals
    add constraint referrals_not_self check (referrer_id <> referred_id);

/**
 * How a referrer stands against the caps, for the profile and the code card.
 */
create or replace function public.referral_summary(
    p_user_id uuid
) returns table(invited integer, credited integer, month_remaining integer)
language sql
stable
security definer
set search_path = ''
as $$
    select
        coalesce((select count(*)::integer from public.referrals r where r.referrer_id = p_user_id), 0),
        coalesce((select count(*)::integer from public.referrals r
                  where r.referrer_id = p_user_id and r.credited_at is not null), 0),
        greatest(3 - coalesce((
            select count(*)::integer from public.referrals r
            where r.referrer_id = p_user_id
              and r.credited_at >= (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')) at time zone 'UTC'
        ), 0), 0);
$$;

revoke all on function public.referral_summary(uuid) from public, anon, authenticated;
grant execute on function public.referral_summary(uuid) to service_role;

/**
 * Pay every referral this person is party to whose conditions now hold.
 *
 * Both grants happen in this transaction or neither does. A referral whose
 * referrer is over the monthly cap waits for next month; one whose referrer
 * is over the lifetime cap waits forever, which is what a cap means.
 */
create or replace function public.settle_referrals(
    p_user_id uuid
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_row public.referrals;
    v_referred public.profiles;
    v_referrer public.profiles;
    v_settled integer := 0;
    v_month_start timestamptz := (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')) at time zone 'UTC';
    v_month_count integer;
    v_life_count integer;
begin
    if p_user_id is null then
        return 0;
    end if;

    for v_row in
        select r.* from public.referrals r
        where (r.referred_id = p_user_id or r.referrer_id = p_user_id)
          and r.credited_at is null
        order by r.claimed_at
        for update
    loop
        select * into v_referred from public.profiles where id = v_row.referred_id;
        select * into v_referrer from public.profiles where id = v_row.referrer_id;
        if v_referred.id is null or v_referrer.id is null then continue; end if;
        if v_referred.deleted_at is not null or v_referrer.deleted_at is not null then continue; end if;
        if v_referred.first_generation_at is null then continue; end if;
        if coalesce(v_referred.account_created_at, v_referred.created_at, pg_catalog.now())
           > pg_catalog.now() - interval '24 hours' then
            continue;
        end if;
        if exists (
            select 1 from public.tester_accounts t
            where t.user_id in (v_row.referred_id, v_row.referrer_id)
        ) then
            continue;
        end if;

        -- The referrer's caps, counted from what has actually been paid.
        perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('referral_caps:' || v_row.referrer_id::text, 0)
        );
        select count(*)::integer into v_life_count
        from public.referrals r
        where r.referrer_id = v_row.referrer_id and r.credited_at is not null;
        select count(*)::integer into v_month_count
        from public.referrals r
        where r.referrer_id = v_row.referrer_id and r.credited_at >= v_month_start;
        if v_life_count >= 10 or v_month_count >= 3 then continue; end if;

        perform public.grant_credit(
            v_row.referrer_id,
            10,
            'referral',
            v_row.referred_id::text,
            'referral:referrer:' || v_row.referred_id::text
        );
        perform public.grant_credit(
            v_row.referred_id,
            5,
            'referral',
            v_row.referred_id::text,
            'referral:invitee:' || v_row.referred_id::text
        );

        update public.referrals
        set credited = true,
            credited_at = pg_catalog.now()
        where id = v_row.id;

        v_settled := v_settled + 1;
    end loop;

    return v_settled;
end;
$$;

revoke all on function public.settle_referrals(uuid) from public, anon, authenticated;
grant execute on function public.settle_referrals(uuid) to service_role;

/**
 * Enter somebody's invite code.
 */
create or replace function public.claim_referral_code(
    p_user_id uuid,
    p_code text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_code text;
    v_claimant public.profiles;
    v_referrer public.profiles;
begin
    if p_user_id is null then
        raise exception 'user_id is required';
    end if;

    v_code := lower(pg_catalog.btrim(coalesce(p_code, '')));
    if v_code = '' or pg_catalog.char_length(v_code) > 32 then
        return pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('referral_claim:' || p_user_id::text, 0)
    );

    select * into v_claimant from public.profiles where id = p_user_id;
    if not found or v_claimant.deleted_at is not null then
        return pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
    end if;

    select * into v_referrer
    from public.profiles
    where referral_code = v_code
      and deleted_at is null;
    if not found then
        return pg_catalog.jsonb_build_object('ok', false, 'reason', 'invalid');
    end if;

    if v_referrer.id = p_user_id then
        return pg_catalog.jsonb_build_object('ok', false, 'reason', 'self');
    end if;

    if exists (
        select 1 from public.tester_accounts t
        where t.user_id in (p_user_id, v_referrer.id)
    ) then
        return pg_catalog.jsonb_build_object('ok', false, 'reason', 'tester');
    end if;

    if v_claimant.referred_by is not null or exists (
        select 1 from public.referrals r where r.referred_id = p_user_id
    ) then
        return pg_catalog.jsonb_build_object('ok', false, 'reason', 'already');
    end if;

    if coalesce(v_claimant.account_created_at, v_claimant.created_at, pg_catalog.now())
       < pg_catalog.now() - interval '7 days' then
        return pg_catalog.jsonb_build_object('ok', false, 'reason', 'too_old');
    end if;

    begin
        insert into public.referrals (referrer_id, referred_id, claimed_at)
        values (v_referrer.id, p_user_id, pg_catalog.now());
    exception
        when unique_violation then
            return pg_catalog.jsonb_build_object('ok', false, 'reason', 'already');
    end;

    update public.profiles
    set referred_by = v_referrer.id
    where id = p_user_id;

    -- Both conditions may already hold (a two-day-old account that has
    -- written a story); if so the payout lands now rather than on the next
    -- profile open.
    perform public.settle_referrals(p_user_id);

    return pg_catalog.jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.claim_referral_code(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_referral_code(uuid, text) to service_role;

-- The two completion RPCs, reproduced from 00010 with one addition each: the
-- author's `first_generation_at` is stamped when null and their referrals
-- are settled. The settle is wrapped so a referral fault can never fail a
-- chapter that has already been paid for.

CREATE OR REPLACE FUNCTION public.complete_story_generation(
    p_operation_id uuid,
    p_story_id uuid,
    p_author_id uuid,
    p_title text,
    p_content text,
    p_word_count integer,
    p_themes text[] DEFAULT '{}',
    p_first_line text DEFAULT NULL,
    p_previously_summary text DEFAULT NULL,
    p_content_rating text DEFAULT 'sweet',
    p_chapter_title text DEFAULT 'Chapter 1',
    p_story_mode text DEFAULT 'standalone',
    p_chapter_role text DEFAULT 'standalone',
    p_series_state jsonb DEFAULT '{}'::jsonb,
    p_hook_type text DEFAULT 'none',
    p_hook_text text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_chapter public.chapters;
    v_story_mode text := COALESCE(p_story_mode, 'standalone');
    v_chapter_role text := COALESCE(p_chapter_role, 'standalone');
    v_hook_type text := COALESCE(p_hook_type, 'none');
BEGIN
    PERFORM 1
    FROM public.generation_operations
    WHERE id = p_operation_id
      AND user_id = p_author_id
      AND story_id = p_story_id
      AND chapter_number = 1
      AND kind = 'story'
      AND status = 'reserved'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reserved story operation not found';
    END IF;

    IF p_title IS NULL OR pg_catalog.btrim(p_title) = '' THEN
        RAISE EXCEPTION 'Story title is required';
    END IF;

    IF p_content IS NULL OR pg_catalog.btrim(p_content) = '' THEN
        RAISE EXCEPTION 'Story content is required';
    END IF;

    IF v_story_mode NOT IN ('standalone', 'series') THEN
        RAISE EXCEPTION 'Invalid story mode';
    END IF;

    IF v_chapter_role NOT IN ('standalone', 'series_opening', 'mid_series', 'finale') THEN
        RAISE EXCEPTION 'Invalid chapter role';
    END IF;

    IF v_hook_type NOT IN (
      'none',
      'revelation',
      'reversal',
      'decision',
      'arrival',
      'betrayal',
      'danger',
      'unanswered_question',
      'emotional_rupture'
    ) THEN
        RAISE EXCEPTION 'Invalid hook type';
    END IF;

    UPDATE public.stories
    SET title = p_title,
        word_count = p_word_count,
        themes = COALESCE(p_themes, '{}'),
        first_line = p_first_line,
        previously_summary = p_previously_summary,
        content_rating = COALESCE(p_content_rating, 'sweet'),
        story_mode = v_story_mode,
        series_state = CASE
          WHEN v_story_mode = 'series' THEN COALESCE(p_series_state, '{}'::jsonb)
          ELSE '{}'::jsonb
        END,
        status = 'complete'
    WHERE id = p_story_id
      AND author_id = p_author_id
      AND status = 'generating';

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            errcode = 'KTH03',
            message = 'Generating story not found';
    END IF;

    INSERT INTO public.chapters (
        story_id,
        chapter_number,
        title,
        content,
        word_count,
        is_published,
        published_at,
        chapter_role,
        first_line,
        previously_summary,
        hook_type,
        hook_text
    ) VALUES (
        p_story_id,
        1,
        COALESCE(NULLIF(pg_catalog.btrim(p_chapter_title), ''), 'Chapter 1'),
        p_content,
        p_word_count,
        false,
        NULL,
        v_chapter_role,
        p_first_line,
        p_previously_summary,
        v_hook_type,
        p_hook_text
    ) RETURNING * INTO v_chapter;

    UPDATE public.generation_operations
    SET status = 'completed',
        result_chapter_id = v_chapter.id,
        updated_at = pg_catalog.now()
    WHERE id = p_operation_id;

    UPDATE public.profiles
    SET first_generation_at = pg_catalog.now()
    WHERE id = p_author_id
      AND first_generation_at IS NULL;

    BEGIN
        PERFORM public.settle_referrals(p_author_id);
    EXCEPTION
        WHEN OTHERS THEN
            RAISE WARNING 'settle_referrals failed for %: %', p_author_id, SQLERRM;
    END;

    RETURN pg_catalog.to_jsonb(v_chapter);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_continuation_generation(
    p_operation_id uuid,
    p_user_id uuid,
    p_title text,
    p_content text,
    p_word_count integer,
    p_chapter_role text DEFAULT 'mid_series',
    p_first_line text DEFAULT NULL,
    p_previously_summary text DEFAULT NULL,
    p_series_state jsonb DEFAULT '{}'::jsonb,
    p_hook_type text DEFAULT 'none',
    p_hook_text text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_operation public.generation_operations;
    v_chapter public.chapters;
    v_chapter_role text := COALESCE(p_chapter_role, 'mid_series');
    v_hook_type text := COALESCE(p_hook_type, 'none');
BEGIN
    SELECT *
    INTO v_operation
    FROM public.generation_operations
    WHERE id = p_operation_id
      AND user_id = p_user_id
      AND kind = 'continuation'
      AND status = 'reserved'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reserved continuation operation not found';
    END IF;

    IF p_content IS NULL OR pg_catalog.btrim(p_content) = '' THEN
        RAISE EXCEPTION 'Chapter content is required';
    END IF;

    IF v_chapter_role NOT IN ('mid_series', 'finale') THEN
        RAISE EXCEPTION 'Invalid continuation chapter role';
    END IF;

    IF v_hook_type NOT IN (
      'none',
      'revelation',
      'reversal',
      'decision',
      'arrival',
      'betrayal',
      'danger',
      'unanswered_question',
      'emotional_rupture'
    ) THEN
        RAISE EXCEPTION 'Invalid hook type';
    END IF;

    INSERT INTO public.chapters (
        story_id,
        chapter_number,
        title,
        content,
        word_count,
        is_published,
        published_at,
        chapter_role,
        first_line,
        previously_summary,
        hook_type,
        hook_text
    ) VALUES (
        v_operation.story_id,
        v_operation.chapter_number,
        COALESCE(NULLIF(pg_catalog.btrim(p_title), ''), 'Chapter ' || v_operation.chapter_number::text),
        p_content,
        p_word_count,
        false,
        NULL,
        v_chapter_role,
        p_first_line,
        p_previously_summary,
        v_hook_type,
        p_hook_text
    ) RETURNING * INTO v_chapter;

    -- An absent or empty series_state must never wipe accumulated continuity.
    UPDATE public.stories
    SET story_mode = 'series',
        series_state = CASE
          WHEN p_series_state IS NULL
            OR p_series_state = '{}'::jsonb
            THEN series_state
          ELSE p_series_state
        END,
        previously_summary = COALESCE(p_previously_summary, previously_summary),
        word_count = COALESCE(word_count, 0) + p_word_count
    WHERE id = v_operation.story_id;

    UPDATE public.generation_operations
    SET status = 'completed',
        result_chapter_id = v_chapter.id,
        updated_at = pg_catalog.now()
    WHERE id = p_operation_id;

    UPDATE public.profiles
    SET first_generation_at = pg_catalog.now()
    WHERE id = p_user_id
      AND first_generation_at IS NULL;

    BEGIN
        PERFORM public.settle_referrals(p_user_id);
    EXCEPTION
        WHEN OTHERS THEN
            RAISE WARNING 'settle_referrals failed for %: %', p_user_id, SQLERRM;
    END;

    RETURN pg_catalog.to_jsonb(v_chapter);
END;
$$;

-- ===========================================================================
-- profile_overview: everything the owner's profile now shows
-- ===========================================================================

drop function if exists public.profile_overview(uuid);

create or replace function public.profile_overview(
    p_user_id uuid
) returns table(
    username text,
    display_name text,
    avatar_url text,
    avatar_id text,
    bio text,
    member_since timestamptz,
    deleted_at timestamptz,
    entitlement_override text,
    referral_code text,
    referral_invited integer,
    referral_credited integer,
    referral_month_remaining integer,
    current_streak integer,
    longest_streak integer,
    last_activity_date date,
    ladder jsonb,
    milestones jsonb,
    stories_written integer,
    chapters_written integer,
    total_reads integer,
    total_likes integer,
    phrases_saved integer,
    followers integer,
    following integer
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        p.username,
        p.display_name,
        p.avatar_url,
        p.avatar_id,
        p.bio,
        coalesce(p.account_created_at, p.created_at),
        p.deleted_at,
        p.entitlement_override,
        p.referral_code,
        rs.invited,
        rs.credited,
        rs.month_remaining,
        coalesce(s.current_streak, 0),
        coalesce(s.longest_streak, 0),
        s.last_activity_date,
        (
            select coalesce(pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object('milestone', l.milestone, 'credits', l.credits)
                order by l.milestone
            ), '[]'::jsonb)
            from public.streak_ladder() l
        ),
        (
            select coalesce(pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'milestone', l.milestone,
                    'credits', l.credits,
                    'achieved_at', m.achieved_at,
                    'credited', coalesce(m.credited, false)
                ) order by l.milestone
            ), '[]'::jsonb)
            from public.streak_ladder() l
            left join public.streak_milestones m
              on m.user_id = p.id and m.milestone = l.milestone
        ),
        coalesce((
            select count(*)::integer from public.stories st
            where st.author_id = p.id
        ), 0),
        coalesce((
            select count(*)::integer
            from public.chapters ch
            join public.stories st on st.id = ch.story_id
            where st.author_id = p.id
        ), 0),
        coalesce((
            select sum(coalesce(st.read_count, 0))::integer
            from public.stories st where st.author_id = p.id
        ), 0),
        coalesce((
            select sum(coalesce(st.like_count, 0))::integer
            from public.stories st where st.author_id = p.id
        ), 0),
        coalesce((
            select count(*)::integer from public.saved_phrases sp
            where sp.user_id = p.id
        ), 0),
        coalesce((
            select count(*)::integer from public.user_followers uf
            where uf.author_id = p.id
        ), 0),
        coalesce((
            select count(*)::integer from public.user_followers uf
            where uf.follower_id = p.id
        ), 0)
    from public.profiles p
    left join public.streaks s on s.user_id = p.id
    cross join lateral public.referral_summary(p.id) rs
    where p.id = p_user_id;
$$;

revoke all on function public.profile_overview(uuid)
    from public, anon, authenticated;
grant execute on function public.profile_overview(uuid) to service_role;

-- ===========================================================================
-- Backfill: rungs already reached are achieved, and were never paid
-- ===========================================================================
--
-- `greatest(current, longest)` rather than `current` alone: a reader whose
-- longest run was 12 days reached day 10 once, and the ladder pays a rung
-- once per lifetime. Recording it as achieved is the truth and is what stops
-- a second, retroactive payment the next time their streak passes 10.
insert into public.streak_milestones (user_id, milestone, credits, achieved_at, credited)
select s.user_id, l.milestone, l.credits, coalesce(s.updated_at, pg_catalog.now()), false
from public.streaks s
cross join public.streak_ladder() l
where greatest(coalesce(s.current_streak, 0), coalesce(s.longest_streak, 0)) >= l.milestone
on conflict (user_id, milestone) do nothing;
