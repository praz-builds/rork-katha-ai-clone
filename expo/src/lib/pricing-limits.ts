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
