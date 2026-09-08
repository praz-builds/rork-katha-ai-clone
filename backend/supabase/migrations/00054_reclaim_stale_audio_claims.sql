-- A narration claim that is never resolved must not lock the chapter forever.
--
-- `claim_chapter_audio_generation` (00048) refuses a claim whenever a row for
-- the (chapter, voice) pair is already `pending`. That is exactly right while
-- a job is genuinely running: it is the guard that stops two readers pressing
-- Listen from starting two paid RunPod jobs on the same chapter.
--
-- But nothing ever cleared a `pending` row that no job was actually behind.
-- `generate-audio` claims the row, starts the provider job, then writes the
-- returned job id back. If that write fails, the handler cancels the job and
-- marks the row `failed` -- and if *that* write fails too (it is the same
-- database connection that just failed, so it very often would), the row stays
-- `pending` with a null `provider_job_id`. The isolate then returns 502 and
-- goes away. No one holds the job id, `audio-status` has nothing to poll, and
-- every later attempt to narrate that chapter in that voice is refused by the
-- claim above, permanently. The chapter becomes unnarratable and no amount of
-- retrying changes it.
--
-- The same shape occurs whenever the isolate simply dies between the claim and
-- the job start: a Deno worker eviction, a deploy, a timeout.
--
-- So `pending` gains an expiry. A row still counts as an in-flight job while it
-- is fresh; once it has sat untouched past the stale window it is treated the
-- way a `failed` row already is -- reset and re-claimable. This is the only
-- self-healing path that does not depend on a client polling, which is what the
-- stranded case is defined by: nobody is polling, because nobody was ever given
-- a job id.
--
-- Ten minutes matches `COVER_GENERATING_STALE_MS` and the narration staleness
-- window `audio-status` uses. Synthesising even the longest chapter is well
-- under a minute of real work, so ten minutes is generous by an order of
-- magnitude: a live job is never mistaken for a dead one.

create or replace function public.claim_chapter_audio_generation(
  p_chapter_id uuid,
  p_voice_id text,
  p_storage_path text,
  p_word_count integer
) returns table(
  audio_id uuid,
  status public.chapter_audio_status,
  storage_path text,
  provider_job_id text,
  claimed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audio public.chapter_audio;
  v_stale_after constant interval := interval '10 minutes';
begin
  if p_chapter_id is null or p_voice_id is null or p_storage_path is null then
    raise exception 'chapter_id, voice_id and storage_path are required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('chapter_audio:' || p_chapter_id::text || ':' || p_voice_id, 0)
  );

  select * into v_audio
  from public.chapter_audio ca
  where ca.chapter_id = p_chapter_id
    and ca.voice_id = p_voice_id
  for update;

  -- `ready` always wins: the audio exists, there is nothing to generate.
  if found and v_audio.status = 'ready' then
    return query select v_audio.id, v_audio.status, v_audio.storage_path,
      v_audio.provider_job_id, false;
    return;
  end if;

  -- A `pending` row blocks a new claim only while it is still plausibly live.
  -- `updated_at` is written by the claim itself and again when the job id is
  -- recorded, so it tracks the last moment anything was known to be happening.
  if found
     and v_audio.status = 'pending'
     and v_audio.updated_at > pg_catalog.now() - v_stale_after then
    return query select v_audio.id, v_audio.status, v_audio.storage_path,
      v_audio.provider_job_id, false;
    return;
  end if;

  if found then
    update public.chapter_audio
    set status = 'pending',
        storage_path = null,
        provider_job_id = null,
        word_count = p_word_count,
        generated_at = null,
        error_code = null,
        updated_at = pg_catalog.now()
    where id = v_audio.id
    returning * into v_audio;
  else
    insert into public.chapter_audio
      (chapter_id, voice_id, status, word_count)
    values (p_chapter_id, p_voice_id, 'pending', p_word_count)
    returning * into v_audio;
  end if;

  return query select v_audio.id, v_audio.status, p_storage_path, null::text,
    true;
end;
$$;

revoke all on function public.claim_chapter_audio_generation(uuid, text, text, integer) from public;
grant execute on function public.claim_chapter_audio_generation(uuid, text, text, integer) to service_role;
