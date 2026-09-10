-- Migration 00071: two functions that raise 42883 every time they are called.
--
-- `NULLIF`, `COALESCE`, `GREATEST` and `LEAST` look like functions and are
-- not. They are expression nodes the parser handles directly, they live in no
-- schema, and schema-qualifying one produces
-- `function pg_catalog.nullif(text, unknown) does not exist` -- at RUN time,
-- not at CREATE time, because the body of a plpgsql function is only parsed
-- when it executes. So both of these deployed cleanly, passed every migration
-- test that did not call them, and have been broken since the day they shipped.
--
-- 00013 already learned this, and said so at the time: "It called
-- pg_catalog.nullif(). NULLIF is a SQL expression node, not a function." The
-- note did not survive into the two files below. It is worth restating plainly:
-- under `search_path = ''` every real function needs qualifying and these four
-- must NOT be, which is an unhappy rule to have to remember and exactly the
-- kind of thing that needs a test that calls the function rather than one that
-- checks it exists.
--
-- 1. `set_profile_bio` (00060) -- verified against production 2026-09-10:
--    every call, with any argument including null, returns
--    `42883 function pg_catalog.nullif(text, unknown) does not exist`.
--    Editing a bio has never once worked.
--
-- 2. `release_cover_claim` (00044) -- the `p_refund_attempt` branch, which is
--    the entire reason the argument exists. It runs on the four paths that
--    claim a cover regeneration and then stop before spending anything (no
--    credits, a reservation already held, a spent request id, a throwing
--    reservation RPC). Instead of giving the attempt back it raises, so the
--    writer keeps the spent attempt -- the precise failure 00044 was written
--    to prevent, reintroduced by the fix for it.

create or replace function public.set_profile_bio(
    p_user_id uuid,
    p_bio text
) returns table(bio text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_bio text;
begin
    if p_user_id is null then
        raise exception 'user_id is required';
    end if;

    -- `nullif` and `coalesce` unqualified; `btrim` and `length` qualified.
    -- The difference is that the first two are parser constructs and the last
    -- two are functions in pg_catalog.
    v_bio := nullif(pg_catalog.btrim(coalesce(p_bio, '')), '');
    if pg_catalog.length(coalesce(v_bio, '')) > 200 then
        raise exception 'bio is too long';
    end if;

    update public.profiles
    set bio = v_bio
    where id = p_user_id;

    if not found then
        raise exception 'Profile not found';
    end if;

    return query select v_bio;
end;
$$;

create or replace function public.release_cover_claim(
    p_story_id uuid,
    p_user_id uuid,
    p_previous_status text,
    p_refund_attempt boolean default false
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.stories
    set cover_status = case
            when p_previous_status in ('pending', 'generating', 'ready', 'failed')
                then p_previous_status
            else 'failed'
        end,
        cover_attempt_count = case
            -- `greatest`, unqualified, for the same reason.
            when p_refund_attempt then greatest(0, cover_attempt_count - 1)
            else cover_attempt_count
        end
    where id = p_story_id
      and author_id = p_user_id;
end;
$$;

revoke all on function public.set_profile_bio(uuid, text)
    from public, anon, authenticated;
grant execute on function public.set_profile_bio(uuid, text) to service_role;

revoke all on function public.release_cover_claim(uuid, uuid, text, boolean)
    from public, anon, authenticated;
grant execute on function public.release_cover_claim(uuid, uuid, text, boolean)
    to service_role;
