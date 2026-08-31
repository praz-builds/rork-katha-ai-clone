-- Migration 00023: Detach error_events.user_id from profiles
--
-- Error telemetry is append-only history. Profile deletion must not mutate,
-- cascade-delete, or be blocked by historical telemetry rows.

ALTER TABLE public.error_events
    DROP CONSTRAINT IF EXISTS error_events_user_id_fkey;
