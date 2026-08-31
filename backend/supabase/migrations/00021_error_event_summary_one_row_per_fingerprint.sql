-- Migration 00021: Keep error_event_summary to one row per fingerprint
--
-- Fingerprint does not include severity. Derive the highest observed severity
-- for a fingerprint instead of splitting recurrence counts by severity.

CREATE OR REPLACE VIEW public.error_event_summary
WITH (security_invoker = on) AS
SELECT
    fingerprint,
    bucket,
    (array_agg(
        severity
        ORDER BY array_position(ARRAY['critical','high','medium','low'], severity), occurred_at DESC
    ))[1] AS severity,
    error_code,
    count(*) AS occurrences,
    count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS affected_users,
    min(occurred_at) AS first_seen,
    max(occurred_at) AS last_seen,
    (array_agg(message ORDER BY occurred_at DESC))[1] AS latest_message,
    (array_agg(source ORDER BY occurred_at DESC))[1] AS latest_source,
    (array_agg(release_ref ORDER BY occurred_at DESC))[1] AS latest_release_ref
FROM public.error_events
GROUP BY fingerprint, bucket, error_code;

REVOKE ALL ON public.error_event_summary FROM anon, authenticated;
GRANT SELECT ON public.error_event_summary TO service_role;
