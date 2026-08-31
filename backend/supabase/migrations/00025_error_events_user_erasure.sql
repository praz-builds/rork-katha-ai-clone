-- Migration 00025: Erasure path for the detached error_events.user_id
--
-- Migration 00023 dropped error_events_user_id_fkey so that append-only
-- telemetry can neither block a profile deletion nor be rewritten by one.
-- That left user_id as a retained user identifier with no database-level
-- lifecycle: an erasure request would leave it in telemetry indefinitely.
--
-- Choice recorded here: NULL the identifier, keep the event row. Deleting the
-- rows outright would destroy the failure history that the table exists to
-- accumulate, and the row is still useful once it is no longer attributable.
-- Both paths below keep profile deletion non-blocking.

-- Path 1: automatic. Fires on profile deletion, nulls the identifier, and
-- leaves every other column of the event untouched.
CREATE OR REPLACE FUNCTION public.erase_error_events_user_id()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
BEGIN
    UPDATE public.error_events
        SET user_id = NULL
        WHERE user_id = OLD.id;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS erase_error_events_user_id ON public.profiles;

CREATE TRIGGER erase_error_events_user_id
    AFTER DELETE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.erase_error_events_user_id();

-- Path 2: on demand. For an erasure request that must be honored for a user
-- whose profile row is already gone, or to re-run erasure during an audit.
CREATE OR REPLACE FUNCTION public.erase_user_error_telemetry(p_user_id uuid)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
    erased bigint;
BEGIN
    UPDATE public.error_events
        SET user_id = NULL
        WHERE user_id = p_user_id;
    GET DIAGNOSTICS erased = ROW_COUNT;
    RETURN erased;
END;
$$;

-- Service role only: erasure is an operator action, never a client one.
REVOKE ALL ON FUNCTION public.erase_user_error_telemetry(uuid) FROM public;
REVOKE ALL ON FUNCTION public.erase_user_error_telemetry(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.erase_user_error_telemetry(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.erase_user_error_telemetry(uuid) TO service_role;

-- Retention backstop: an identifier older than the window is not needed to
-- investigate a live incident. Call from a scheduled job.
CREATE OR REPLACE FUNCTION public.prune_error_event_user_ids(p_older_than interval DEFAULT interval '90 days')
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $$
DECLARE
    pruned bigint;
BEGIN
    UPDATE public.error_events
        SET user_id = NULL
        WHERE user_id IS NOT NULL
          AND occurred_at < now() - p_older_than;
    GET DIAGNOSTICS pruned = ROW_COUNT;
    RETURN pruned;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_error_event_user_ids(interval) FROM public;
REVOKE ALL ON FUNCTION public.prune_error_event_user_ids(interval) FROM anon;
REVOKE ALL ON FUNCTION public.prune_error_event_user_ids(interval) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prune_error_event_user_ids(interval) TO service_role;
