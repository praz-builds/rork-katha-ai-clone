-- Migration 00038: a profile owner may edit their profile, not become someone else
--
-- 00002 created "Users can update own profile" with a USING clause and no
-- WITH CHECK. USING decides which rows the statement may touch; WITH CHECK
-- decides what the rows are allowed to look like afterwards. With only the
-- first, a user passes the check by owning the row they started from and the
-- new row is unexamined -- so `update profiles set id = <someone else>` is
-- accepted, and the victim's auth.users row now points at a profile its owner
-- no longer controls.
--
-- 00012 then granted table-wide UPDATE to `authenticated` to restore the
-- privileges the earlier hardening had stripped. That grant covers every
-- column, including the three anti-fraud columns 00003 added: `referred_by`
-- decides who gets a referral payout, `first_generation_at` and
-- `account_created_at` are the timestamps the abuse heuristics read. All three
-- are written by the backend and none by the owner.
--
-- The column list below is the set the product actually lets a person edit,
-- taken from the schema plus every writer of `profiles` in the repo (only
-- `bootstrap-user` writes it, and it uses the service role, which is unaffected
-- by both the policy and the grant). Anything not listed here is server-owned.

drop policy if exists "Users can update own profile" on public.profiles;

create policy "Users can update own profile"
    on public.profiles for update
    using (auth.uid() = id)
    with check (auth.uid() = id);

-- Revoking the table-level privilege also drops the column-level grants that
-- 00017 added, so the grant below has to re-state `preferred_genres`.
revoke update on public.profiles from authenticated;

grant update (
    username,
    avatar_url,
    onboarding_purpose,
    preferred_genres
) on public.profiles to authenticated;
