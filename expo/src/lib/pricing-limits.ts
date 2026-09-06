/**
 * Limits shared between the create flow and the backend contract.
 *
 * `MAX_CAST_SIZE` mirrors the constant of the same name in
 * `backend/supabase/functions/_shared/types.ts`, which `validation.ts` enforces.
 * Before these agreed, the client allowed 5, the server allowed 10 and the spec
 * said 3, so a user could assemble a cast the server would reject.
 *
 * Canonical: `source-of-truth/STORY_GENERATION_FLOW.md` §4.
 */
export const MAX_CAST_SIZE = 3;

/**
 * The cap on the reader's "What happens next?" direction, in characters.
 *
 * `continue-story/index.ts` trims the incoming `next_instruction` and rejects
 * anything longer than this with a 400. Without the same number on the client
 * the only feedback for an over-long direction is a failed continuation after
 * the reader has already committed to it, so the input enforces the cap with
 * `maxLength` instead and the request can never be the thing that says no.
 *
 * Canonical: `source-of-truth/STORY_GENERATION_FLOW.md` §10.2.
 */
export const MAX_NEXT_INSTRUCTION_CHARS = 300;

/**
 * The cap on the writer's optional cover note, in characters.
 *
 * Mirrors `MAX_COVER_NOTE_LENGTH` in
 * `backend/supabase/functions/_shared/cover-regeneration.ts`, which is itself
 * `MAX_BRIEF_FIELD_LENGTH` — the cover note is a brief field, and a brief field
 * that the client allowed to run longer than the server accepts would fail the
 * request only after the writer had committed to a paid regeneration.
 *
 * Canonical: `source-of-truth/STORY_GENERATION_FLOW.md` §10.4.
 */
export const MAX_COVER_NOTE_CHARS = 300;

/**
 * How the studio watches for chapter 1's art.
 *
 * The cover is generated on a background task after the generation response is
 * flushed (`backend/.../_shared/media.ts`), so there is no push and no second
 * response to carry it. The studio reads `regenerate-cover` on an interval
 * until the status leaves `generating`.
 *
 * Bounded on purpose, and bounded at roughly the same place the server gives up
 * on its own claim: `COVER_GENERATING_STALE_MS` is 10 minutes, past which a row
 * still reading `generating` is assumed dead. A client that polled past that
 * would be waiting on work nothing is doing — the exact dishonesty §10.4 is
 * about — so it stops and the concept card stands.
 */
export const COVER_POLL_INTERVAL_MS = 6_000;
export const COVER_POLL_MAX_ATTEMPTS = 40;
