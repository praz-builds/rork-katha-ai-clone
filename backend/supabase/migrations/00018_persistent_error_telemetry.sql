-- Migration 00018: Persistent error telemetry
--
-- Creates public.error_events, the durable system of record for failures across
-- every runtime: edge function runtime errors, agent-run production smoke tests,
-- CI test failures, and Expo client errors. Before this table the only failure
-- signal was console output in short-retention logs, so no failure history
-- accumulated and recurrences were invisible.
--
-- PII RULE: the `context` column never stores story prose, user seeds, prompts,
-- titles, comments, or other free user text. Identifiers and enums only.

CREATE TABLE IF NOT EXISTS public.error_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    bucket text NOT NULL CHECK (bucket IN (
        'generation.story',
        'generation.edit',
        'generation.cover',
        'generation.audio',
        'llm.provider',
        'publishing',
        'discovery',
        'credits',
        'payments',
        'feedback',
        'client.app',
        'ci.test'
    )),

    severity text NOT NULL DEFAULT 'medium'
        CHECK (severity IN ('critical', 'high', 'medium', 'low')),

    source text NOT NULL
        CHECK (source IN ('runtime', 'smoke_test', 'ci', 'client')),

    error_code text,
    message text NOT NULL,
    context jsonb NOT NULL DEFAULT '{}'::jsonb,
    user_id uuid REFERENCES public.profiles(id),

    environment text NOT NULL DEFAULT 'production'
        CHECK (environment IN ('production', 'staging', 'local')),

    release_ref text,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.error_events
    ADD COLUMN IF NOT EXISTS fingerprint text
    GENERATED ALWAYS AS (
        md5(
            bucket || '|' || COALESCE(error_code, '') || '|' ||
            left(
                regexp_replace(
                    regexp_replace(
                        lower(message),
                        '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
                        '<uuid>',
                        'g'
                    ),
                    '[0-9]+',
                    '<n>',
                    'g'
                ),
                500
            )
        )
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_error_events_bucket_occurred
    ON public.error_events(bucket, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_events_fingerprint_occurred
    ON public.error_events(fingerprint, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_events_severity_occurred
    ON public.error_events(severity, occurred_at DESC)
    WHERE severity IN ('critical', 'high');

ALTER TABLE public.error_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.error_events FROM anon, authenticated;

CREATE OR REPLACE VIEW public.error_event_summary
WITH (security_invoker = on) AS
SELECT
    fingerprint,
    bucket,
    severity,
    error_code,
    count(*) AS occurrences,
    count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS affected_users,
    min(occurred_at) AS first_seen,
    max(occurred_at) AS last_seen,
    (array_agg(message ORDER BY occurred_at DESC))[1] AS latest_message,
    (array_agg(source ORDER BY occurred_at DESC))[1] AS latest_source,
    (array_agg(release_ref ORDER BY occurred_at DESC))[1] AS latest_release_ref
FROM public.error_events
GROUP BY fingerprint, bucket, severity, error_code;

REVOKE ALL ON public.error_event_summary FROM anon, authenticated;

COMMENT ON TABLE public.error_events IS
    'Durable cross-domain failure log. Service-role writes only. context holds identifiers and enums only, never user text.';

COMMENT ON COLUMN public.error_events.fingerprint IS
    'Derived grouping key (bucket + error_code + normalized message). Used to count recurrences and, later, as the Sentry grouping key.';

COMMENT ON VIEW public.error_event_summary IS
    'One row per distinct failure with recurrence counts. Query this before fixing a failure to check whether it is a regression.';
