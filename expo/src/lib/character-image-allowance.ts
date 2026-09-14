/**
 * How many of the six free character images this account has left, shared by
 * every screen that can spend one.
 *
 * Four surfaces call `generate-character-image` -- onboarding's W4, the Craft
 * character sheet, the saved-characters picker and the reimagine sheet -- and
 * a user moves between them inside one session. A count held per screen would
 * disagree the moment they did: the picker would still say "6 free" after
 * onboarding had spent three, and the button under that label charges a credit.
 *
 * So the number lives here, it is SERVER-SOURCED in both directions -- seeded
 * by `bootstrap-user` and corrected by every image response, both of which read
 * migration 00088's counter -- and no screen ever decrements it by counting its
 * own taps. `null` means the server has not said, which every quote treats as
 * "show no price" rather than as "six left".
 *
 * THE CLIENT QUOTES, THE SERVER CHARGES. Nothing here is enforcement; it exists
 * so a user is never shown a free button that is about to take a credit, or a
 * priced button they cannot pay for.
 */
import { useEffect, useState } from "react";

let remaining: number | null = null;
let balance: number | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** Record what the server just said is left. */
export function setCharacterImagesRemaining(value: number | null): void {
  const next = typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null;
  if (next === remaining) return;
  remaining = next;
  notify();
}

/**
 * The credit balance the server saw on its last answer.
 *
 * Held beside the count because the two are read together and arrive together
 * -- from `bootstrap-user`, and from every character-image response. The Craft
 * sheet is reached from the reader as well as from the studio, and the reader
 * carries no balance of its own; without this, the one surface that can be
 * opened from either place could price an image but not tell whether the user
 * could pay for it.
 *
 * It is a fallback, not an authority: a caller that holds a live balance passes
 * its own. Staleness here can only cost a refusal the server was going to give
 * anyway -- it can never authorise a charge, because it is never sent anywhere.
 */
export function setCharacterImageBalance(value: number | null): void {
  const next = typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null;
  if (next === balance) return;
  balance = next;
  notify();
}

/** What the server last said is left, or null if it has not said. */
export function getCharacterImagesRemaining(): number | null {
  return remaining;
}

/** The balance the server last reported, or null if it has not reported one. */
export function getCharacterImageBalance(): number | null {
  return balance;
}

/**
 * Reset to "unknown" when the identity changes.
 *
 * Signing out of a guest session and into an account is a different person's
 * allowance. Keeping the old number would quote the new account the count the
 * old one had spent.
 */
export function clearCharacterImagesRemaining(): void {
  setCharacterImagesRemaining(null);
  setCharacterImageBalance(null);
}

function useServerValue(read: () => number | null): number | null {
  const [value, setValue] = useState(read);
  useEffect(() => {
    // Re-read on mount as well as on change: a response may have landed
    // between the initial state and this effect.
    setValue(read());
    const listener = () => setValue(read());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [read]);
  return value;
}

/** The count, re-rendering when a generation or a bootstrap moves it. */
export function useCharacterImagesRemaining(): number | null {
  return useServerValue(getCharacterImagesRemaining);
}

/** The last balance the server reported, re-rendering when it moves. */
export function useCharacterImageBalance(): number | null {
  return useServerValue(getCharacterImageBalance);
}
