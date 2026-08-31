-- Migration 00022: Validate error_events user reference
--
-- Migration 00020 creates the replacement FK as NOT VALID to avoid holding the
-- stronger validation lock while the constraint is added. Validate separately.

ALTER TABLE public.error_events
    VALIDATE CONSTRAINT error_events_user_id_fkey;
