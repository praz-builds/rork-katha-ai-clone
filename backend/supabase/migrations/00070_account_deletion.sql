-- Migration 00070: an account can be deleted. Until now it could not be.
--
-- THE STATE THIS REPLACES. There was no deletion path anywhere -- no RPC, no
-- endpoint, no screen -- and there could not have been one: `profiles.id`
-- cascades from `auth.users`, and ten foreign keys into `profiles` declare no
-- `ON DELETE` at all (credit_ledger, stories, comments, streaks, ad_rewards,
-- referrals x2, profiles.referred_by, story_reads, generation_operations).
-- Every account has a credit_ledger row from its welcome grant, so
-- `auth.admin.deleteUser` would raise 23503 and roll the whole thing back --
-- taking the erasure trigger in 00025 with it, which is why that trigger has
-- never fired. Account deletion is an App Store requirement and a GDPR one.
--
-- THE POLICY, decided by the owner on 2026-09-10: anonymise and keep the
-- public work. Published stories and comments survive with the byline
-- replaced; everything private goes. The reason is other people: a reader who
-- saved somebody's story, or is four chapters into it, does not lose it
-- because the author left. Reddit and Medium land in the same place.
--
-- THE MECHANISM: a tombstone, not a cascade.
--
-- The profiles row SURVIVES deletion, scrubbed. That single decision is what
-- makes this migration small instead of a ten-way rewrite of foreign keys:
-- every `references profiles(id)` stays valid because the referenced row is
-- still there. `credit_ledger` keeps its financial history pointing at a real
-- id. `comments` keep their threads intact. `stories.author_id` still
-- resolves -- to an account whose name is now gone.
--
-- What identifies the person is what gets destroyed: the handle (freed for
-- anyone else to claim), the display name, the avatar, the bio, the
-- onboarding answers, the referral link. What is left is a row that says
-- "somebody was here, and they are not any more".
--
-- The `auth.users` row is deleted separately, by the edge function, AFTER
-- this returns -- which is why the cascade on `profiles.id` has to go. With it
-- in place, deleting the auth user would delete the tombstone and take every
-- surviving story with it, which is the opposite of the policy. The link is
-- now maintained by the server alone, which is already true in practice:
-- 00067 made profile creation service-role-only, so nothing but
-- `bootstrap-user` has ever inserted one.

alter table public.profiles
    drop constraint if exists profiles_id_fkey;

comment on column public.profiles.id is
    'The auth user id. NOT a foreign key: a deleted account keeps its profiles row as a scrubbed tombstone (00070) so that surviving stories and comments still resolve, and a cascade from auth.users would destroy exactly that. bootstrap-user is the only writer, so the link is the server''s to keep.';

alter table public.profiles
    add column if not exists deleted_at timestamptz;

comment on column public.profiles.deleted_at is
    'When this account was deleted. Non-null means a tombstone: the person is gone, their public work remains under an anonymous byline, and nothing may treat this row as a reachable user.';

-- Why the reason is stored apart from the profile: the profile is scrubbed of
-- everything identifying, and free text somebody typed on their way out is
-- exactly the kind of thing that can identify them. It lives in its own table
-- with no name, no handle and no way back to one.
create table if not exists public.account_deletion_reasons (
    id uuid primary key default gen_random_uuid(),
    reason text not null,
    detail text,
    deleted_at timestamptz not null default now()
);

comment on table public.account_deletion_reasons is
    'Why people left, with nothing that says who. Deliberately carries no user_id: it is product feedback, not a record about a person, and joining it back to one is not a capability this schema should offer.';

alter table public.account_deletion_reasons enable row level security;
revoke all on table public.account_deletion_reasons from public, anon, authenticated;
grant select, insert on table public.account_deletion_reasons to service_role;

/**
 * Delete an account: scrub the person, keep what other people rely on.
 *
 * Returns the number of published stories left standing, which the caller
 * shows on the confirmation so nobody is surprised later about what survived.
 *
 * Idempotent: a second call on a tombstone changes nothing and returns the
 * same count, so a retried request after a dropped connection is safe.
 */
create or replace function public.delete_account(
    p_user_id uuid,
    p_reason text default null,
    p_detail text default null
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_existing timestamptz;
    v_kept integer;
begin
    if p_user_id is null then
        raise exception 'user_id is required';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('delete_account:' || p_user_id::text, 0)
    );

    select deleted_at into v_existing
    from public.profiles where id = p_user_id for update;

    if not found then
        raise exception 'Account not found';
    end if;

    select count(*)::integer into v_kept
    from public.stories
    where author_id = p_user_id and is_public = true;

    if v_existing is not null then
        return v_kept;
    end if;

    if p_reason is not null and pg_catalog.btrim(p_reason) <> '' then
        insert into public.account_deletion_reasons (reason, detail)
        -- `coalesce` and `nullif` are parser constructs, not pg_catalog
        -- functions, so they resolve unqualified under `search_path = ''` --
        -- schema-qualifying them raises "function does not exist". `left` and
        -- `btrim` are real functions and do need the qualification.
        values (
            pg_catalog.left(pg_catalog.btrim(p_reason), 60),
            nullif(pg_catalog.btrim(coalesce(p_detail, '')), '')
        );
    end if;

    -- 1. The private half. Everything here is the person's own and is theirs
    --    to take with them; none of it is visible to anybody else, so nothing
    --    outside this account notices it go.
    delete from public.saved_phrases where user_id = p_user_id;
    delete from public.phrase_practice where user_id = p_user_id;
    delete from public.bookmarks where user_id = p_user_id;
    delete from public.story_reads where user_id = p_user_id;
    delete from public.activity_days where user_id = p_user_id;
    delete from public.user_characters where owner_id = p_user_id;
    delete from public.push_tokens where user_id = p_user_id;
    delete from public.streaks where user_id = p_user_id;

    -- 2. Relationships, in both directions. A follower count that still
    --    includes a deleted account is a number nobody can explain, and a
    --    block outlasting the blocker is a rule with no author.
    delete from public.story_followers where user_id = p_user_id;
    delete from public.story_likes where user_id = p_user_id;
    delete from public.user_followers
     where follower_id = p_user_id or author_id = p_user_id;
    delete from public.user_blocks
     where blocker_id = p_user_id or blocked_id = p_user_id;
    delete from public.comment_votes where user_id = p_user_id;

    -- 3. Unpublished work. A private draft is private; keeping it would keep
    --    the prose of somebody who asked to be gone. Published stories are
    --    untouched by design -- that is the whole policy.
    delete from public.stories
     where author_id = p_user_id and is_public = false and is_curated = false;

    -- 4. Anything that could still name them.
    update public.profiles
       set username = null,
           display_name = null,
           avatar_url = null,
           bio = null,
           onboarding_purpose = null,
           preferred_genres = '{}',
           referred_by = null,
           deleted_at = pg_catalog.now()
     where id = p_user_id;

    -- Their referral edges go too: a referral is a link between two named
    -- people and one of them no longer exists.
    delete from public.referrals
     where referrer_id = p_user_id or referred_id = p_user_id;
    update public.profiles set referred_by = null where referred_by = p_user_id;

    -- `credit_ledger`, `credit_balance_buckets` and the RevenueCat rows are
    -- deliberately NOT deleted. They are the financial record of real money,
    -- they point at a tombstone rather than a person, and a purchase history
    -- that vanishes on request is not a book anyone can keep.
    return v_kept;
end;
$$;

revoke all on function public.delete_account(uuid, text, text)
    from public, anon, authenticated;
grant execute on function public.delete_account(uuid, text, text) to service_role;

-- A tombstone is not a reachable user. `public_profile` and the feed both hand
-- back an author; neither should hand back a deleted one.
comment on table public.profiles is
    'One row per account, created ONLY by the server (bootstrap-user, service role), and never removed: deletion scrubs the row and sets deleted_at, so surviving stories and comments still resolve to an anonymous byline. Clients may update the narrow set of columns 00060 and 00069 allow and call claim_username/set_avatar; they may not insert.';
