/**
 * Dev-only test credits (App.tsx uses these via @/lib/dev-credits).
 *
 * `__DEV__` is a build-time global that cannot be flipped per test case, so
 * the decision is exported as a pure function parameterized on `isDev` --
 * this exercises the exact logic App.tsx calls, both branches, in one file.
 */
import { resolveBootstrappedCredits, resolveInitialCredits } from "@/lib/dev-credits";

describe("resolveInitialCredits", () => {
  it("starts a dev build at 100 credits regardless of Supabase config", () => {
    expect(resolveInitialCredits(true, true)).toBe(100);
    expect(resolveInitialCredits(true, false)).toBe(100);
  });

  it("does not grant test credits in a production build", () => {
    expect(resolveInitialCredits(false, true)).toBe(0);
    expect(resolveInitialCredits(false, false)).toBe(3);
  });
});

describe("resolveBootstrappedCredits", () => {
  it("keeps the dev override after bootstrapUser resolves, even at a real balance of 0", () => {
    expect(resolveBootstrappedCredits(true, 0)).toBe(100);
  });

  it("uses the real ledger balance in a production build", () => {
    expect(resolveBootstrappedCredits(false, 7)).toBe(7);
    expect(resolveBootstrappedCredits(false, 0)).toBe(0);
  });
});
