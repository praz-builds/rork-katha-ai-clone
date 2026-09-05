/**
 * The guest grant deliberately does not follow the named welcome bonus up to 10.
 * The named grant is protected by Apple / Google / email; this one is protected
 * only by the network-prefix limit below, and three grants of 10 per network per
 * day is a farm. See CREDITS_AND_PRICING.md section 6.
 */
export const GUEST_BOOTSTRAP_CREDITS = 3;
export const GUEST_BOOTSTRAP_WINDOW_LIMIT = 3;

type BootstrapUser = {
  id: string;
  is_anonymous?: boolean;
};

/** Supabase marks guest identities explicitly in the verified user payload. */
export function isAnonymousUser(user: BootstrapUser): boolean {
  return user.is_anonymous === true;
}

/**
 * Distinct from the named `welcome:{user_id}` key on purpose: a guest who later
 * signs in receives the named welcome bonus as well, because they converted.
 */
export function guestBootstrapOperationKey(userId: string): string {
  return `guest_bootstrap:${userId}`;
}

/**
 * Bound anonymous-account farming by a coarse network prefix, without storing
 * the raw address. The service-role key salts the persisted SHA-256 value.
 *
 * The address must come from a header owned by the edge platform, not the app.
 * When an unusual proxy omits it, callers fail closed for anonymous grants and
 * free anonymous inference.
 */
export function anonymousGrantScope(request: Request): string | null {
  // Only accept headers written by a trusted edge. x-forwarded-for is omitted
  // deliberately because a direct client can supply it on some deployments.
  const forwarded = request.headers.get("cf-connecting-ip") ??
    request.headers.get("fly-client-ip");
  if (!forwarded) return null;

  const ipv4 = forwarded.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (ipv4 && ipv4.slice(1).every((part) => Number(part) <= 255)) {
    return `ipv4:${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.0/24`;
  }

  // A /64 is the conventional household/mobile-network aggregation for IPv6.
  //
  // Expanded first, because slicing the literal text is only correct for a
  // fully written address. `2001:db8::1` has four textual segments that are not
  // its first four hextets, so the raw split hands back the whole address as
  // the "prefix" and every device behind one /64 gets its own grant budget --
  // exactly the farming this limit exists to stop.
  const hextets = expandIpv6(forwarded);
  if (hextets) {
    return `ipv6:${hextets.slice(0, 4).join(":")}::/64`;
  }

  return null;
}

/**
 * Expand an IPv6 address to its eight hextets, lowercased and without leading
 * zeros. Returns null for anything that is not a plain eight-hextet address,
 * including IPv4-mapped forms, so an unparseable value fails closed at the
 * caller rather than producing a scope that groups unrelated networks.
 */
export function expandIpv6(address: string): string[] | null {
  const lower = address.toLowerCase();
  if (!/^[0-9a-f:]+$/.test(lower)) return null;

  const halves = lower.split("::");
  if (halves.length > 2) return null;

  let hextets: string[];
  if (halves.length === 2) {
    const head = halves[0] === "" ? [] : halves[0].split(":");
    const tail = halves[1] === "" ? [] : halves[1].split(":");
    const elided = 8 - head.length - tail.length;
    // `::` stands for at least one omitted hextet; a fully written address that
    // also carries `::` is malformed, not merely redundant.
    if (elided < 1) return null;
    hextets = [...head, ...Array(elided).fill("0"), ...tail];
  } else {
    hextets = lower.split(":");
  }

  if (hextets.length !== 8) return null;
  if (!hextets.every((hextet) => /^[0-9a-f]{1,4}$/.test(hextet))) return null;

  return hextets.map((hextet) => hextet.replace(/^0+(?=.)/, ""));
}

export async function hashAnonymousGrantScope(
  scope: string,
  serviceRoleKey: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${serviceRoleKey}:${scope}`),
  );
  return Array.from(new Uint8Array(digest)).map((value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}
