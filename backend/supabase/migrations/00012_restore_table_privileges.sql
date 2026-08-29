-- Migration 00012: Restore table privileges and auto-create profiles
--
-- RLS policies filter rows; they do not grant table privileges. Migrations
-- 00001-00002 enabled RLS and created policies but never issued GRANTs, and the
-- project has no blanket default privileges, so every table except the ones
-- 00006 granted explicitly returns 42501 "permission denied" for anon,
-- authenticated, AND service_role. That makes the edge functions fail: the
-- generate-story service client cannot read generation_operations, so the
-- handler throws and returns HTTP 500.
--
-- Grants below mirror the existing RLS policies exactly - no operation is
-- granted that does not already have a policy, so RLS remains the row-level
-- authority and default-deny still applies where no policy exists.
--
-- profiles keeps the column-level SELECT from 00006; it is deliberately NOT
-- widened here.

-- ---------------------------------------------------------------------------
-- 1. Schema usage
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. service_role: full table access (bypasses RLS; required by edge functions)
-- ---------------------------------------------------------------------------

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;

-- Function privileges are intentionally NOT blanket-granted. The service-only
-- EXECUTE grants from 00005/00008/00010 already cover the credit and generation
-- RPCs, and a blanket grant would undo their REVOKEs.

-- ---------------------------------------------------------------------------
-- 3. authenticated: grants that mirror the RLS policies
-- ---------------------------------------------------------------------------

GRANT SELECT                 ON public.ad_rewards      TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.bookmarks       TO authenticated;
GRANT SELECT                 ON public.chapters        TO authenticated;
GRANT SELECT                 ON public.characters      TO authenticated;
GRANT SELECT, INSERT         ON public.comments        TO authenticated;
GRANT SELECT                 ON public.credit_ledger   TO authenticated;
GRANT SELECT                 ON public.referrals       TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.stories         TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.story_followers TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.story_likes     TO authenticated;
GRANT SELECT                 ON public.story_reads     TO authenticated;
GRANT SELECT                 ON public.streaks         TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_followers  TO authenticated;

-- profiles: INSERT/UPDATE per policy. SELECT stays column-limited per 00006.
GRANT INSERT, UPDATE ON public.profiles TO authenticated;

-- 00006 revoked UPDATE(status) on stories from authenticated. The table-level
-- GRANT above would restore it, so re-assert the narrower rule.
REVOKE UPDATE (status) ON public.stories FROM authenticated;

-- generation_operations and payment_event_backlog have no policies for
-- authenticated and stay service-only. No grant is issued for them.

-- ---------------------------------------------------------------------------
-- 4. anon: public reading surface only
-- ---------------------------------------------------------------------------

GRANT SELECT ON public.stories    TO anon;
GRANT SELECT ON public.chapters   TO anon;
GRANT SELECT ON public.characters TO anon;
GRANT SELECT ON public.comments   TO anon;

-- ---------------------------------------------------------------------------
-- 5. Auto-create a profile row for every auth user
--
--    credit_ledger.user_id references profiles(id), so without a profile row a
--    user can never be granted credits and generation always fails.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    -- profiles.username is UNIQUE, so the fallback is derived from the user id
    -- and cannot collide. A requested username is used only when it is free;
    -- otherwise the insert would fail on the unique constraint.
    v_requested text := pg_catalog.nullif(
        pg_catalog.btrim(NEW.raw_user_meta_data ->> 'username'), ''
    );
    v_username text;
BEGIN
    IF v_requested IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE username = v_requested
    ) THEN
        v_username := v_requested;
    ELSE
        v_username := 'user_' || pg_catalog.replace(NEW.id::text, '-', '');
    END IF;

    INSERT INTO public.profiles (id, username)
    VALUES (NEW.id, v_username)
    ON CONFLICT (id) DO NOTHING;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Never block account creation on profile setup. A missing profile is
    -- recoverable through the backfill below; a failed signup is not.
    RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill profiles for auth users created before the trigger existed.
INSERT INTO public.profiles (id, username)
SELECT u.id, 'user_' || pg_catalog.replace(u.id::text, '-', '')
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
