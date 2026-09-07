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

/**
 * What one more chapter of text costs.
 *
 * This is `CREDITS_AND_PRICING.md`'s create-table line "Write a chapter — 1
 * each", and it lives here rather than as a literal in the studio because
 * "Write the rest" is the first surface that has to *quote a total before
 * spending anything*. Every other paid button in the flow prices one action, so
 * a literal `1` next to it is self-evidently right; a run multiplies the number
 * by up to fourteen chapters, and a wrong literal there misquotes the writer by
 * an order of magnitude at the exact moment they are deciding whether to
 * commit.
 *
 * The table's neighbouring line — "Art for any other chapter — optional, off by
 * default — 1 each" — has no constant here on purpose. Nothing in the codebase
 * charges for per-chapter art: `chapter_art` is only an enum value on
 * `generation_operations.kind`, no caller reserves it, and `continue-story`
 * never reads `illustrate_chapters`. A constant nothing reads is an invitation
 * to quote a price nothing collects, which is how the run sheet came to refuse
 * chapters the balance could afford. It comes back when the feature does.
 *
 * Canonical: `source-of-truth/CREDITS_AND_PRICING.md` §"Creating".
 */
export const CHAPTER_TEXT_CREDITS = 1;

/**
 * The chapter from which "Write the rest" is offered.
 *
 * §10.2: "**Write the rest** appears from chapter 3 onward". The rule is about
 * consent, not about pacing — by chapter 3 the writer has read two chapters
 * this model produced and paid for them one at a time, so they know what they
 * are buying fourteen of. Offering it at chapter 1 would ask somebody to commit
 * a whole balance to prose they have not seen a line of.
 */
export const WRITE_THE_REST_MIN_CHAPTERS = 3;
