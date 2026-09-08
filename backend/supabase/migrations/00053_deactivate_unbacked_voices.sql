-- A voice nobody can use should not be offered.
--
-- `00048` seeded the registry with eight voices, two of which -- elvira and
-- alvaro, the Spanish pair -- are served by the `edge_tts` provider. That
-- provider is not implemented: `_shared/edge-tts.ts` returns null
-- unconditionally, so `generate-audio` answers a typed
-- `edge_tts_not_implemented` for either of them.
--
-- They were seeded `is_active = true`, so the voice picker offers them, a
-- reader chooses one, and narration fails for a reason that is nothing to do
-- with them and that they cannot act on. An unavailable voice is worse than a
-- shorter list.
--
-- Deactivated rather than deleted. The rows carry the provider parameters that
-- an edge_tts implementation will need, `chapter_audio` may already reference
-- them, and reactivating is one UPDATE the day the provider works. Deleting a
-- registry row to express "not yet" throws away the configuration and the
-- history with it.
update public.voices
   set is_active = false
 where id in ('elvira', 'alvaro')
   and provider = 'edge_tts';

comment on column public.voices.is_active is
  'Whether the voice is offered to readers. False means the row is kept for its provider configuration but the picker must not show it -- either an administrator disabled it, or its provider is not implemented yet (see 00053, which deactivates the edge_tts pair). listVoices() filters on this and, since the fix to the registry fallback, believes an empty answer rather than resurrecting the static list.';
