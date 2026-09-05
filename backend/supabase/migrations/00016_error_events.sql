-- Migration 00016: Persistent error telemetry
--
-- Creates public.error_events, the durable system of record for failures across
-- every runtime: edge function runtime errors, agent-run production smoke tests,
-- CI test failures, and Expo client errors. Before this table the only failure
-- signal was ~30 console.error calls writing to short-retention Supabase function
-- logs, so no failure history accumulated and recurrences were invisible.
--
-- Generalizes the per-domain precedent already in this schema:
--   - payment_event_backlog (00005) persists failed Adapty events
--   - generation_operations.last_error (00005) persists per-operation failures
-- Those stay as-is; this table is the cross-cutting log that spans all domains.
--
-- PII RULE (enforced by convention, see .agents/skills/error-logging/SKILL.md):
-- the `context` column NEVER stores story prose, user seeds, prompts, or any
-- free user text. Identifiers and enums only (request_id, story_id, model,
-- provider, http_status). Retrofitting this rule after three years of rows is
-- expensive; honoring it from row one is free.

-- Step 1: The log table
CREATE TABLE IF NOT EXISTS public.error_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Domain bucket. Deliberately a domain, not a function name, so a failure
    -- keeps its bucket when code moves between functions.
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

    -- Severity vocabulary matches .agents/skills/security-scan/SKILL.md.
    severity text NOT NULL DEFAULT 'medium'
        CHECK (severity IN ('critical', 'high', 'medium', 'low')),

    -- Which runtime produced the row.
    source text NOT NULL
        CHECK (source IN ('runtime', 'smoke_test', 'ci', 'client')),

    -- Stable short slug, e.g. 'llm_all_providers_failed', 'refund_pending'.
    -- Nullable so an unclassified failure is still recorded rather than dropped.
    error_code text,

    message text NOT NULL,

    -- Identifiers and enums only. See PII RULE above.
    context jsonb NOT NULL DEFAULT '{}'::jsonb,

    user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

    environment text NOT NULL DEFAULT 'production'
        CHECK (environment IN ('production', 'staging', 'local')),

    -- Git SHA or deployed function version, so a failure can be tied to a release.
    release_ref text,

    occurred_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Step 2: Fingerprint
--
-- The grouping key that turns a pile of rows into a system: it answers "is this
-- new, or the fourth time?" and later becomes the stable grouping key handed to
-- Sentry. Derived, not supplied, so callers cannot drift.
--
-- Normalization strips UUIDs and digit runs so that two occurrences differing
-- only by request id or row count collapse to one fingerprint. Every function
-- used is IMMUTABLE, which is required for a STORED generated column.
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

-- Step 3: Read paths
-- "what broke in this bucket lately" and "how often has this fingerprint fired".
CREATE INDEX IF NOT EXISTS idx_error_events_bucket_occurred
    ON public.error_events(bucket, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_events_fingerprint_occurred
    ON public.error_events(fingerprint, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_events_severity_occurred
    ON public.error_events(severity, occurred_at DESC)
    WHERE severity IN ('critical', 'high');

-- Step 4: Lock it down
--
-- Service-role writes only. The table holds operational failure detail and must
-- never be readable by anon or authenticated clients. RLS is enabled with NO
-- policies, so every non-service-role query returns zero rows; the explicit
-- REVOKE matches the hardening posture established in 00006.
ALTER TABLE public.error_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.error_events FROM anon, authenticated;

-- Step 5: Triage view
--
-- The aggregate humans and agents actually read: one row per distinct failure,
-- with recurrence count and first/last seen. security_invoker keeps the view
-- subject to the caller's RLS rather than the definer's.
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
