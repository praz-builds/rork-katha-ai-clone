-- Migration 00069: the name onboarding already asks for, and the day-by-day
-- history the streak has never kept.
--
-- 1. `profiles.display_name`
--
-- The onboarding flow opens with "Let's start with your name" and a text
-- field, and the answer has never gone anywhere: `KathaOnboardingFlowV2`
-- passes it to `onDone`, `App.tsx` puts it in React state, and the next cold
-- start loses it. Every screen that has wanted to address the reader by name
-- has therefore addressed them as "there".
--
-- Separate from `username`, and deliberately so. A handle is public, unique,
-- lowercase, claimed against a reserved list and shown to strangers on a
-- byline. This is what the person is called -- "Priya", not "priya_writes" --
-- it is not unique, it is not an identifier, and nothing routes by it. Reusing
-- the handle for the greeting would mean either greeting people by a slug or
-- letting the greeting rename their byline.
--
-- Owner-writable, unlike `avatar_url` and `username`: there is no scarcity to
-- arbitrate, no impersonation surface (it appears on the reader's own home
-- screen, not on their public profile), and no server-side derivation. It
-- joins the narrow UPDATE grant 00060 established, next to `bio`.
--
-- 2. `activity_days`
--
-- `streaks` keeps three numbers: current, longest, and the last active date.
-- That is enough to say "you are on a 4 day streak" and nothing at all about
-- which days those were, so a calendar of activity -- the GitHub-style grid
-- the profile is getting -- has no data to draw. It cannot be reconstructed
-- either: `story_reads` covers reading but not writing, and nothing else
-- records a day at all.
--
-- One row per user per active day, written by `touch_streak`, which is
-- already the single definition of "this person did something today" and is
-- already called from every path that counts. Deriving the grid from the same
-- function that decides the streak is what keeps the two from disagreeing --
-- a calendar showing a gap on a day the streak counted would make both
-- numbers untrustworthy.

alter table public.profiles
    add column if not exists display_name text;

alter table public.profiles
    drop constraint if exists profiles_display_name_shape;

-- Length only. A name is not a username: no character class, no reserved
-- list, no lowercasing. People's names contain spaces, apostrophes, hyphens,
-- accents and scripts this codebase should not have opinions about. The cap
-- is a storage bound, not a rule about what a name may be.
alter table public.profiles
    add constraint profiles_display_name_shape
    check (
        display_name is null
        or (
            btrim(display_name) <> ''
            and char_length(display_name) <= 60
        )
    );

comment on column public.profiles.display_name is
    'What this person is called, from the onboarding name field. Not an identifier: not unique, not routable, never shown on a public byline (that is username). Owner-writable. Null for anyone who onboarded before 00069 or skipped the field.';

grant update (display_name) on public.profiles to authenticated;

create table if not exists public.activity_days (
    user_id uuid not null references public.profiles(id) on delete cascade,
    day date not null,
    created_at timestamptz not null default now(),
    primary key (user_id, day)
);

comment on table public.activity_days is
    'One row per user per UTC day on which they read or wrote something. Written only by touch_streak, so it agrees with streaks.current_streak by construction. Feeds the activity calendar on the profile.';

-- The grid asks for "this user, these dates", which the primary key already
-- serves as a prefix scan. No second index: the table has exactly one query.
alter table public.activity_days enable row level security;

-- Own rows only. The public profile's calendar is served through a SECURITY
-- DEFINER function that applies its own visibility rule, not by letting a
-- stranger select another person's days directly.
drop policy if exists "Readers see their own activity days" on public.activity_days;
create policy "Readers see their own activity days"
    on public.activity_days for select
    using (auth.uid() = user_id);

revoke all on table public.activity_days from public, anon;
grant select on table public.activity_days to authenticated;
grant select, insert on table public.activity_days to service_role;

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
begin
    if p_user_id is null then
        raise exception 'user_id is required';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('streak:' || p_user_id::text, 0)
    );

    -- Recorded before the early return below, and unconditionally, because
    -- the calendar wants every active day and the streak logic returns early
    -- on the second visit of the same day. `on conflict do nothing` makes the
    -- hundredth visit today as cheap as the first.
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

    return query select v_current, v_longest, v_today;
end;
$$;

revoke all on function public.touch_streak(uuid) from public, anon, authenticated;
grant execute on function public.touch_streak(uuid) to service_role;

-- Seed the calendar with the one day we can prove from what we already have.
-- Not a reconstruction: `streaks.last_activity_date` is the only date in the
-- schema, so it is the only honest row to write. Everyone's grid starts
-- essentially empty and fills in from here, which is the truthful outcome --
-- inventing days from `story_reads` would draw a calendar that disagrees with
-- the streak beside it.
insert into public.activity_days (user_id, day)
select s.user_id, s.last_activity_date
from public.streaks s
where s.last_activity_date is not null
on conflict (user_id, day) do nothing;
