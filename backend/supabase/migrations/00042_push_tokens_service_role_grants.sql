-- Migration 00042: the push sender can read the tokens it sends to
--
-- 00037 created `push_tokens` and locked it down with
--
--     revoke all on table public.push_tokens from public, anon;
--     grant select, delete on table public.push_tokens to authenticated;
--
-- The revoke is the part that bites. `revoke all ... from public` removes the
-- privileges every role inherits through PUBLIC, and nothing was granted back
-- to `service_role`, so the only role that actually sends notifications could
-- not read the table. `send-push` failed at its first query with
--
--     42501: permission denied for table push_tokens
--
-- every time it was called. Nothing had called it yet - the completion paths
-- were never wired - so the table looked fine and the function looked finished.
-- This was found by wiring the caller and running it, not by reading the
-- migration, which is the argument for wiring a feature end to end before
-- calling it done.
--
-- RLS stays on and its policies are unchanged. `service_role` bypasses RLS but
-- is still subject to table privileges, and those are two different gates: the
-- policies decide which rows a user sees, and this decides whether the sender
-- can see the table at all.
--
-- `insert` and `update` are included because `register_push_token` upserts on a
-- reinstall, and `delete` because the sender prunes tokens Expo reports as
-- `DeviceNotRegistered`. A sender that cannot prune accumulates dead tokens
-- until it is rate limited, and the symptom appears nowhere near the cause.

grant select, insert, update, delete
    on table public.push_tokens
    to service_role;
