-- Migration 00044: re-apply set_comment_vote to environments that already ran 00043.
--
-- WHY THIS EXISTS, AND WHY IT IS NOT A DUPLICATE.
--
-- `set_comment_vote` was added to 00043 during review, AFTER 00043 had already
-- been applied to the live project. A migration runner keys off the version
-- number, so every environment that had already recorded 00043 will never see
-- the edited file: the function silently does not exist there, while a freshly
-- created database gets it. Production and a clean checkout had therefore
-- diverged, and the divergence was invisible until something called the
-- function.
--
-- It is not theoretical. The deployed `comments` function routes voting
-- through this RPC on `main`; against the live database the call returned
-- PGRST202, "Could not find the function public.set_comment_vote". The next
-- deploy of that function would have broken voting in production while every
-- test stayed green, because the test harness builds a fresh database where
-- 00043 does create it.
--
-- The body below is copied verbatim from 00043. `create or replace` makes this
-- a no-op on any database that already has it, so replaying 00043's version
-- here is safe in both directions. Editing an applied migration is what caused
-- this; the fix is a new forward-only migration, never another edit.

create or replace function public.set_comment_vote(
    p_comment_id uuid,
    p_value smallint
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        raise exception 'not authenticated' using errcode = '42501';
    end if;

    if p_value not in (-1, 0, 1) then
        raise exception 'invalid vote value' using errcode = '22023';
    end if;

    if not exists (
        select 1
        from public.comments c
        join public.stories s on s.id = c.story_id
        where c.id = p_comment_id
          and (
              s.is_public = true
              or s.is_curated = true
              or s.author_id = v_user_id
          )
    ) then
        raise exception 'comment not found' using errcode = '23503';
    end if;

    if p_value = 0 then
        delete from public.comment_votes
        where user_id = v_user_id
          and comment_id = p_comment_id;
        return;
    end if;

    insert into public.comment_votes (user_id, comment_id, value)
    values (v_user_id, p_comment_id, p_value)
    on conflict (user_id, comment_id) do update
    set value = excluded.value
    where public.comment_votes.value is distinct from excluded.value;
end;
$$;

revoke all on function public.set_comment_vote(uuid, smallint) from public;
grant execute on function public.set_comment_vote(uuid, smallint) to authenticated;
