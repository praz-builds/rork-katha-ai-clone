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
 * The cap on one beat of the chapter plan, in characters.
 *
 * Mirrors `MAX_BEAT_LENGTH` in
 * `backend/supabase/functions/_shared/types.ts`, which `validation.ts`
 * enforces on every entry of `beats`.
 *
 * It is NOT the same number as `MAX_NEXT_INSTRUCTION_CHARS`, and the difference
 * is a real one that cost a real bug: the opening direction the writer types in
 * the create flow becomes `beats[0]`, not `next_instruction`, so the composer
 * shared with the chapter end was letting them type 300 characters into a field
 * bounded at 200. The tail went missing on the server with the input and the
 * counter both saying it fit.
 */
export const MAX_BEAT_LENGTH = 200;

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
 * Canonical: `source-of-truth/CREDITS_AND_PRICING.md` §"Creating".
 */
export const CHAPTER_TEXT_CREDITS = 1;

/**
 * What illustrating one chapter adds on top of its text.
 *
 * `CREDITS_AND_PRICING.md` §"Creating": "Art for any other chapter — optional,
 * off by default — 1 each". Chapter one's art is not priced by this line: it is
 * the story's cover and is already inside `STORY_START_CREDITS`.
 *
 * THIS IS NOW A CHARGE, NOT A QUOTE. When this constant was introduced the
 * comment here said the opposite, and correctly: nothing reserved against
 * chapter art, and `continue-story` never read `illustrate_chapters`. Migration
 * 00077 changed that. `reserve_generation_operation` now takes
 * `p_illustrate_chapter` and settles both credits in one transaction, taking
 * the flag from `stories.illustrate_chapters` rather than from the caller — so
 * a request can lower the price and never raise it.
 *
 * Everything that quotes a per-chapter total must therefore add this whenever
 * the story illustrates its chapters. Quoting the text credit alone is now
 * quoting a price the reader is not charged, which is the failure this note
 * exists to prevent.
 */
export const CHAPTER_ART_CREDITS = 1;

/**
 * What starting a story costs: its characters, chapter one and its cover.
 *
 * The number was a literal in four places (the studio's guard, its alert, the
 * brief's cost card and its warning). It is the one price a first-time writer
 * is shown before they have spent anything, so it is named once here and the
 * generation session charges exactly this on completion.
 */
export const STORY_START_CREDITS = 3;

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
