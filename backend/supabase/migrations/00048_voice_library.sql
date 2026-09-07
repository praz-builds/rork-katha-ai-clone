-- Voice library and lazy narration cache.
--
-- `chapters.audio_url` intentionally remains in place. Once all readers use
-- `chapter_audio`, a later migration can remove the legacy column separately.

do $$ begin
  create type public.voice_tier as enum ('standard', 'premium');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.chapter_audio_status as enum ('pending', 'ready', 'failed');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.voices (
  id text primary key,
  display_name text not null,
  language text not null,
  gender text not null check (gender in ('female', 'male', 'neutral')),
  tier public.voice_tier not null,
  provider text not null default 'runpod_minimax',
  provider_voice_params jsonb not null default '{}'::jsonb,
  preview_path text,
  sort_order integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (id ~ '^[a-z][a-z0-9_-]{1,31}$'),
  check (language ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  check (preview_path is null or preview_path !~ '^/')
);

comment on table public.voices is
  'Narration voice registry. Code keeps a static fallback, but this table is the canonical runtime catalogue.';
comment on column public.voices.provider_voice_params is
  'Opaque provider parameters passed to the configured speech backend.';
comment on column public.voices.preview_path is
  'Stable path in the public audio bucket for the reusable voice picker sample.';

insert into public.voices
  (id, display_name, language, gender, tier, provider, provider_voice_params, preview_path, sort_order, is_active)
values
  ('aria', 'Aria', 'en', 'female', 'standard', 'runpod_minimax', '{"voice_id":"aria"}', 'voice-previews/aria.mp3', 10, true),
  ('kai', 'Kai', 'en', 'male', 'standard', 'runpod_minimax', '{"voice_id":"kai"}', 'voice-previews/kai.mp3', 20, true),
  ('elvira', 'Elvira', 'es', 'female', 'standard', 'edge_tts', '{"voice":"es-ES-ElviraNeural"}', 'voice-previews/elvira.mp3', 30, true),
  ('alvaro', 'Alvaro', 'es', 'male', 'standard', 'edge_tts', '{"voice":"es-ES-AlvaroNeural"}', 'voice-previews/alvaro.mp3', 40, true),
  ('onyx', 'Onyx', 'en', 'male', 'premium', 'runpod_minimax', '{"voice_id":"onyx"}', 'voice-previews/onyx.mp3', 50, true),
  ('nova', 'Nova', 'en', 'female', 'premium', 'runpod_minimax', '{"voice_id":"nova"}', 'voice-previews/nova.mp3', 60, true),
  ('echo', 'Echo', 'en', 'male', 'premium', 'runpod_minimax', '{"voice_id":"echo"}', 'voice-previews/echo.mp3', 70, true),
  ('fable', 'Fable', 'en', 'neutral', 'premium', 'runpod_minimax', '{"voice_id":"fable"}', 'voice-previews/fable.mp3', 80, true)
on conflict (id) do update
set display_name = excluded.display_name,
    language = excluded.language,
    gender = excluded.gender,
    tier = excluded.tier,
    provider = excluded.provider,
    provider_voice_params = excluded.provider_voice_params,
    preview_path = excluded.preview_path,
    sort_order = excluded.sort_order,
    is_active = excluded.is_active,
    updated_at = now();

create index if not exists idx_voices_language_active
  on public.voices(language, is_active, sort_order);

create table if not exists public.chapter_audio (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  voice_id text not null references public.voices(id),
  storage_path text,
  duration_seconds numeric(10, 3),
  word_count integer,
  provider_job_id text,
  status public.chapter_audio_status not null default 'pending',
  generated_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chapter_id, voice_id),
  check (storage_path is null or storage_path <> ''),
  check (provider_job_id is null or provider_job_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  check (duration_seconds is null or duration_seconds >= 0),
  check (word_count is null or word_count >= 0),
  check ((status = 'ready') = (storage_path is not null and generated_at is not null))
);

comment on table public.chapter_audio is
  'Permanent per-chapter/per-voice narration cache and durable provider job binding.';
comment on column public.chapter_audio.storage_path is
  'Path in the public audio bucket. Legacy backfill may contain a pre-existing public URL when that is all the old row stored.';

create index if not exists idx_chapter_audio_chapter
  on public.chapter_audio(chapter_id);
create index if not exists idx_chapter_audio_provider_job
  on public.chapter_audio(provider_job_id)
  where provider_job_id is not null;
create index if not exists idx_chapter_audio_pending
  on public.chapter_audio(status, updated_at)
  where status = 'pending';

insert into public.chapter_audio
  (chapter_id, voice_id, storage_path, word_count, status, generated_at)
select c.id,
       'aria',
       c.audio_url,
       c.word_count,
       'ready'::public.chapter_audio_status,
       coalesce(c.created_at, now())
from public.chapters c
where c.audio_url is not null
  and btrim(c.audio_url) <> ''
on conflict (chapter_id, voice_id) do update
set storage_path = coalesce(public.chapter_audio.storage_path, excluded.storage_path),
    word_count = coalesce(public.chapter_audio.word_count, excluded.word_count),
    status = 'ready'::public.chapter_audio_status,
    generated_at = coalesce(public.chapter_audio.generated_at, excluded.generated_at),
    updated_at = now();

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

  if found and v_audio.status in ('ready', 'pending') then
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
        updated_at = now()
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

alter table public.voices enable row level security;
alter table public.chapter_audio enable row level security;

drop policy if exists "Authenticated users can read active voices" on public.voices;
create policy "Authenticated users can read active voices"
  on public.voices for select
  using (auth.role() = 'authenticated' and is_active = true);

drop policy if exists "Users can read accessible chapter audio" on public.chapter_audio;
create policy "Users can read accessible chapter audio"
  on public.chapter_audio for select
  using (
    exists (
      select 1
      from public.chapters c
      join public.stories s on s.id = c.story_id
      where c.id = chapter_audio.chapter_id
        and (
          auth.uid() = s.author_id
          or (
            c.is_published = true
            and (s.is_public = true or s.is_curated = true)
          )
        )
    )
  );

revoke all on public.voices from anon, authenticated;
revoke all on public.chapter_audio from anon, authenticated;
grant select on public.voices to authenticated;
grant select on public.chapter_audio to authenticated;
grant all on public.voices to service_role;
grant all on public.chapter_audio to service_role;
grant execute on function public.claim_chapter_audio_generation(uuid, text, text, integer) to service_role;
