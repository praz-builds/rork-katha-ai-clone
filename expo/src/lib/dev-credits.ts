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
 * Both functions are pure and take `isDev` as a parameter rather than reading
 * the `__DEV__` global directly, purely so both branches are unit-testable in
 * the same test run -- `__DEV__` itself is a build-time constant that cannot
 * be flipped per test case. Remove both, and their two call sites in
 * `App.tsx`, before that guard is ever wrong.
 */

/** The boot-time balance, before `bootstrapUser` has resolved. */
export function resolveInitialCredits(isDev: boolean, supabaseConfigured: boolean): number {
  return isDev ? 100 : supabaseConfigured ? 0 : 3;
}

/**
 * The balance after `bootstrapUser` resolves. Without this, the real (often
 * zero) ledger balance would land right after boot and erase
 * `resolveInitialCredits`'s override.
 */
export function resolveBootstrappedCredits(isDev: boolean, realBalance: number): number {
  return isDev ? 100 : realBalance;
}
