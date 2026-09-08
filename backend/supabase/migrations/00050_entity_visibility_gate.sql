-- Migration 00050: the entity visibility gate
--
-- Product decision, implemented exactly: a story whose idea names a
-- `living_public_figure` or a `private_individual` is forced private,
-- regardless of what the user selected. Historical figures, real places, real
-- events and organisations do NOT trigger it -- a story about Shivaji Maharaj
-- or the Taj Mahal stays publishable, because that is precisely the case the
-- grounding feature (migration 00045) exists to serve.
--
-- `stories.grounding_entities` (00045) already records every classified
-- entity, grounded or not, for exactly this future gate -- its own comment
-- says so. This migration adds the column the gate's decision is written to,
-- and the constraint that makes the rule hold even when the application code
-- that computed it is bypassed entirely.
--
-- ---------------------------------------------------------------------------
-- Why a CHECK constraint, not just an application-level guard
-- ---------------------------------------------------------------------------
-- `publish-story` will refuse to publish a gated story -- see its own code for
-- the typed refusal a client can render. But `stories.is_public` sits inside
-- the `authenticated` role's own UPDATE grant (migration 00015, kept for the
-- editor's local visibility toggle) behind an RLS policy that only checks
-- `auth.uid() = author_id` (migration 00002) -- it does not check anything
-- about the row's content. That means a client can already set
-- `is_public = true` directly through PostgREST, entirely outside
-- `publish-story`. A rule enforced only in one Edge Function's application
-- code is not a gate on that path; a rule enforced by a CHECK constraint holds
-- no matter which door the write comes through, today or in a function nobody
-- has written yet.
--
-- ---------------------------------------------------------------------------
-- Why one column carries both "is it gated" and "why"
-- ---------------------------------------------------------------------------
-- A nullable enum column does both jobs: null means "not gated," and a
-- non-null value is both the flag and the reason in one read, so there is no
-- way for the two to disagree with each other the way a separate boolean and
-- reason column could. It is written once, at generation, from the same
-- classification that populates `grounding_entities` -- see
-- `_shared/entity-visibility-gate.ts` for the derivation and
-- `generate-story`/`generate-story-stream` for where it is persisted.
--
-- Only the two gating classes are legal values here, and the class alone --
-- never a name, never free text. `AGENTS.md`'s telemetry rule ("identifiers
-- and enums only, never free user text") is about `logError` context, not this
-- column, but the same discipline applies for the same reason: this table is
-- read by more code over more time than a single request, and an enum cannot
-- leak what a name could.
--
-- ---------------------------------------------------------------------------
-- Why this cannot retroactively unpublish anything
-- ---------------------------------------------------------------------------
-- `entity_gate_reason` defaults to null and nothing in this migration -- or in
-- the application code that writes it -- ever computes a value for a row that
-- does not already get one from a fresh generation. Every story that exists
-- before this migration runs keeps `entity_gate_reason = null` forever, which
-- trivially satisfies the constraint below whatever `is_public` already is.
-- This is forward-only by construction, not by a guard someone remembered to
-- add: there is no backfill in this file, and there must never be one added
-- later that classifies old stories and gates them after the fact.

alter table public.stories
  add column if not exists entity_gate_reason text;

comment on column public.stories.entity_gate_reason is
  'Set at generation when the idea''s classified entities (stories.grounding_entities) include a living_public_figure or a private_individual. Non-null forces is_public = false, enforced by stories_entity_gate_forces_private below. Null for every story generated before this column existed, and for any story whose idea named neither gating class -- this is forward-only, never backfilled. An enum, never a name: see _shared/entity-visibility-gate.ts.';

alter table public.stories
  drop constraint if exists stories_entity_gate_reason_is_valid;
alter table public.stories
  add constraint stories_entity_gate_reason_is_valid
  check (
    entity_gate_reason is null
    or entity_gate_reason in ('living_public_figure', 'private_individual')
  )
  not valid;

-- The enforcement. Added NOT VALID and validated at the end of this file, in
-- the same pattern 00029/00032/00036/00045 use: ADD CONSTRAINT takes an
-- ACCESS EXCLUSIVE lock for its validation scan and `stories` is a hot table,
-- but every existing row satisfies this trivially (entity_gate_reason is null
-- on all of them), so validating immediately is cheap rather than deferred.
alter table public.stories
  drop constraint if exists stories_entity_gate_forces_private;
alter table public.stories
  add constraint stories_entity_gate_forces_private
  check (entity_gate_reason is null or is_public = false)
  not valid;

-- `entity_gate_reason` is deliberately absent from the `authenticated` UPDATE
-- grant added in migration 00015 (title, topic, cover_image_url, is_public).
-- That grant is an explicit allow-list, so a column simply not added to it is
-- not writable by a story's own author -- the same posture 00045 gives
-- `grounding` and `grounding_entities`, and for the same reason: this value is
-- server-derived from a classification call, and a client that could clear it
-- could publish exactly the story this migration exists to keep private.

alter table public.stories
  validate constraint stories_entity_gate_reason_is_valid;
alter table public.stories
  validate constraint stories_entity_gate_forces_private;
