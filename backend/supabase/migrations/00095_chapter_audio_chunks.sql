-- Narration chunks become rows, so a chapter can be synthesised all at once.
--
-- Until now a chapter too long for the provider's ~10,000 character request
-- limit was split into up to three chunks and synthesised ONE PER
-- `audio-status` POLL: chunk 1 only started after chunk 0 came back. Measured
-- on production 2026-09-19, that is 101.6s before a two-chunk chapter plays a
-- single second and ~135s for three, because the reader hears nothing until
-- the stitched file exists. The fix is to start every chunk in the same
-- `generate-audio` request and let the reader begin on chunk 0 while the rest
-- are still synthesising -- roughly one chunk's ~45s to first audio, whatever
-- the chapter's length.
--
-- That needs one provider job id per chunk, and `chapter_audio` cannot hold
-- them: it has a single `provider_job_id` column with a CHECK that admits
-- exactly one id. Columns would also be the wrong shape -- three columns
-- today, four the day `NARRATION_MAX_CHUNKS` moves. So the chunks get their
-- own table, and `chapter_audio.provider_job_id` keeps holding CHUNK 0's id,
-- which is what `stillOwnsNarrationJob`, `isNarrationJobStale` and 00054's
-- re-claim path already read and must keep reading unchanged.
--
-- The staged part objects stay exactly where `narrationPartPath` has always
-- put them. What changes is that a chunk's index is now RECORDED rather than
-- derived from counting objects in a bucket listing: counting could not
-- distinguish "part 2 is missing" from "part 2 has not been made yet", which
-- is only safe while chunks finish in order, and they no longer do.

create table if not exists public.chapter_audio_chunks (
  id uuid primary key default gen_random_uuid(),
  chapter_audio_id uuid not null
    references public.chapter_audio(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  -- The same shape `chapter_audio.provider_job_id` accepts, for the same
  -- reason: this value is interpolated into a RunPod status URL.
  provider_job_id text,
  storage_path text,
  status public.chapter_audio_status not null default 'pending',
  duration_seconds numeric(10, 3),
  char_count integer,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chapter_audio_id, chunk_index),
  check (provider_job_id is null or provider_job_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  check (storage_path is null or storage_path <> ''),
  check (duration_seconds is null or duration_seconds >= 0),
  check (char_count is null or char_count >= 0),
  -- Mirrors the parent's invariant: a chunk is `ready` exactly when there is
  -- something on disk to play. A `ready` row with no path would reach a reader
  -- as a null URL in the manifest; a path on a `pending` row would be a part
  -- nothing ever published.
  check ((status = 'ready') = (storage_path is not null))
);

comment on table public.chapter_audio_chunks is
  'One row per provider request of a multi-request narration. The parent chapter_audio row keeps chunk 0''s job id; these rows carry the rest.';
comment on column public.chapter_audio_chunks.storage_path is
  'Path of this chunk''s staged part in the public audio bucket. It survives the stitch: a reader mid-playthrough is still holding that URL.';

create index if not exists idx_chapter_audio_chunks_parent
  on public.chapter_audio_chunks(chapter_audio_id, chunk_index);

-- ---------------------------------------------------------------------------
-- Claiming the chunk set
-- ---------------------------------------------------------------------------
--
-- A claim always restarts at chunk 0, so it DELETES whatever was there before
-- rather than reconciling with it. The same reasoning as `removeNarrationParts`
-- on a fresh claim: resuming onto an abandoned attempt's rows would splice two
-- revisions of the prose together if the chapter was edited in between, and
-- nothing downstream could detect it. The cascade from `chapter_audio` covers
-- the other direction.
--
-- The advisory lock is keyed exactly as `claim_chapter_audio_generation`'s is,
-- on (chapter, voice) rather than on the audio row id, so the two claims
-- serialise against each other: a re-claim taking this (chapter, voice) over
-- cannot interleave with a chunk set being written for the run it replaced.

create or replace function public.claim_chapter_audio_chunks(
  p_audio_id uuid,
  p_count integer,
  p_char_counts integer[] default null
) returns table(
  chunk_id uuid,
  chunk_index integer,
  char_count integer,
  status public.chapter_audio_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audio public.chapter_audio;
begin
  if p_audio_id is null or p_count is null or p_count < 1 then
    raise exception 'audio_id and a positive count are required';
  end if;

  select * into v_audio
  from public.chapter_audio ca
  where ca.id = p_audio_id;

  if not found then
    raise exception 'chapter_audio row not found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'chapter_audio:' || v_audio.chapter_id::text || ':' || v_audio.voice_id,
      0
    )
  );

  delete from public.chapter_audio_chunks cac
  where cac.chapter_audio_id = p_audio_id;

  return query
  insert into public.chapter_audio_chunks
    (chapter_audio_id, chunk_index, char_count)
  select p_audio_id, i, p_char_counts[i + 1]
  from pg_catalog.generate_series(0, p_count - 1) as i
  returning
    chapter_audio_chunks.id,
    chapter_audio_chunks.chunk_index,
    chapter_audio_chunks.char_count,
    chapter_audio_chunks.status;
end;
$$;

comment on function public.claim_chapter_audio_chunks(uuid, integer, integer[]) is
  'Replaces the chunk set for one chapter_audio row with p_count fresh pending rows. A claim always restarts at chunk 0.';

-- ---------------------------------------------------------------------------
-- RLS: exactly what `chapter_audio` allows, one join further out
-- ---------------------------------------------------------------------------

alter table public.chapter_audio_chunks enable row level security;

drop policy if exists "Users can read accessible chapter audio chunks"
  on public.chapter_audio_chunks;
create policy "Users can read accessible chapter audio chunks"
  on public.chapter_audio_chunks for select
  using (
    exists (
      select 1
      from public.chapter_audio ca
      join public.chapters c on c.id = ca.chapter_id
      join public.stories s on s.id = c.story_id
      where ca.id = chapter_audio_chunks.chapter_audio_id
        and (
          auth.uid() = s.author_id
          or (
            c.is_published = true
            and (s.is_public = true or s.is_curated = true)
          )
        )
    )
  );

revoke all on public.chapter_audio_chunks from anon, authenticated;
grant select on public.chapter_audio_chunks to authenticated;
grant all on public.chapter_audio_chunks to service_role;

-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default, so the
-- grant below is not what restricts this -- the revoke is. 00048's own comment
-- spells out what forgetting it costs: without the revoke any authenticated
-- caller could invoke a `security definer` function and, here, delete the
-- chunk set out from under a narration that is mid-flight, or pre-create rows
-- that steer `audio-status` into the reconciliation path for a row nothing
-- ever chunked.
revoke all on function public.claim_chapter_audio_chunks(uuid, integer, integer[]) from public;
grant execute on function public.claim_chapter_audio_chunks(uuid, integer, integer[]) to service_role;
