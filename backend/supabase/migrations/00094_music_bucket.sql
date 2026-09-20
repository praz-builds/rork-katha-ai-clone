-- Ambient reader music: a public, read-only bucket.
--
-- WHY THE TRACKS ARE NOT IN THE APP
-- The 24 licensed tracks are ~26 MB of HE-AAC. Bundling them put that on
-- every download, for a feature a given session may never hear, and made
-- adding a track an app-store release. They live here instead: the client
-- fetches a track the first time it plays and caches it on the device
-- (expo/src/lib/music-cache.ts), so the cost is paid once per track per
-- device and adding one is an upload.
--
-- WRITES ARE SERVICE-ROLE ONLY
-- Unlike `avatars`, nobody uploads music from the app -- the catalogue is
-- ours, and every track carries a commercial licence we hold. So there is no
-- insert/update/delete policy at all: the service role bypasses RLS and is
-- the only thing that can put an object here. A missing policy is the
-- strongest form of "no user writes", and it cannot be widened by accident
-- the way a policy with a predicate can.
--
-- Guarded, because `storage.buckets` is part of the Supabase platform schema
-- and is absent in the bare-Postgres test harness.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema absent; skipping music bucket (test harness)';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'music',
    'music',
    true,
    -- 10 MB. The whole catalogue at 64 kbps HE-AAC is well inside this; the
    -- limit exists so a mistakenly uploaded lossless master fails loudly
    -- here rather than quietly costing every reader their data.
    10485760,
    array['audio/mp4', 'audio/aac', 'audio/mpeg']
  )
  on conflict (id) do update
  set public = true,
      file_size_limit = 10485760,
      allowed_mime_types = array['audio/mp4', 'audio/aac', 'audio/mpeg'];

  execute $policy$
    drop policy if exists "Music is publicly readable" on storage.objects
  $policy$;
  execute $policy$
    create policy "Music is publicly readable"
      on storage.objects for select
      using (bucket_id = 'music')
  $policy$;
end $$;
