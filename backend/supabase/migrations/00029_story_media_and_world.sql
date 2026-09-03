-- Migration 00029: the cover lifecycle
--
-- 00027 gave the flow its columns: `chapters.image_url`, `characters.portrait_url`,
-- `stories.where_and_when`, `chapter_length`, `moments`, and the widened
-- `generation_operations.kind` that lets a paid image reserve an operation.
-- This adds the one thing that is missing once images are actually generated:
-- a way to tell "not attempted yet" from "in flight" from "failed".
--
-- Why it matters. Chapter 1's art is generated on a background task after the
-- text response is flushed, so for the first tens of seconds of a story's life
-- `chapters.image_url` is null. Null is the same value it holds when generation
-- was never started, and the same value it holds when every provider refused.
-- The client has to choose between showing a spinner and showing the
-- typographic concept card, and a single null cannot tell it which is right —
-- so a failed cover would spin forever and a pending one would settle on the
-- concept card and never look again.
--
-- `cover_started_at` exists because `EdgeRuntime.waitUntil` keeps an isolate
-- alive on a best-effort basis. If the platform reclaims it mid-job, no code of
-- ours runs again for that story and the row stays `generating` with nothing
-- behind it. Nothing can prevent that from inside the isolate. A timestamp
-- makes it *detectable*: without one, "in flight" and "died an hour ago" are
-- the same row.

alter table public.stories
  add column if not exists cover_status text not null default 'pending',
  add column if not exists cover_started_at timestamptz;

-- 'pending'    nothing attempted yet — show the concept card, no spinner
-- 'generating' in flight; stale past ~10 minutes (see media.ts)
-- 'ready'      cover_image_url is populated
-- 'failed'     every provider was exhausted. The concept card is the final
--              look, which decision 39 already treats as legitimate.
--
-- Added NOT VALID and validated separately: a plain ADD CONSTRAINT scans every
-- row under an ACCESS EXCLUSIVE lock, which on a live table blocks the inserts
-- generate-story depends on. Every existing row satisfies it anyway — the
-- column was just added with a default — which is exactly why it is not worth
-- a write outage.
alter table public.stories
  drop constraint if exists stories_cover_status_check;
alter table public.stories
  add constraint stories_cover_status_check
  check (cover_status in ('pending', 'generating', 'ready', 'failed'))
  not valid;
alter table public.stories
  validate constraint stories_cover_status_check;

comment on column public.stories.cover_status is
  'Lifecycle of chapter 1 art, which is the story cover. Distinguishes not-yet-tried from in-flight from failed, which a null cover_image_url cannot.';
comment on column public.stories.cover_started_at is
  'When the current generating claim was made. A generating row older than ~10 minutes is stale, not in flight.';

-- cover_status is deliberately NOT added to the narrow owner-update grant from
-- migration 00015. It is server-derived, and a client that could set it to
-- 'ready' with no image behind it would strand its own readers on a cover that
-- never arrives.

-- ---------------------------------------------------------------------------
-- Cleanup for one database
-- ---------------------------------------------------------------------------
-- An earlier revision of this work was numbered 00027 and applied to the live
-- project before 00027_story_flow_contracts existed on main. It added
-- `characters.image_url` for portraits; the merged contract calls that column
-- `characters.portrait_url`, and that is the one the code writes. Dropping the
-- duplicate keeps a single source of truth for a portrait URL rather than two
-- columns that can disagree.
--
-- Guarded on emptiness so this can never destroy data: on a database where the
-- old column was populated, the migration fails loudly and a human decides,
-- rather than silently discarding portraits.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'characters'
      and column_name = 'image_url'
  ) then
    if exists (select 1 from public.characters where image_url is not null) then
      raise exception
        'characters.image_url holds data; copy it into portrait_url before dropping';
    end if;
    alter table public.characters drop column image_url;
  end if;
end $$;
