-- Migration 00019: Service-role grants for persistent error telemetry
--
-- Migration 00018 intentionally revoked anon/authenticated access. PostgREST
-- still needs explicit service_role privileges for smoke-test and runtime
-- logging through the REST API.

GRANT INSERT, SELECT ON public.error_events TO service_role;
GRANT SELECT ON public.error_event_summary TO service_role;
