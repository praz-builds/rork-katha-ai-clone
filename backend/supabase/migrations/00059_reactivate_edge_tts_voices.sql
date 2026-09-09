-- Microsoft edge-tts narration now has a backend integration path.
--
-- `00053` kept these rows but hid them because `_shared/edge-tts.ts` was only
-- a placeholder. The provider now calls `EDGE_TTS_SERVICE_URL` and stores the
-- generated MP3 in the same permanent `chapter_audio` cache as other voices, so
-- the Spanish Microsoft voices can be offered again.
update public.voices
   set is_active = true
 where id in ('elvira', 'alvaro')
   and provider = 'edge_tts';

