-- Migration 00020: Preserve append-only error telemetry on profile deletion
--
-- The first deployed form used ON DELETE SET NULL, which mutates historical
-- telemetry rows when a profile is deleted. Keep the reference non-mutating:
-- profile deletion must be handled by retention policy, not by rewriting logs.

ALTER TABLE public.error_events
    DROP CONSTRAINT IF EXISTS error_events_user_id_fkey;

ALTER TABLE public.error_events
    ADD CONSTRAINT error_events_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) NOT VALID;
