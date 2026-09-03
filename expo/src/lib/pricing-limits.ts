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
