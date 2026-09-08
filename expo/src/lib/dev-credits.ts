/**
 * Dev-only test credits (used by `App.tsx`).
 *
 * The product owner could not walk the Create flow at all with the real
 * starting balance (0 once Supabase is configured -- credits load from the
 * ledger only after `bootstrapUser` resolves). `isDev` is meant to be called
 * with `__DEV__`, which is false in every release or production build (the
 * same guard `devInitialTab` in `App.tsx` uses), so the 100-credit override
 * can never ship; it is also pure client display state, never a ledger
 * write, so it grants nothing real.
 *
 * The override only ever applies when `supabaseConfigured` is false. With no
 * backend there is no ledger to disagree with the number on screen -- 100
 * is exactly as real as the "nothing will be charged" it is standing in
 * for. With a real backend, generation is checked against the actual ledger,
 * so showing 100 there would be an affordance that lies: Create looks
 * enabled on a number the server was never going to honor, and generation
 * then fails with insufficient credits. A real backend's own number, even
 * when it is 0, is always the honest one to show.
 *
 * Both functions are pure and take `isDev` as a parameter rather than reading
 * the `__DEV__` global directly, purely so both branches are unit-testable in
 * the same test run -- `__DEV__` itself is a build-time constant that cannot
 * be flipped per test case. Remove both, and their two call sites in
 * `App.tsx`, before that guard is ever wrong.
 */

/** The boot-time balance, before `bootstrapUser` has resolved. */
export function resolveInitialCredits(isDev: boolean, supabaseConfigured: boolean): number {
  if (supabaseConfigured) return 0;
  return isDev ? 100 : 3;
}

/**
 * The balance after `bootstrapUser` resolves. Without this, the real (often
 * zero) ledger balance would land right after boot and erase
 * `resolveInitialCredits`'s override -- but only when there is no backend to
 * disagree with it; see the module note above.
 */
export function resolveBootstrappedCredits(
  isDev: boolean,
  supabaseConfigured: boolean,
  realBalance: number,
): number {
  if (supabaseConfigured) return realBalance;
  return isDev ? 100 : realBalance;
}
