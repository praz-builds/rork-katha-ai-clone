/**
 * Dev-only test credits (App.tsx uses these via @/lib/dev-credits).
 *
 * `__DEV__` is a build-time global that cannot be flipped per test case, so
 * the decision is exported as a pure function parameterized on `isDev` --
 * this exercises the exact logic App.tsx calls, both branches, in one file.
 *
 * The override is only ever honest when there is no backend to disagree
 * with it: with `supabaseConfigured` true, a real ledger exists and
 * generation is checked against it, so the number on screen must be the
 * number the server will actually allow, in every one of these, even a dev
 * build.
 */
import { resolveBootstrappedCredits, resolveInitialCredits } from "@/lib/dev-credits";

describe("resolveInitialCredits", () => {
  it("starts a dev build at 100 credits only when there is no backend to disagree with it", () => {
    expect(resolveInitialCredits(true, false)).toBe(100);
  });

  it("shows the real (pre-bootstrap) starting balance in a dev build with a configured backend", () => {
    expect(resolveInitialCredits(true, true)).toBe(0);
  });

  it("does not grant test credits in a production build", () => {
    expect(resolveInitialCredits(false, true)).toBe(0);
    expect(resolveInitialCredits(false, false)).toBe(3);
  });
});

describe("resolveBootstrappedCredits", () => {
  it("keeps the dev override after bootstrapUser resolves when there is no backend to disagree with it", () => {
    expect(resolveBootstrappedCredits(true, false, 0)).toBe(100);
  });

  it("shows the real ledger balance in a dev build with a configured backend, even at 0", () => {
    // This is the number the flow will actually be allowed to spend -- a
    // real backend means a real "insufficient credits" refusal, so the
    // affordance on screen must match it rather than the dev override.
    expect(resolveBootstrappedCredits(true, true, 0)).toBe(0);
    expect(resolveBootstrappedCredits(true, true, 7)).toBe(7);
  });

  it("uses the real ledger balance in a production build", () => {
    expect(resolveBootstrappedCredits(false, true, 7)).toBe(7);
    expect(resolveBootstrappedCredits(false, true, 0)).toBe(0);
    expect(resolveBootstrappedCredits(false, false, 0)).toBe(0);
  });
});
