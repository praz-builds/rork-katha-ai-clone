-- Migration 00061: point the MiniMax voices at names MiniMax actually has.
--
-- Every `runpod_minimax` row carried an OpenAI-style voice name -- `aria`,
-- `kai`, `onyx`, `nova`, `echo`, `fable` -- and MiniMax has never had a voice
-- called any of those. Combined with the request field being wrong (`text`
-- rather than `prompt`, fixed in `_shared/narration-audio.ts`), this meant no
-- narration had ever succeeded: the provider answered with a Python
-- traceback and the row went to `failed`.
--
-- The display names stay exactly as they are. A reader picked "Aria" and
-- should keep hearing "Aria"; only the provider-side identifier changes.
-- Mapping is by gender and register, keeping standard and premium distinct.

update public.voices set provider_voice_params = '{"voice_id": "Calm_Woman"}'::jsonb
  where id = 'aria' and provider = 'runpod_minimax';
update public.voices set provider_voice_params = '{"voice_id": "Casual_Guy"}'::jsonb
  where id = 'kai' and provider = 'runpod_minimax';
update public.voices set provider_voice_params = '{"voice_id": "Deep_Voice_Man"}'::jsonb
  where id = 'onyx' and provider = 'runpod_minimax';
update public.voices set provider_voice_params = '{"voice_id": "Wise_Woman"}'::jsonb
  where id = 'nova' and provider = 'runpod_minimax';
update public.voices set provider_voice_params = '{"voice_id": "Elegant_Man"}'::jsonb
  where id = 'echo' and provider = 'runpod_minimax';
update public.voices set provider_voice_params = '{"voice_id": "Friendly_Person"}'::jsonb
  where id = 'fable' and provider = 'runpod_minimax';
