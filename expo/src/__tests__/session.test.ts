const mockGetSession = jest.fn();
const mockSignInAnonymously = jest.fn();
const mockSignOut = jest.fn();
const mockInvoke = jest.fn();
const mockVerifyOtp = jest.fn();
const mockSignInWithOtp = jest.fn();

/**
 * Read through a getter, not a constant: `isSupabaseConfigured` is the only
 * thing standing between the onboarding pass-through and a real credential
 * check, so the suite has to be able to flip it and assert both sides.
 */
let mockConfigured = true;

jest.mock("@/lib/analytics", () => ({ captureError: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  get isSupabaseConfigured() {
    return mockConfigured;
  },
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      signInAnonymously: (...args: unknown[]) => mockSignInAnonymously(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      signInWithOtp: (...args: unknown[]) => mockSignInWithOtp(...args),
      verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
    },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

function bootstrapResponse() {
  return {
    data: {
      user_id: "guest-1",
      balance: 3,
      is_anonymous: true,
      welcome_granted: true,
      rate_limited: false,
    },
    error: null,
  };
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockSignInAnonymously.mockReset();
  mockSignOut.mockReset().mockResolvedValue({ error: null });
  mockInvoke.mockReset();
  mockVerifyOtp.mockReset();
  mockSignInWithOtp.mockReset();
  mockConfigured = true;
});

function loadSession(): typeof import("@/lib/session") {
  let mod!: typeof import("@/lib/session");
  jest.isolateModules(() => {
    mod = require("@/lib/session"); // eslint-disable-line @typescript-eslint/no-require-imports
  });
  return mod;
}

describe("bootstrapUser", () => {
  it("uses the persisted session and returns the server balance", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "persisted-token" } },
      error: null,
    });
    mockInvoke.mockResolvedValue(bootstrapResponse());

    let bootstrapUser: typeof import("@/lib/session").bootstrapUser;
    jest.isolateModules(() => {
      ({ bootstrapUser } = require("@/lib/session")); // eslint-disable-line @typescript-eslint/no-require-imports
    });
    const result = await bootstrapUser!();

    expect(mockSignInAnonymously).not.toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith("bootstrap-user", {
      body: {},
      headers: { Authorization: "Bearer persisted-token" },
    });
    expect(result).toMatchObject({ balance: 3, isAnonymous: true });
  });

  it("creates an anonymous session when none is persisted", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    mockSignInAnonymously.mockResolvedValue({
      data: { session: { access_token: "new-token" } },
      error: null,
    });
    mockInvoke.mockResolvedValue(bootstrapResponse());

    let bootstrapUser: typeof import("@/lib/session").bootstrapUser;
    jest.isolateModules(() => {
      ({ bootstrapUser } = require("@/lib/session")); // eslint-disable-line @typescript-eslint/no-require-imports
    });
    await bootstrapUser!();

    expect(mockSignInAnonymously).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer new-token",
    );
  });

  it("shares simultaneous bootstrap requests", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "persisted-token" } },
      error: null,
    });
    mockInvoke.mockResolvedValue(bootstrapResponse());

    let bootstrapUser: typeof import("@/lib/session").bootstrapUser;
    jest.isolateModules(() => {
      ({ bootstrapUser } = require("@/lib/session")); // eslint-disable-line @typescript-eslint/no-require-imports
    });
    await Promise.all([bootstrapUser!(), bootstrapUser!()]);

    expect(mockGetSession).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});

/**
 * The kept answer. Every profile, calendar and ledger call starts with
 * `bootstrapUser()`, and each used to cost a full edge round trip before the
 * call it was guarding could even start.
 */
describe("bootstrapUser keeps its answer for the session", () => {
  function persisted(token: string) {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: token } },
      error: null,
    });
  }

  it("asks the server once, then answers from memory for the same session", async () => {
    persisted("persisted-token");
    mockInvoke.mockResolvedValue(bootstrapResponse());
    const { bootstrapUser } = loadSession();

    const first = await bootstrapUser();
    const second = await bootstrapUser();
    const third = await bootstrapUser();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("asks again when the session changes underneath it", async () => {
    persisted("guest-token");
    mockInvoke.mockResolvedValue(bootstrapResponse());
    const { bootstrapUser } = loadSession();
    await bootstrapUser();

    // Sign-in, a converted guest, a refreshed token: a different session.
    persisted("named-token");
    mockInvoke.mockResolvedValue({
      data: { ...bootstrapResponse().data, is_anonymous: false, balance: 9 },
      error: null,
    });
    const after = await bootstrapUser();

    expect(mockInvoke).toHaveBeenCalledTimes(2);
    expect(mockInvoke.mock.calls[1][1].headers.Authorization).toBe(
      "Bearer named-token",
    );
    expect(after).toMatchObject({ isAnonymous: false, balance: 9 });
  });

  it("asks again when a caller needs the balance as it is now", async () => {
    persisted("persisted-token");
    mockInvoke.mockResolvedValue(bootstrapResponse());
    const { bootstrapUser, invalidateBootstrap } = loadSession();
    await bootstrapUser();

    mockInvoke.mockResolvedValue({
      data: { ...bootstrapResponse().data, balance: 13 },
      error: null,
    });
    await expect(bootstrapUser({ fresh: true })).resolves.toMatchObject({ balance: 13 });
    expect(mockInvoke).toHaveBeenCalledTimes(2);

    // And the fresh answer is what is kept.
    await expect(bootstrapUser()).resolves.toMatchObject({ balance: 13 });
    expect(mockInvoke).toHaveBeenCalledTimes(2);

    invalidateBootstrap();
    await bootstrapUser();
    expect(mockInvoke).toHaveBeenCalledTimes(3);
  });

  it("does not let a request from before an invalidation become the kept answer", async () => {
    persisted("persisted-token");
    let answerOld!: (value: unknown) => void;
    mockInvoke.mockReturnValueOnce(
      new Promise((resolve) => {
        answerOld = resolve;
      }),
    );
    const { bootstrapUser } = loadSession();
    const stale = bootstrapUser();
    // Let the in-flight request reach the network before credits move.
    await new Promise((resolve) => setTimeout(resolve, 0));

    mockInvoke.mockResolvedValueOnce({
      data: { ...bootstrapResponse().data, balance: 20 },
      error: null,
    });
    const fresh = await bootstrapUser({ fresh: true });
    answerOld(bootstrapResponse());
    await stale;

    expect(fresh).toMatchObject({ balance: 20 });
    // The old answer landed last, and must not have replaced the fresh one.
    await expect(bootstrapUser()).resolves.toMatchObject({ balance: 20 });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("forgets the answer on sign-out", async () => {
    persisted("persisted-token");
    mockInvoke.mockResolvedValue(bootstrapResponse());
    const { bootstrapUser, signOutToSignIn } = loadSession();
    await bootstrapUser();

    await signOutToSignIn();
    await bootstrapUser();

    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});

describe("verifyEmailCode", () => {
  it("lets any six digits through while Supabase is unconfigured", async () => {
    // SCAFFOLD: AUTH_NOT_WIRED. With no credentials in the bundle there is no
    // service to ask, so the onboarding flow can be walked end to end. This is
    // reachable only in that unconfigured state.
    mockConfigured = false;
    const { verifyEmailCode } = loadSession();

    await expect(verifyEmailCode("writer@example.com", "000000"))
      .resolves.toBeUndefined();
    await expect(verifyEmailCode("writer@example.com", "123456"))
      .resolves.toBeUndefined();
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it("sends nothing while Supabase is unconfigured", async () => {
    mockConfigured = false;
    const { sendEmailCode } = loadSession();

    await expect(sendEmailCode("writer@example.com")).resolves.toBeUndefined();
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it("still asks Supabase to verify the code once it is configured", async () => {
    mockVerifyOtp.mockResolvedValue({ data: {}, error: null });
    const { verifyEmailCode } = loadSession();

    await verifyEmailCode("  writer@example.com  ", " 123456 ");

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: "writer@example.com",
      token: "123456",
      type: "email",
    });
  });

  it("lets any six digits through in the local dev environment", async () => {
    // SCAFFOLD: AUTH_NOT_WIRED. The credentials in expo/.env are real, so the
    // unconfigured branch above is unreachable in this environment. APP_ENV is
    // what actually opens the flow up for review, and this asserts it does.
    const previous = process.env.EXPO_PUBLIC_APP_ENV;
    process.env.EXPO_PUBLIC_APP_ENV = "local";
    try {
      const { verifyEmailCode, sendEmailCode } = loadSession();

      await expect(verifyEmailCode("writer@example.com", "000000"))
        .resolves.toBeUndefined();
      await expect(sendEmailCode("writer@example.com")).resolves.toBeUndefined();
      expect(mockVerifyOtp).not.toHaveBeenCalled();
      expect(mockSignInWithOtp).not.toHaveBeenCalled();
    } finally {
      process.env.EXPO_PUBLIC_APP_ENV = previous;
    }
  });

  it("does not bypass outside the local environment", async () => {
    // The other half of the gate. If this ever passes with APP_ENV unset or
    // set to production, the scaffold has become a real auth hole.
    const previous = process.env.EXPO_PUBLIC_APP_ENV;
    process.env.EXPO_PUBLIC_APP_ENV = "production";
    try {
      mockVerifyOtp.mockResolvedValue({
        data: null,
        error: new Error("Token has expired or is invalid"),
      });
      const { verifyEmailCode } = loadSession();

      await expect(verifyEmailCode("writer@example.com", "000000"))
        .rejects.toThrow("Token has expired or is invalid");
      expect(mockVerifyOtp).toHaveBeenCalled();
    } finally {
      process.env.EXPO_PUBLIC_APP_ENV = previous;
    }
  });

  it("still rejects a wrong code once it is configured", async () => {
    // The assertion that keeps the pass-through from becoming an auth hole:
    // with credentials present, a code Supabase rejects must fail here too.
    mockVerifyOtp.mockResolvedValue({
      data: null,
      error: new Error("Token has expired or is invalid"),
    });
    const { verifyEmailCode } = loadSession();

    await expect(verifyEmailCode("writer@example.com", "000000"))
      .rejects.toThrow("Token has expired or is invalid");
  });
});

/**
 * A stored session the server refuses is a permanent zero, not a bad request.
 *
 * Observed on 2026-09-08: a guest identity sat in local storage whose token
 * `bootstrap-user` answered 401 to. `bootstrapUser` threw, `App.tsx` left
 * credits at 0, nothing was shown, and every reload restored the same dead
 * session and repeated it. The user could not create a story and had no way
 * out short of clearing site data. Worse, the function's 401 returns before
 * `logError`, so there was no server-side trace either -- the only evidence
 * was an auth user with no `profiles` row.
 */
describe("recovering from a session the server will not accept", () => {
  // Matches the pattern the rest of this file uses: the module is loaded
  // inside the suite so each case sees the mocks as configured for it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { bootstrapUser } = require("@/lib/session");

  function dead(status: number) {
    return { data: null, error: { context: { status } } };
  }

  it("starts a fresh guest when bootstrap rejects the stored session", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "stale-token" } },
      error: null,
    });
    mockSignInAnonymously.mockResolvedValue({
      data: { session: { access_token: "fresh-token" } },
      error: null,
    });
    mockInvoke
      .mockResolvedValueOnce(dead(401))
      .mockResolvedValueOnce(bootstrapResponse());

    const user = await bootstrapUser();

    expect(user).toMatchObject({ balance: 3, isAnonymous: true });
    // The dead session is cleared locally. Revoking server-side would need the
    // very token being refused, so asking for it would fail and take the
    // recovery down with it.
    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mockInvoke.mock.calls[1][1].headers.Authorization).toBe(
      "Bearer fresh-token",
    );
  });

  it("does the same for a 403", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "stale-token" } },
      error: null,
    });
    mockSignInAnonymously.mockResolvedValue({
      data: { session: { access_token: "fresh-token" } },
      error: null,
    });
    mockInvoke
      .mockResolvedValueOnce(dead(403))
      .mockResolvedValueOnce(bootstrapResponse());

    await expect(bootstrapUser()).resolves.toMatchObject({ balance: 3 });
  });

  it("keeps the session when the failure is not about identity", async () => {
    // A 500, a timeout or an offline device all mean "this same session, later".
    // Burning the identity there would throw away any credits attached to it
    // because the network blipped.
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "good-token" } },
      error: null,
    });
    mockInvoke.mockResolvedValue(dead(500));

    await expect(bootstrapUser()).rejects.toBeDefined();
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockSignInAnonymously).not.toHaveBeenCalled();
  });

  it("does not retry forever: a fresh session that is also refused fails", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "stale-token" } },
      error: null,
    });
    mockSignInAnonymously.mockResolvedValue({
      data: { session: { access_token: "fresh-token" } },
      error: null,
    });
    mockInvoke.mockResolvedValue(dead(401));

    await expect(bootstrapUser()).rejects.toBeDefined();
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});
