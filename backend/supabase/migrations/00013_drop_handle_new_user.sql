-- Migration 00013: Remove the handle_new_user trigger added in 00012
--
-- 00012 bundled two unrelated changes: the table GRANTs that the data layer
-- actually needed, and an auth.users -> profiles trigger. The trigger was
-- premature (there is no signup flow yet) and it was broken:
--
-- 1. It called pg_catalog.nullif(). NULLIF is a SQL expression node, not a
--    callable catalog function, so the schema-qualified form does not resolve.
--
-- 2. That call sat in the DECLARE section. plpgsql evaluates variable defaults
--    BEFORE entering the BEGIN block, so the EXCEPTION handler that existed to
--    stop exactly this was not yet active. The error escaped the trigger and
--    aborted the INSERT, so auth.users inserts failed with
--    "Database error creating new user".
--
-- Rather than ship a corrected trigger for a flow that does not exist, this
-- migration removes it. Profile creation belongs with the signup work, where it
-- can be built against a real flow and tested. The GRANTs from 00012 are
-- correct and are deliberately left in place.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 00012 also backfilled profiles for existing auth users. Those rows are valid
-- and are intentionally kept: profiles.id references auth.users(id), and
-- credit_ledger.user_id references profiles(id), so an existing profile row is
-- only ever helpful. Nothing is removed here.
