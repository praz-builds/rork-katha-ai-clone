-- Migration 00058: a story records whether it was ever checked, and a broken
-- safety control can reach the error log.
--
-- Both halves of this file exist because of the same defect, found on
-- production 2026-09-09: entity classification had never once succeeded, on
-- any request, since the entity visibility gate shipped. Every failure was
-- silent, so the gate (migration 00050 and its CHECK constraint) had been
-- inert for weeks while looking, from the outside, exactly like a gate that
-- kept finding nothing to gate.
--
-- 1. `stories.entity_classification_status`
--
-- `entity_gate_reason` is null in two completely different situations: the
-- classifier read the idea and found nobody, and the classifier never
-- answered. `publish-story` reads that column, and null meant publish in both
-- cases, so a story nobody could check was published as freely as one that
-- passed. This column is the missing distinction, recorded by the generation
-- paths at the same moment they write `entity_gate_reason`.
--
-- Nullable on purpose, and NOT backfilled. Null means "generated before there
-- was a column to record this in", which is a different statement from
-- 'unavailable' and must stay one: treating null as unchecked would lock the
-- entire existing corpus out of publishing to close a hole only new stories
-- can be in. `publish-story` refuses only on the explicit 'unavailable'.
--
-- 2. `error_events.bucket`
--
-- The failure is now logged (`bucket: 'grounding'`), and the CHECK on this
-- column is an allow-list, so an unlisted bucket is a rejected insert - i.e.
-- telemetry about a silent failure that fails silently. 'engagement' and
-- 'phrase.learning' are added in the same breath: both have been in the
-- `ErrorBucket` union in `_shared/errors.ts` since 00046 and 00047 without
-- ever being added here, so every row those two paths tried to write has been
-- discarded by this constraint since the day they shipped.

alter table public.stories
    add column if not exists entity_classification_status text;

alter table public.stories
    drop constraint if exists stories_entity_classification_status_check;

alter table public.stories
    add constraint stories_entity_classification_status_check
    check (
        entity_classification_status is null
        or entity_classification_status in ('ok', 'unavailable')
    );

comment on column public.stories.entity_classification_status is
    'Did the server''s entity classification produce a verdict for this story? ''ok'' = it ran and its answer is in entity_gate_reason (null there then genuinely means "names nobody"). ''unavailable'' = provider failure, deadline, unparseable output or a refused rate-limit claim, and the story may not be published publicly. null = generated before migration 00058; not a failed check, and never treated as one.';

alter table public.error_events
    drop constraint if exists error_events_bucket_check;

alter table public.error_events
    add constraint error_events_bucket_check
    check (bucket in (
        'generation.story',
        'generation.edit',
        'generation.cover',
        'generation.audio',
        'grounding',
        'llm.provider',
        'publishing',
        'discovery',
        'credits',
        'payments',
        'engagement',
        'feedback',
        'phrase.learning',
        'client.app',
        'ci.test'
    ));
