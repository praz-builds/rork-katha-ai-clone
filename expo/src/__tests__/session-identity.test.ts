/**
 * Does the identity survive sign-in?
 *
 * Character onboarding makes its aha on the anonymous session -- the portrait
 * is generated, the `user_characters` row is written against the ANONYMOUS
 * `profiles(id)` -- and asks for an email afterwards. So the one question this
 * file exists to answer is whether verifying the code keeps `auth.users.id`.
 *
 * It did not. `signInWithOtp` + `verifyOtp({ type: "email" })` is Supabase's
 * create-or-sign-into-an-account pair; the character was left on an identity
 * the caller no longer owned, `user_characters` is owner-only under RLS, and
 * the library came back EMPTY with nothing reporting an error. The guest's
 * three credits stayed behind too.
 *
 * `updateUser({ email })` then `verifyOtp({ type: "email_change" })` is the
 * in-place pair. These tests assert the exact auth calls, because the bug is
 * invisible from the outside: both spellings return a signed-in user.
 */

const mockGetSession = jest.fn();
const mockSignInAnonymously = jest.fn();
const mockSignOut = jest.fn();
const mockInvoke = jest.fn();
const mockVerifyOtp = jest.fn();
const mockSignInWithOtp = jest.fn();
const mockUpdateUser = jest.fn();

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      signInAnonymously: (...args: unknown[]) => mockSignInAnonymously(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
      signInWithOtp: (...args: unknown[]) => mockSignInWithOtp(...args),
      verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
      updateUser: (...args: unknown[]) => mockUpdateUser(...args),
    },
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));
jest.mock("@/lib/analytics", () => ({ captureError: jest.fn() }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

const GUEST_ID = "guest-1";

/** The stored session as it looks during onboarding: a signed-in guest. */
function guestSession() {
  return {
    data: {
      session: {
        access_token: "guest-token",
        user: { id: GUEST_ID, is_anonymous: true },
      },
    },
    error: null,
  };
}

function namedSession() {
  return {
    data: {
      session: {
        access_token: "named-token",
        user: { id: "named-1", is_anonymous: false },
      },
    },
    error: null,
  };
}

function loadSession(): typeof import("@/lib/session") {
  let mod!: typeof import("@/lib/session");
  jest.isolateModules(() => {
    mod = require("@/lib/session"); // eslint-disable-line @typescript-eslint/no-require-imports
  });
  return mod;
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockSignInAnonymously.mockReset();
  mockSignOut.mockReset().mockResolvedValue({ error: null });
  mockInvoke.mockReset().mockResolvedValue({
    data: {
      user_id: "named-1",
      balance: 3,
      is_anonymous: false,
      claimed_characters: 1,
    },
    error: null,
  });
  mockVerifyOtp.mockReset().mockResolvedValue({ data: {}, error: null });
  mockSignInWithOtp.mockReset().mockResolvedValue({ data: {}, error: null });
  mockUpdateUser.mockReset();
  // The scaffold bypass must not swallow these: it returns before any auth
  // call and every assertion here is about which call was made.
  process.env.EXPO_PUBLIC_APP_ENV = "production";
});

describe("converting the guest in place", () => {
  it("puts the address on the anonymous user rather than making a second one", async () => {
    mockGetSession.mockResolvedValue(guestSession());
    mockUpdateUser.mockResolvedValue({
      data: { user: { id: GUEST_ID, new_email: "writer@example.com" } },
      error: null,
    });
    const { sendEmailCode } = loadSession();

    await sendEmailCode("  writer@example.com  ");

    expect(mockUpdateUser).toHaveBeenCalledWith({ email: "writer@example.com" });
    // The call that would have created a second account, and orphaned the
    // character onto the anonymous profile.
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it("verifies the code as an email change, keeping auth.users.id", async () => {
    mockGetSession.mockResolvedValue(guestSession());
    mockUpdateUser.mockResolvedValue({
      data: { user: { id: GUEST_ID, new_email: "writer@example.com" } },
      error: null,
    });
    const { sendEmailCode, verifyEmailCode } = loadSession();

    await sendEmailCode("writer@example.com");
    await verifyEmailCode("writer@example.com", " 123456 ");

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: "writer@example.com",
      token: "123456",
      type: "email_change",
    });
    // Nothing to claim: the row's owner_id never stopped being this user's.
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does not ask for a code the project never sent", async () => {
    // A project with email-change confirmation off applies the address on the
    // spot and mails nothing. Asking Supabase to verify a code that does not
    // exist would fail a screen whose work is already done.
    mockGetSession.mockResolvedValue(guestSession());
    mockUpdateUser.mockResolvedValue({
      data: { user: { id: GUEST_ID, email: "writer@example.com" } },
      error: null,
    });
    const { sendEmailCode, verifyEmailCode } = loadSession();

    await sendEmailCode("writer@example.com");
    await verifyEmailCode("writer@example.com", "123456");

    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it("surfaces a failure that is not about the address being taken", async () => {
    mockGetSession.mockResolvedValue(guestSession());
    mockUpdateUser.mockResolvedValue({
      data: null,
      error: { message: "Network request failed" },
    });
    const { sendEmailCode } = loadSession();

    // Falling through here would silently strand the character on a blip.
    await expect(sendEmailCode("writer@example.com")).rejects.toBeDefined();
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });
});

describe("the address already belongs to an account", () => {
  beforeEach(() => {
    mockUpdateUser.mockResolvedValue({
      data: null,
      error: { code: "email_exists", message: "email_exists" },
    });
  });

  it("signs into that account and claims the guest's characters", async () => {
    mockGetSession
      .mockResolvedValueOnce(guestSession()) // sendEmailCode
      .mockResolvedValue(namedSession()); // after verifyOtp swapped the session
    const { sendEmailCode, verifyEmailCode } = loadSession();

    await sendEmailCode("writer@example.com");
    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      email: "writer@example.com",
      options: { shouldCreateUser: true },
    });

    await verifyEmailCode("writer@example.com", "123456");

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: "writer@example.com",
      token: "123456",
      type: "email",
    });
    // The anonymous token is the proof, and the server verifies it. Without
    // this the character is invisible on an identity nobody can sign into.
    expect(mockInvoke).toHaveBeenCalledWith("bootstrap-user", {
      body: { claim_guest_token: "guest-token" },
      headers: { Authorization: "Bearer named-token" },
    });
  });

  it("does not fail sign-in when the claim fails", async () => {
    mockGetSession
      .mockResolvedValueOnce(guestSession())
      .mockResolvedValue(namedSession());
    mockInvoke.mockResolvedValue({ data: null, error: { context: { status: 500 } } });
    const { sendEmailCode, verifyEmailCode } = loadSession();

    await sendEmailCode("writer@example.com");
    // The email is verified. Refusing the last screen of onboarding over a
    // character costs the user more than the character does.
    await expect(verifyEmailCode("writer@example.com", "123456"))
      .resolves.toBeUndefined();
  });
});

describe("a session that was never a guest", () => {
  it("keeps the plain sign-in pair and claims nothing", async () => {
    mockGetSession.mockResolvedValue(namedSession());
    const { sendEmailCode, verifyEmailCode } = loadSession();

    await sendEmailCode("writer@example.com");
    await verifyEmailCode("writer@example.com", "123456");

    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: "writer@example.com",
      token: "123456",
      type: "email",
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("verifies as a change when the guest session is still stored but nothing was sent here", async () => {
    // A reload between the email screen and the code screen loses the module
    // state. Re-deriving from the live session is what stops that from
    // silently reverting to the account-creating spelling.
    mockGetSession.mockResolvedValue(guestSession());
    const { verifyEmailCode } = loadSession();

    await verifyEmailCode("writer@example.com", "123456");

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: "writer@example.com",
      token: "123456",
      type: "email_change",
    });
  });
});

describe("two sends in one sitting", () => {
  it("verifies each address against its own send", async () => {
    // One slot of module state meant the second send overwrote the first
    // send's mode AND its guest token. A user who mistypes, sends, corrects
    // and then goes back to the first code had it verified against the second
    // address's decision -- and the guest token is the proof the character
    // claim runs on, so the wrong pairing claimed a character onto an account
    // that never made it.
    mockGetSession.mockResolvedValue(guestSession());
    mockUpdateUser
      .mockResolvedValueOnce({
        data: { user: { id: GUEST_ID, new_email: "first@example.com" } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "email_exists", message: "email_exists" },
      });
    const { sendEmailCode, verifyEmailCode } = loadSession();

    await sendEmailCode("first@example.com");
    await sendEmailCode("second@example.com");

    await verifyEmailCode("first@example.com", "123456");
    expect(mockVerifyOtp).toHaveBeenCalledWith({
      email: "first@example.com",
      token: "123456",
      type: "email_change",
    });
  });
});

describe("a reload between the email screen and the code screen", () => {
  it("retries a derived email change as the sign-in it actually was", async () => {
    // The fallback send leaves the session ANONYMOUS -- nothing is verified
    // yet -- so a re-derived mode reads "email_change" and Supabase refuses a
    // code that is perfectly valid. The user was told their correct code did
    // not match, with no way out but a resend landing in the same place.
    mockGetSession
      .mockResolvedValueOnce(guestSession())
      .mockResolvedValue(namedSession());
    mockVerifyOtp
      .mockReset()
      .mockResolvedValueOnce({
        data: {},
        error: { message: "Token has expired or is invalid" },
      })
      .mockResolvedValue({ data: {}, error: null });
    const { verifyEmailCode } = loadSession();

    await expect(verifyEmailCode("writer@example.com", "123456"))
      .resolves.toBeUndefined();
    expect(mockVerifyOtp).toHaveBeenNthCalledWith(2, {
      email: "writer@example.com",
      token: "123456",
      type: "email",
    });
  });

  it("still reports a code that is genuinely wrong", async () => {
    mockGetSession.mockResolvedValue(guestSession());
    mockVerifyOtp
      .mockReset()
      .mockResolvedValue({
        data: {},
        error: { message: "Token has expired or is invalid" },
      });
    const { verifyEmailCode } = loadSession();

    await expect(verifyEmailCode("writer@example.com", "000000"))
      .rejects.toBeDefined();
  });
});

describe("signing out to the sign-in screen", () => {
  // D1: signing out used to mint a fresh anonymous session, which left a live
  // guest identity on the backend while the UI showed sign-in. It now clears
  // the session and stops.
  it("clears the session without minting a guest", async () => {
    mockGetSession.mockResolvedValue(namedSession());
    const { signOutToSignIn } = loadSession();

    await signOutToSignIn();

    expect(mockSignOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mockSignInAnonymously).not.toHaveBeenCalled();
  });

  it("drops a half-finished sign-in", async () => {
    mockGetSession.mockResolvedValue(guestSession());
    mockUpdateUser.mockResolvedValue({
      data: null,
      error: { code: "email_exists", message: "email_exists" },
    });
    mockSignInAnonymously.mockResolvedValue({
      data: { session: { access_token: "fresh-token" } },
      error: null,
    });
    const { sendEmailCode, signOutToSignIn, verifyEmailCode } = loadSession();

    await sendEmailCode("writer@example.com");
    await signOutToSignIn();
    mockGetSession.mockResolvedValue(namedSession());
    await verifyEmailCode("writer@example.com", "123456");

    // The recorded token belonged to the identity that just left; replaying
    // it would hand a stranger's character to whoever signs in next.
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
