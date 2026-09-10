-- Migration 00067: a user can currently write their own profile row, before
-- the server ever creates it.
--
-- 00038 hardened profile UPDATE, and 00060 hardened it again, both on the
-- stated principle that `avatar_url`, `referred_by`, `account_created_at` and
-- `first_generation_at` are "written by the backend and none by the owner".
-- Both narrowed UPDATE. Neither touched INSERT, and INSERT was already open:
-- 00002 created a `with check (auth.uid() = id)` insert policy and 00012
-- granted table-level `INSERT` to `authenticated`.
--
-- The row is created lazily -- 00013 dropped the signup trigger, so nothing
-- exists until `bootstrap-user` upserts it -- which leaves a window between
-- signing in and calling bootstrap that belongs to the client:
--
--   POST /rest/v1/profiles
--   { "id": "<my own uid>", "avatar_url": "https://attacker.example/px.gif",
--     "referred_by": "<any uid>", "account_created_at": "2015-01-01" }
--
-- `bootstrap-user`'s upsert uses `ignoreDuplicates`, so it no-ops and the row
-- stands. The avatar is then rendered on every byline, comment and public
-- profile the user appears on, which makes it a tracking pixel that collects
-- the IP of everyone who reads them -- precisely the threat 00060 introduced
-- `set_avatar` to prevent, arriving through the door next to the one it
-- locked. `referred_by` and the two timestamps are the anti-fraud columns.
--
-- The username CHECK and the unique index hold on insert, so no handle could
-- be stolen this way.
--
-- Nothing legitimate loses anything: `bootstrap-user` inserts with the service
-- role, which bypasses both the grant and the policy, and no client code in
-- `expo/` inserts into `profiles` at all. The owner keeps every write they are
-- supposed to have -- `claim_username` and `set_avatar` are SECURITY DEFINER
-- and unaffected, and the narrowed UPDATE policy from 00060 still lets them
-- edit `bio`, `preferred_genres` and `onboarding_purpose`.

drop policy if exists "Users can insert own profile" on public.profiles;

revoke insert on table public.profiles from authenticated;

comment on table public.profiles is
    'One row per account, created ONLY by the server (bootstrap-user, service role). Clients may update the narrow set of columns 00060 allows and call claim_username/set_avatar; they may not insert. 00067 closed the insert path, which had let a user write avatar_url, referred_by and account_created_at into their own row before bootstrap created it.';
