-- Migration 00063: the grants three features have been failing on, and a
-- voice pair that is offered to readers and cannot work.
--
-- Both halves were found by probing production on 2026-09-10, not by reading.
-- Both had been broken since the day they shipped, and both were invisible
-- because something downstream degraded quietly instead of failing loudly.
--
-- 1. `service_role` table grants
--
-- 00012 recorded the rule and the reason: "RLS policies filter rows; they do
-- not grant table privileges... the project has no blanket default
-- privileges", so it issued a one-time `GRANT ALL ON ALL TABLES` and every
-- table created afterwards needs its own grant. 00042 restated it. Three
-- tables created since then are read with the service client and were never
-- granted, so each read returns 42501 "permission denied":
--
--   * `user_blocks` (00043) -- read by `feed` before any feed is built. The
--     read throws, the handler catches it, and EVERY request from EVERY user
--     has returned `500 Internal server error` since 00043 was applied. It
--     went unnoticed because the client falls back to bundled content on a
--     failed fetch, so the home screen still looked populated, and because
--     the handler had no telemetry (fixed in the same change as this file).
--
--   * `user_characters` (00057) -- read by `resolveSavedCharacters` on both
--     generation paths, where the error is caught and the id dropped, so a
--     writer who picks a saved character silently gets a blank one; and read
--     by `reimagine-chapter`, where it throws and the request 500s.
--
--   * `revenuecat_subscriptions` (00026) -- read by
--     `refresh-subscription-grants`, so the annual-plan credit refresh would
--     fail on its first run. It has never run (nothing schedules it yet), so
--     this one is a defect that has not had the chance to cost anything.
--
-- SELECT only, and only these three: everything else revoked in 00043, 00051,
-- 00055 and 00056 is reached exclusively through SECURITY DEFINER functions,
-- which execute as the owner and need no grant. Widening those would give up
-- least privilege to fix a problem they do not have.
--
-- `feed` has additionally been changed to read `user_blocks` through the
-- caller's own JWT, where RLS scopes the read to the caller. This grant is
-- not what makes that call correct; it is what stops the next service-side
-- reader of these tables from rediscovering 42501 the hard way.

grant select on table public.user_blocks to service_role;
grant select on table public.user_characters to service_role;
grant select on table public.revenuecat_subscriptions to service_role;

-- 2. The edge_tts voices, deactivated again
--
-- 00053 hid `elvira` and `alvaro` because their provider was a stub, and said
-- why in a sentence this migration is only repeating: "An unavailable voice is
-- worse than a shorter list."
--
-- 00059 reactivated them on the strength of `_shared/edge-tts.ts` calling an
-- `EDGE_TTS_SERVICE_URL` worker. That worker was never deployed and the
-- secret is not set, so from 00059 until now the picker has offered both
-- Spanish voices, `ListenScreen` has defaulted every `language = 'es'` story
-- to Elvira, and every tap has failed with `edge_tts_service_missing` and
-- filed a `critical` error event. Microsoft's endpoint 403s a direct Deno
-- connection (it requires Origin and User-Agent headers a Deno WebSocket
-- cannot set), which is why the worker exists as a design and not as a URL.
--
-- Deactivated, not deleted, for exactly 00053's reasons: the rows carry the
-- provider parameters a real implementation will need.
--
-- This flag is no longer the only thing standing between a reader and a voice
-- that cannot speak. `_shared/voices.ts` now asks the running deployment
-- whether a provider is configured at all, and filters on the answer in both
-- `listVoices` and `getVoiceRecord`. That check is what makes this the last
-- flip: an operator setting `is_active = true` again cannot re-break Spanish
-- narration while the worker is missing, and the voices return on their own
-- the moment `EDGE_TTS_SERVICE_URL` is set -- no migration, no deploy.

update public.voices
   set is_active = false,
       updated_at = now()
 where id in ('elvira', 'alvaro')
   and provider = 'edge_tts';
