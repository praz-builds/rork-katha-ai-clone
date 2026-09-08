-- Engagement persistence: likes, bookmarks, follows, reads, and streaks.
--
-- All counter-moving writes happen in service-role-only RPCs so the row and
-- denormalized counter are changed by the same transaction.

-- Replace the early broad read policies with own-row policies. Public counts
-- live on `stories`; raw relationship rows are user-private.
--
-- READ ONLY, DELIBERATELY. These four tables get a select policy and nothing
-- else, and no insert/update/delete grant reaches `authenticated`.
--
-- An earlier draft of this migration also gave each table own-row insert and
-- delete policies, which reads as the safe, obvious thing to do. It is not: a
-- client holding an ordinary user JWT could then insert straight into
-- `story_likes`, and the row would exist while `stories.like_count` never
-- moved. The counter would be permanently wrong, with no error anywhere, and
-- the whole point of this migration is that the row and the counter move in one
-- transaction or neither moves.
--
-- So every write goes through the `toggle_*` and `record_*` RPCs below, which
-- are `security definer`, are granted to `service_role` only, and maintain the
-- counter in the same transaction as the row. Service role bypasses RLS, so the
-- endpoints keep working; a direct client write has nowhere to land.
drop policy if exists "Users can view story follows" on public.story_followers;
drop policy if exists "Users can follow stories" on public.story_followers;
drop policy if exists "Users can unfollow stories" on public.story_followers;
create policy "Users can view own story follows"
    on public.story_followers for select using (auth.uid() = user_id);

drop policy if exists "Users can view user follows" on public.user_followers;
drop policy if exists "Users can follow users" on public.user_followers;
drop policy if exists "Users can unfollow users" on public.user_followers;
create policy "Users can view own author follows"
    on public.user_followers for select using (auth.uid() = follower_id);

drop policy if exists "Users can view own bookmarks" on public.bookmarks;
drop policy if exists "Users can bookmark" on public.bookmarks;
drop policy if exists "Users can unbookmark" on public.bookmarks;
create policy "Users can view own bookmarks"
    on public.bookmarks for select using (auth.uid() = user_id);

drop policy if exists "Users can view likes" on public.story_likes;
drop policy if exists "Users can like" on public.story_likes;
drop policy if exists "Users can unlike" on public.story_likes;
create policy "Users can view own likes"
    on public.story_likes for select using (auth.uid() = user_id);

-- Belt as well as braces: even if a future migration adds a permissive policy
-- by accident, the privilege is not there to use.
revoke insert, update, delete on public.story_likes from authenticated, anon;
revoke insert, update, delete on public.bookmarks from authenticated, anon;
revoke insert, update, delete on public.story_followers from authenticated, anon;
revoke insert, update, delete on public.user_followers from authenticated, anon;

create index if not exists idx_story_reads_user_chapter_recent
    on public.story_reads(user_id, chapter_id, read_at desc);

create or replace function public.toggle_story_like(
    p_user_id uuid,
    p_story_id uuid,
    p_on boolean
) returns table("on" boolean, count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rows integer;
    v_count integer;
begin
    if p_user_id is null or p_story_id is null or p_on is null then
        raise exception 'user_id, story_id and on are required';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('story_engagement:' || p_story_id::text, 0)
    );

    select like_count into v_count
    from public.stories
    where id = p_story_id
    for update;

    if not found then
        raise exception 'Story not found';
    end if;

    if p_on then
        insert into public.story_likes(user_id, story_id)
        values (p_user_id, p_story_id)
        on conflict do nothing;
        get diagnostics v_rows = row_count;

        if v_rows > 0 then
            update public.stories
            set like_count = coalesce(like_count, 0) + 1
            where id = p_story_id
            returning like_count into v_count;
        end if;

        return query select true, coalesce(v_count, 0);
    else
        delete from public.story_likes
        where user_id = p_user_id and story_id = p_story_id;
        get diagnostics v_rows = row_count;

        if v_rows > 0 then
            update public.stories
            set like_count = greatest(coalesce(like_count, 0) - 1, 0)
            where id = p_story_id
            returning like_count into v_count;
        end if;

        return query select false, coalesce(v_count, 0);
    end if;
end;
$$;

create or replace function public.toggle_bookmark(
    p_user_id uuid,
    p_story_id uuid,
    p_on boolean
) returns table("on" boolean, count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count integer;
begin
    if p_user_id is null or p_story_id is null or p_on is null then
        raise exception 'user_id, story_id and on are required';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('story_engagement:' || p_story_id::text, 0)
    );

    perform 1 from public.stories where id = p_story_id for update;
    if not found then
        raise exception 'Story not found';
    end if;

    if p_on then
        insert into public.bookmarks(user_id, story_id)
        values (p_user_id, p_story_id)
        on conflict do nothing;
    else
        delete from public.bookmarks
        where user_id = p_user_id and story_id = p_story_id;
    end if;

    select count(*)::integer into v_count
    from public.bookmarks
    where story_id = p_story_id;

    return query select p_on, v_count;
end;
$$;

create or replace function public.toggle_story_follow(
    p_user_id uuid,
    p_story_id uuid,
    p_on boolean
) returns table("on" boolean, count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_rows integer;
    v_count integer;
begin
    if p_user_id is null or p_story_id is null or p_on is null then
        raise exception 'user_id, story_id and on are required';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('story_engagement:' || p_story_id::text, 0)
    );

    select follower_count into v_count
    from public.stories
    where id = p_story_id
    for update;

    if not found then
        raise exception 'Story not found';
    end if;

    if p_on then
        insert into public.story_followers(story_id, user_id)
        values (p_story_id, p_user_id)
        on conflict do nothing;
        get diagnostics v_rows = row_count;

        if v_rows > 0 then
            update public.stories
            set follower_count = coalesce(follower_count, 0) + 1
            where id = p_story_id
            returning follower_count into v_count;
        end if;

        return query select true, coalesce(v_count, 0);
    else
        delete from public.story_followers
        where story_id = p_story_id and user_id = p_user_id;
        get diagnostics v_rows = row_count;

        if v_rows > 0 then
            update public.stories
            set follower_count = greatest(coalesce(follower_count, 0) - 1, 0)
            where id = p_story_id
            returning follower_count into v_count;
        end if;

        return query select false, coalesce(v_count, 0);
    end if;
end;
$$;

create or replace function public.toggle_user_follow(
    p_user_id uuid,
    p_story_id uuid,
    p_on boolean
) returns table("on" boolean, count integer, refused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count integer;
begin
    if p_user_id is null or p_story_id is null or p_on is null then
        raise exception 'user_id, author_id and on are required';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('author_follow:' || p_story_id::text, 0)
    );

    perform 1 from public.profiles where id = p_story_id for update;
    if not found then
        raise exception 'Author not found';
    end if;

    if p_user_id = p_story_id then
        select count(*)::integer into v_count
        from public.user_followers
        where author_id = p_story_id;

        return query select false, v_count, true;
        return;
    end if;

    if p_on then
        insert into public.user_followers(author_id, follower_id)
        values (p_story_id, p_user_id)
        on conflict do nothing;
    else
        delete from public.user_followers
        where author_id = p_story_id and follower_id = p_user_id;
    end if;

    select count(*)::integer into v_count
    from public.user_followers
    where author_id = p_story_id;

    return query select p_on, v_count, false;
end;
$$;

create or replace function public.record_story_read(
    p_user_id uuid,
    p_story_id uuid,
    p_chapter_id uuid,
    p_duration_seconds integer,
    p_device_id text,
    p_ip_hash text
) returns table(
    recorded boolean,
    counted boolean,
    count integer,
    read_id uuid,
    is_own_story boolean,
    counts_for_earnings boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_author_id uuid;
    v_read_id uuid;
    v_is_own_story boolean;
    v_counts_for_earnings boolean;
    v_count integer;
begin
    if p_user_id is null or p_story_id is null then
        raise exception 'user_id and story_id are required';
    end if;

    if p_duration_seconds is not null and
       (p_duration_seconds < 0 or p_duration_seconds > 86400) then
        raise exception 'duration_seconds is out of range';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
            'story_read:' || p_user_id::text || ':' ||
            coalesce(p_chapter_id::text, p_story_id::text),
            0
        )
    );

    select author_id, read_count into v_author_id, v_count
    from public.stories
    where id = p_story_id
    for update;

    if not found then
        raise exception 'Story not found';
    end if;

    if p_chapter_id is not null and not exists (
        select 1
        from public.chapters
        where id = p_chapter_id and story_id = p_story_id
    ) then
        raise exception 'Chapter does not belong to story';
    end if;

    select sr.id, sr.is_own_story, sr.counts_for_earnings
    into v_read_id, v_is_own_story, v_counts_for_earnings
    from public.story_reads sr
    where sr.user_id = p_user_id
      and sr.story_id = p_story_id
      and (
          (p_chapter_id is null and sr.chapter_id is null)
          or sr.chapter_id = p_chapter_id
      )
      and sr.read_at > now() - interval '24 hours'
    order by sr.read_at desc
    limit 1;

    if v_read_id is not null then
        return query select
            false,
            false,
            coalesce(v_count, 0),
            v_read_id,
            v_is_own_story,
            v_counts_for_earnings;
        return;
    end if;

    v_is_own_story := (v_author_id = p_user_id);
    v_counts_for_earnings := not v_is_own_story;

    insert into public.story_reads (
        story_id,
        chapter_id,
        user_id,
        device_id,
        ip_hash,
        duration_seconds,
        is_own_story,
        counts_for_earnings
    ) values (
        p_story_id,
        p_chapter_id,
        p_user_id,
        nullif(pg_catalog.btrim(p_device_id), ''),
        nullif(pg_catalog.btrim(p_ip_hash), ''),
        p_duration_seconds,
        v_is_own_story,
        v_counts_for_earnings
    )
    returning id into v_read_id;

    if v_counts_for_earnings then
        update public.stories
        set read_count = coalesce(read_count, 0) + 1
        where id = p_story_id
        returning read_count into v_count;
    end if;

    return query select
        true,
        v_counts_for_earnings,
        coalesce(v_count, 0),
        v_read_id,
        v_is_own_story,
        v_counts_for_earnings;
end;
$$;

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
        -- Credits for streaks are parked for this build; leave next_credit_at
        -- untouched so the economy cannot grant anything from engagement yet.
    where user_id = p_user_id;

    return query select v_current, v_longest, v_today;
end;
$$;

revoke all on function public.toggle_story_like(uuid, uuid, boolean) from public;
revoke all on function public.toggle_bookmark(uuid, uuid, boolean) from public;
revoke all on function public.toggle_story_follow(uuid, uuid, boolean) from public;
revoke all on function public.toggle_user_follow(uuid, uuid, boolean) from public;
revoke all on function public.record_story_read(uuid, uuid, uuid, integer, text, text) from public;
revoke all on function public.touch_streak(uuid) from public;

grant execute on function public.toggle_story_like(uuid, uuid, boolean) to service_role;
grant execute on function public.toggle_bookmark(uuid, uuid, boolean) to service_role;
grant execute on function public.toggle_story_follow(uuid, uuid, boolean) to service_role;
grant execute on function public.toggle_user_follow(uuid, uuid, boolean) to service_role;
grant execute on function public.record_story_read(uuid, uuid, uuid, integer, text, text) to service_role;
grant execute on function public.touch_streak(uuid) to service_role;
