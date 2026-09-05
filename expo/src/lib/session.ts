import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export type BootstrappedUser = {
  userId: string;
  balance: number;
  isAnonymous: boolean;
  welcomeGranted: boolean;
  rateLimited: boolean;
};

let bootstrapInFlight: Promise<BootstrappedUser | null> | null = null;

/**
 * Ensure there is a persisted Supabase session before calling authenticated
 * functions. The shared promise prevents App startup and an early Create tap
 * from creating two guest identities or welcome-grant requests.
 */
export function bootstrapUser(): Promise<BootstrappedUser | null> {
  if (!isSupabaseConfigured) return Promise.resolve(null);
  if (bootstrapInFlight) return bootstrapInFlight;

  bootstrapInFlight = bootstrapCurrentUser().finally(() => {
    bootstrapInFlight = null;
  });
  return bootstrapInFlight;
}

async function bootstrapCurrentUser(): Promise<BootstrappedUser> {
  const { data: current, error: sessionError } = await supabase.auth
    .getSession();
  if (sessionError) throw sessionError;

  let session = current.session;
  if (!session) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    session = data.session;
  }
  if (!session?.access_token) {
    throw new Error("Unable to establish a guest session");
  }

  const { data, error } = await supabase.functions.invoke("bootstrap-user", {
    body: {},
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (error) throw error;
  if (!data || typeof data !== "object") {
    throw new Error("User bootstrap returned an invalid response");
  }

  const payload = data as Record<string, unknown>;
  if (
    typeof payload.user_id !== "string" ||
    typeof payload.balance !== "number" ||
    typeof payload.is_anonymous !== "boolean"
  ) {
    throw new Error("User bootstrap returned an invalid response");
  }

  return {
    userId: payload.user_id,
    balance: payload.balance,
    isAnonymous: payload.is_anonymous,
    welcomeGranted: payload.welcome_granted === true,
    rateLimited: payload.rate_limited === true,
  };
}

/**
 * Email sign-in for onboarding's A1.
 *
 * A one-time code rather than a magic link: the link opens a browser, which on
 * a phone means leaving the flow at the exact moment it has finally earned
 * something to save. `shouldCreateUser` is on because A1 is where most accounts
 * are made.
 */
/**
 * SCAFFOLD: AUTH_NOT_WIRED.
 *
 * While the flow is being reviewed end to end, any six digits verify. Real auth
 * is deliberately the last thing wired, and until it is, a tester should not
 * need a live inbox to walk from the idea screen to the blueprint.
 *
 * Two conditions, both required, because the credentials in `expo/.env` are
 * real: the anon key points at a live project whose auth service is up and
 * enforcing, so `isSupabaseConfigured` is true here and the unconfigured
 * no-op below is unreachable. Gating on `APP_ENV` is what actually reaches
 * this environment, and `__DEV__` is the belt to that braces: a release build
 * has it false, so no shipped binary can take this path even if someone leaves
 * `EXPO_PUBLIC_APP_ENV=local` in a build profile.
 *
 * Removal condition: delete this function and both of its call sites the moment
 * A1 is wired for real. Grep AUTH_NOT_WIRED to find everything involved.
 */
function authBypassed(): boolean {
  return __DEV__ && process.env.EXPO_PUBLIC_APP_ENV === "local";
}

export async function sendEmailCode(email: string): Promise<void> {
  // SCAFFOLD: AUTH_NOT_WIRED. See the note above `verifyEmailCode`.
  if (authBypassed()) return;
  if (!isSupabaseConfigured) return;
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true },
  });
  if (error) throw error;
}

/**
 * SCAFFOLD: AUTH_NOT_WIRED — grep this tag before shipping authentication.
 *
 * With no Supabase credentials in the bundle there is no auth service to ask,
 * so `sendEmailCode` posts nothing and this accepts whatever the user typed.
 * That is what lets the onboarding flow be walked end to end while real auth
 * is still being wired: any six digits get through, because nothing on the
 * device can tell one six-digit string from another.
 *
 * There are two pass-throughs, and they are not the same thing. The
 * unconfigured one below is a consequence, not a decision: with no credentials
 * there is nothing to ask. `authBypassed()` is the deliberate one, and it is
 * the only one that reaches this environment, because `expo/.env` sets both
 * Supabase variables and the project behind them is live and enforcing.
 *
 * REMOVE WHEN: A1 is wired for real. Delete `authBypassed()` and both of its
 * call sites; the unconfigured branch can stay. Do not widen the gate: a
 * bypass reachable in a release build, or with `APP_ENV` set to anything but
 * `local`, is an auth hole. `src/__tests__/session.test.ts` asserts both
 * directions to keep it that way.
 */
export async function verifyEmailCode(
  email: string,
  code: string,
): Promise<void> {
  // SCAFFOLD: AUTH_NOT_WIRED. Unconfigured means unverifiable, not verified.
  if (authBypassed()) return;
  if (!isSupabaseConfigured) return;
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: code.trim(),
    type: "email",
  });
  if (error) throw error;
}
