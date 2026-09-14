import AsyncStorage from "@react-native-async-storage/async-storage";
import { captureError } from "@/lib/analytics";
import {
  setCharacterImageBalance,
  clearCharacterImagesRemaining,
  setCharacterImagesRemaining,
} from "@/lib/character-image-allowance";
import { setViewerId } from "@/lib/ownership";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export type BootstrappedUser = {
  userId: string;
  balance: number;
  isAnonymous: boolean;
  welcomeGranted: boolean;
  rateLimited: boolean;
  /**
   * How many of the six free character images this account has left.
   *
   * `null` when the server could not say. Every surface that quotes a portrait
   * price treats that as "no quote" rather than falling back to six, because a
   * button that says "6 free" to someone with none left is an affordance that
   * lies -- they tap it and the server charges, or refuses.
   */
  characterImagesFreeRemaining: number | null;
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
  const session = await currentSession();
  try {
    return await callBootstrap(session.access_token);
  } catch (error) {
    if (!isUnusableSessionError(error)) throw error;
    // A stored session the server will not accept is a dead end that outlives
    // every reload, because the dead session is what gets restored.
    //
    // Observed: a guest identity sat in local storage whose token the edge
    // function answered 401 to. `bootstrapUser` threw, `App.tsx` left credits
    // at 0, nothing was shown, and refreshing restored the same dead session
    // and did it again. The user was permanently at zero credits with no
    // error and no way out short of clearing site data -- and the server-side
    // 401 returns before `logError`, so there was not even a trace of it.
    //
    // Signing the dead session out and starting a fresh guest is the only
    // recovery that does not require the user to know what local storage is.
    // It costs one extra round trip on a path that was previously a
    // permanent failure, and it happens once: the new session is stored.
    const fresh = await restartGuestSession();
    return await callBootstrap(fresh.access_token);
  }
}

type UsableSession = { access_token: string };

/** The stored session, or a new guest one. Never returns a tokenless session. */
async function currentSession(): Promise<UsableSession> {
  const { data: current, error: sessionError } = await supabase.auth
    .getSession();
  if (sessionError) throw sessionError;
  if (current.session?.access_token) return current.session;
  return restartGuestSession();
}

/** Discard whatever is stored and sign in as a brand-new guest. */
async function restartGuestSession(): Promise<UsableSession> {
  // `scope: "local"` clears this device's stored session without trying to
  // revoke server-side. Revocation needs the very token that is not being
  // accepted, so asking for it would fail and take the recovery with it.
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!data.session?.access_token) {
    throw new Error("Unable to establish a guest session");
  }
  return data.session;
}

/**
 * Is this the server refusing the identity, rather than anything else failing?
 *
 * Only 401 and 403 are worth burning a new guest identity over. A 500, a
 * timeout or an offline device all mean "try this same session again later",
 * and signing out on those would throw away a perfectly good identity -- along
 * with any credits attached to it -- because the network blipped.
 */
function isUnusableSessionError(error: unknown): boolean {
  const status = (error as { context?: { status?: number } } | null)?.context
    ?.status;
  return status === 401 || status === 403;
}

async function callBootstrap(
  accessToken: string,
  body: Record<string, unknown> = {},
): Promise<BootstrappedUser> {
  const { data, error } = await supabase.functions.invoke("bootstrap-user", {
    body,
    headers: { Authorization: `Bearer ${accessToken}` },
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

  // The one place the client learns who it is. Ownership checks (Edit is
  // author-only) compare `story.authorId` against this.
  setViewerId(payload.user_id);

  // And the one place it learns what a character image will cost it. Seeded
  // here rather than fetched by each screen, because this call already happens
  // at boot and again after sign-in -- the two moments the count can change
  // without the client having spent anything.
  /*
    A FAILED READ IS NOT AN ANSWER OF ZERO, AND MUST NOT ERASE THE LAST ONE.

    `bootstrap-user` returns null when it could not read the allowance -- a
    transient RPC failure, not a statement about the user. Writing that null
    through cleared a count the client already had, and the sheet then showed
    no price at all in front of a button that may charge a credit. A number we
    were told an hour ago is a better answer than none.

    It is still cleared deliberately on sign-out, where the previous account's
    count genuinely stops being true.
  */
  if (typeof payload.character_images_free_remaining === "number") {
    setCharacterImagesRemaining(payload.character_images_free_remaining);
  }
  setCharacterImageBalance(payload.balance);

  return {
    userId: payload.user_id,
    balance: payload.balance,
    isAnonymous: payload.is_anonymous,
    welcomeGranted: payload.welcome_granted === true,
    rateLimited: payload.rate_limited === true,
    // Absent on any deploy older than 00088, which reads as "no quote".
    characterImagesFreeRemaining:
      typeof payload.character_images_free_remaining === "number"
        ? payload.character_images_free_remaining
        : null,
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

/**
 * How the code that was just sent has to be verified, and what identity it
 * will land on.
 *
 * `email_change` is the conversion path: the anonymous user asked Supabase to
 * put an address on ITSELF, so verifying keeps `auth.users.id` and everything
 * hanging off `profiles(id)` -- the onboarding character and the guest credits
 * included. `email` is the fallback: that address already belongs to somebody,
 * so verifying signs into THAT account and the guest identity is left behind.
 * `already_confirmed` is the project-configuration case where Supabase applied
 * the address without asking for a code at all.
 */
type EmailOtpMode = "email_change" | "email" | "already_confirmed";

/**
 * What `sendEmailCode` just did, so `verifyEmailCode` verifies the same thing.
 *
 * Module state rather than a return value because agent A's screen calls these
 * two by their existing signatures and must keep working. `verifyEmailCode`
 * re-derives the mode from the live session when the entry is missing (a
 * reload between the two screens), so losing it degrades rather than erroring.
 *
 * KEYED BY ADDRESS, not a single slot. A single slot is one send at a time:
 * a user who mistypes, sends, corrects and sends again -- or a flow that hands
 * off to a plain sign-in -- overwrote the first send's mode AND its guest
 * token, and then the code that actually arrived for the first address got
 * verified against the second address's decision. Worse, the guest token is
 * the proof `claim_guest_characters` runs on, so the wrong pairing claimed a
 * character onto an account that never made it. One entry per address, and
 * the map is emptied whenever the identity changes underneath it.
 */
const pendingEmailOtp = new Map<
  string,
  { mode: EmailOtpMode; guestAccessToken?: string }
>();

/** The map's key: the address as typed never matches the address as stored. */
function otpKey(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Forget every outstanding send.
 *
 * Called once the session has changed hands. A pending entry names a guest
 * access token, and after a verify that token belongs to an identity this
 * device is no longer on -- replaying it would claim a character onto whoever
 * signs in next.
 */
function forgetPendingEmailOtp(): void {
  pendingEmailOtp.clear();
}

/** The stored session if it belongs to a guest, otherwise null. */
async function anonymousSession(): Promise<
  { access_token: string; user_id?: string } | null
> {
  try {
    const { data } = await supabase.auth.getSession();
    const session = data?.session;
    if (!session?.access_token) return null;
    if (session.user?.is_anonymous !== true) return null;
    return { access_token: session.access_token, user_id: session.user?.id };
  } catch {
    // Not knowing means "treat this as a named session": the fallback path
    // below is correct for one and merely suboptimal for the other.
    return null;
  }
}

/**
 * Is this Supabase refusing to move the address because somebody already has
 * it, rather than any other failure?
 *
 * Only this one error may fall through to signing into that other account.
 * Treating every `updateUser` failure that way would silently strand the
 * guest's character on a network blip.
 */
function isEmailTakenError(error: unknown): boolean {
  const detail = error as { code?: string; status?: number; message?: string };
  if (detail?.code === "email_exists") return true;
  return typeof detail?.message === "string" &&
    /already (been )?registered|already exists|email_exists/i
      .test(detail.message);
}

export async function sendEmailCode(email: string): Promise<void> {
  // SCAFFOLD: AUTH_NOT_WIRED. See the note above `verifyEmailCode`.
  if (authBypassed()) return;
  if (!isSupabaseConfigured) return;
  const address = email.trim();

  const guest = await anonymousSession();
  if (guest) {
    // Convert IN PLACE. `signInWithOtp` on a guest session creates a second
    // account, and everything made during onboarding -- the character row in
    // `user_characters`, the three guest credits, the profile -- is keyed to
    // the anonymous id and does not come with it.
    const { data, error } = await supabase.auth.updateUser({ email: address });
    if (!error) {
      // Supabase parks the address in `new_email` while a confirmation is
      // outstanding. A project with email-change confirmation turned off
      // applies it immediately and sends no code, and asking for one then
      // would fail on a screen whose work is already done.
      const applied = data?.user?.email?.toLowerCase() === address.toLowerCase();
      const pendingConfirmation = Boolean(data?.user?.new_email);
      pendingEmailOtp.set(otpKey(address), {
        mode: !pendingConfirmation && applied ? "already_confirmed" : "email_change",
        guestAccessToken: guest.access_token,
      });
      return;
    }
    if (!isEmailTakenError(error)) throw error;
    // The address belongs to an existing account. Sign into it, and move the
    // character across afterwards -- see `verifyEmailCode`.
    pendingEmailOtp.set(otpKey(address), {
      mode: "email",
      guestAccessToken: guest.access_token,
    });
  } else {
    pendingEmailOtp.set(otpKey(address), { mode: "email" });
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: address,
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
/**
 * ## Identity across sign-in (the finding, 2026-09-11)
 *
 * **Before this change `auth.users.id` was NOT preserved.** `sendEmailCode`
 * called `signInWithOtp({ shouldCreateUser: true })` and this function
 * `verifyOtp({ type: "email" })`, which is Supabase's create-or-sign-into-an
 * -account pair, not its convert-an-anonymous-user pair. On the new character
 * onboarding that is a silent data loss, not a cosmetic one:
 *
 * - The portrait is generated and `saveCharacterToLibrary` writes a
 *   `user_characters` row whose `owner_id` is the ANONYMOUS `profiles(id)`.
 * - Verifying the code then swapped the session for a different user id.
 * - `user_characters` is owner-only under RLS (migration 00057), so the row is
 *   still there and the caller can no longer see it. The library comes back
 *   empty and nothing reports an error -- the character the whole flow exists
 *   to produce is gone the moment the user saves it.
 * - The three guest credits (`bootstrap_anonymous_user`, migration 00035) stay
 *   on the anonymous id too, and the new account starts at zero.
 *
 * The supported in-place path is `updateUser({ email })` on the anonymous
 * session followed by `verifyOtp({ type: "email_change" })`: same
 * `auth.users.id`, same `profiles.id`, so the character, the credits and the
 * cached display name all stay attached and nothing has to be migrated.
 * `sendEmailCode` now takes that path and records it in `pendingEmailOtp`.
 *
 * **The anonymous profile row is not deleted and does not need to be** -- on
 * the conversion path it IS the account now; only `auth.users.is_anonymous`
 * flips to false. `bootstrap-user` called again by the now-named user upserts
 * the same `profiles` row with `ignoreDuplicates`, takes the `guest` branch no
 * longer (so `bootstrap_anonymous_user` is not called and no second grant is
 * minted) and returns the same `user_id` and the same balance.
 *
 * **The fallback, and its abuse boundary.** `updateUser` fails when the address
 * already belongs to somebody, and there is no in-place merge for that: the
 * user is signing into an account that predates this device. So we sign in
 * with `signInWithOtp`/`verifyOtp({ type: "email" })` and then re-point the
 * guest's `user_characters` rows at the account they just proved they own, by
 * handing `bootstrap-user` the still-valid anonymous access token. The server
 * verifies that token with Supabase Auth (never the client's claim about which
 * id it was), requires `is_anonymous`, and calls the service-role-only
 * `claim_guest_characters` RPC (migration 00082), which moves `owner_id` on
 * that one table and nothing else. Possession of an unexpired anonymous JWT is
 * the proof, and only the device that created it has one. Credits deliberately
 * do NOT move: the guest grant is rate-limited per network (00035), and
 * carrying it onto named accounts would turn that limit into a farm.
 */
export async function verifyEmailCode(
  email: string,
  code: string,
): Promise<void> {
  // SCAFFOLD: AUTH_NOT_WIRED. Unconfigured means unverifiable, not verified.
  if (authBypassed()) return;
  if (!isSupabaseConfigured) return;
  const address = email.trim();
  const token = code.trim();

  const pending = pendingEmailOtp.get(otpKey(address)) ?? null;
  const guest = pending ? null : await anonymousSession();
  const mode: EmailOtpMode = pending?.mode ?? (guest ? "email_change" : "email");
  const guestAccessToken = pending?.guestAccessToken ?? guest?.access_token;

  if (mode === "already_confirmed") {
    // The address is on this identity already and no code was ever sent, so
    // there is nothing to verify. Nothing changed hands: the id is the same
    // one the character and the credits are attached to.
    pendingEmailOtp.delete(otpKey(address));
    return;
  }

  let verified = mode;
  const { error } = await supabase.auth.verifyOtp({
    email: address,
    token,
    type: mode,
  });
  if (error) {
    // THE RELOAD PATH, and the one case where a rejected code is OUR mistake.
    //
    // Without a recorded send the mode is re-derived, and a stored guest
    // session reads as `email_change` -- right when `updateUser` parked the
    // address, wrong when it refused because the address already belongs to
    // somebody. In that second case `sendEmailCode` sent a plain sign-in
    // code, the session is still anonymous because nothing has been verified
    // yet, and verifying as `email_change` rejects a code that is perfectly
    // valid. The user is then told their correct code did not match, with no
    // way out but a resend that lands in the same place.
    //
    // So a derived `email_change` that is refused is retried once as the
    // sign-in it may have been all along. A recorded send is never retried:
    // there the mode is known, and a refusal is a real refusal.
    if (pending || mode !== "email_change") throw error;
    const retry = await supabase.auth.verifyOtp({
      email: address,
      token,
      type: "email",
    });
    if (retry.error) throw error;
    verified = "email";
  }
  // The identity has changed hands: every remaining entry names a guest token
  // that is no longer this device's.
  forgetPendingEmailOtp();

  // Only the fallback leaves anything behind. The conversion path kept the id.
  if (verified === "email" && guestAccessToken) {
    await claimGuestCharacters(guestAccessToken);
  }
}

/**
 * Move the guest's saved characters onto the account that just signed in.
 *
 * Never fatal. The user has verified their email and is standing on the last
 * screen of onboarding; failing that screen because a character could not be
 * re-homed would cost them more than the character does. The failure is
 * reported instead, because a silent one here is exactly the class of bug this
 * whole change exists to remove.
 */
async function claimGuestCharacters(guestAccessToken: string): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data?.session?.access_token;
    if (!accessToken || accessToken === guestAccessToken) return;
    await callBootstrap(accessToken, { claim_guest_token: guestAccessToken });
  } catch (error) {
    try {
      captureError({
        bucket: "auth",
        severity: "high",
        errorCode: "guest_character_claim_failed",
        error,
      });
    } catch {
      // Reporting a failure must never become a second failure.
    }
  }
}

/**
 * Sign out, and come back as a guest.
 *
 * Not just `auth.signOut()`. Every screen in Katha assumes there is an
 * identity behind it -- the feed, the credit balance, the streak all call
 * `bootstrapUser()` and expect a session -- so signing out into no session at
 * all leaves the app in a state nothing is written for. Signing out INTO a
 * fresh guest keeps that invariant: reading still works, the account's
 * credits and library are gone with the account, and signing back in restores
 * them.
 *
 * The cached greeting name is cleared here too. It is a copy of something
 * that belonged to the account that just left, and a new guest greeted by the
 * previous person's name is the kind of small wrongness that makes an app feel
 * untrustworthy.
 */
export async function signOutToGuest(): Promise<void> {
  // A half-finished sign-in must not be resumable by the guest who replaces
  // it: the token recorded there belongs to the identity that just left.
  forgetPendingEmailOtp();

  // The free-image count and the balance belong to the identity that just
  // left, and the guest replacing them is a different person with a different
  // allowance. Cleared BEFORE the new session is minted, so the window where
  // the sheet could quote the previous account's remaining images -- and let
  // the new guest spend against them -- does not exist rather than being
  // short. The next bootstrap fills them in.
  clearCharacterImagesRemaining();

  try {
    await AsyncStorage.removeItem("katha.displayName.v1");
  } catch {
    // A stale cached name is a cosmetic problem; it must not block sign-out.
  }

  // `restartGuestSession` signs out FIRST and then signs in, so a failure in
  // the second half leaves the app with no session at all -- and every screen
  // here assumes there is one. Retried once, because the common cause is a
  // single dropped request, and the failure is surfaced rather than swallowed
  // so the caller can say so instead of navigating into a signed-out app that
  // cannot render.
  try {
    await restartGuestSession();
  } catch {
    await restartGuestSession();
  }
}
