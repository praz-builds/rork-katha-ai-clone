-- Migration 00032: validate the cover_status check added NOT VALID in 00029
--
-- Separate file because `supabase db push` wraps each file in one transaction.
-- Validating in 00029 would have run under the ACCESS EXCLUSIVE lock that
-- ADD CONSTRAINT holds until commit, blocking every read and write on
-- `public.stories` for the duration of the scan — the exact outage NOT VALID
-- exists to avoid. Here it takes SHARE UPDATE EXCLUSIVE instead, which
-- concurrent traffic can proceed against.
--
-- The scan cannot fail: `cover_status` was added in 00029 with a default of
-- 'pending', which is in the allowed set, and nothing has written it since.
-- That is why this is safe to run unattended, unlike the restricting
-- constraints validated in 00028.

alter table public.stories
  validate constraint stories_cover_status_check;
