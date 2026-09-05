/**
 * Expo Push, rather than FCM and APNs directly.
 *
 * One token format, one endpoint, both platforms, and it is already what the
 * client's `getExpoPushTokenAsync` produces. Talking to FCM and APNs directly
 * buys throughput this app does not need and costs two credential rotations,
 * two payload shapes and two failure taxonomies.
 */

export const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
export const EXPO_RECEIPT_ENDPOINT =
  "https://exp.host/--/api/v2/push/getReceipts";

/** Expo rejects a request carrying more than this many messages. */
export const EXPO_PUSH_BATCH_SIZE = 100;

export type PushPlatform = "ios" | "android";

/**
 * Notification channels, declared on the client before the first send.
 *
 * `generation` is separate from `stories` on purpose: a user must be able to
 * mute "an author you follow published" without muting "the story you paid for
 * is ready", which is the notification they explicitly asked for.
 */
export type PushChannel = "default" | "stories" | "generation";

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  channelId?: PushChannel;
  data?: Record<string, unknown>;
};

export type PushTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string } };

/**
 * A token Expo has told us is dead.
 *
 * `DeviceNotRegistered` arrives both synchronously in a ticket and
 * asynchronously in a receipt. A sender that ignores it accumulates dead
 * tokens until the whole project is throttled, so both paths have to delete.
 */
export const DEAD_TOKEN_ERROR = "DeviceNotRegistered";

export function isValidExpoToken(value: unknown): value is string {
  return typeof value === "string" &&
    /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/.test(value);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Send one batch and report which tokens Expo rejected outright.
 *
 * Tickets are positional: ticket N belongs to message N. Expo documents this,
 * and it is the only way to map an error back to the token that caused it.
 */
export async function sendExpoPushBatch(
  messages: PushMessage[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ ticketTokens: [string, string][]; deadTokens: string[] }> {
  if (!messages.length) return { ticketTokens: [], deadTokens: [] };

  const response = await fetchImpl(EXPO_PUSH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    throw new Error(`Expo push failed: ${response.status}`);
  }

  const payload = await response.json() as { data?: PushTicket[] };
  const tickets = Array.isArray(payload.data) ? payload.data : [];

  // Pair each ticket with the token that produced it here, while the
  // positional guarantee still holds. The caller batches, so by the time it
  // sees these the index is meaningless.
  const ticketTokens: [string, string][] = [];
  const deadTokens: string[] = [];
  tickets.forEach((ticket, index) => {
    const token = messages[index]?.to;
    if (!token) return;
    if (ticket.status === "ok") {
      ticketTokens.push([ticket.id, token]);
      return;
    }
    if (ticket.details?.error === DEAD_TOKEN_ERROR) deadTokens.push(token);
  });
  return { ticketTokens, deadTokens };
}

/**
 * Read receipts for tickets already accepted.
 *
 * Acceptance is not delivery. Expo queues the message, hands back a ticket,
 * and only later reports that APNs or FCM refused it - which is where most
 * `DeviceNotRegistered` actually surfaces. Receipts are the only place a
 * uninstalled app becomes visible.
 */
export async function readExpoReceipts(
  ticketIds: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ deadTicketIds: string[] }> {
  if (!ticketIds.length) return { deadTicketIds: [] };

  const response = await fetchImpl(EXPO_RECEIPT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: ticketIds }),
  });
  if (!response.ok) throw new Error(`Expo receipts failed: ${response.status}`);

  const payload = await response.json() as {
    data?: Record<string, { status: string; details?: { error?: string } }>;
  };
  const deadTicketIds: string[] = [];
  for (const [id, receipt] of Object.entries(payload.data ?? {})) {
    if (
      receipt.status === "error" && receipt.details?.error === DEAD_TOKEN_ERROR
    ) {
      deadTicketIds.push(id);
    }
  }
  return { deadTicketIds };
}

/** The three notifications this product sends, and their copy. */
export function storyReadyMessage(title: string): Pick<
  PushMessage,
  "title" | "body" | "channelId"
> {
  return {
    title: "Your story is ready",
    body: `${title} is ready to read.`,
    channelId: "generation",
  };
}

export function chapterReadyMessage(
  title: string,
  chapterNumber: number,
): Pick<PushMessage, "title" | "body" | "channelId"> {
  return {
    title: "A new chapter",
    body: `Chapter ${chapterNumber} of ${title} is written.`,
    channelId: "generation",
  };
}

export function draftWaitingMessage(
  title: string,
  chapterNumber: number,
): Pick<PushMessage, "title" | "body" | "channelId"> {
  return {
    title: "Still waiting",
    body: `${title} is waiting at chapter ${chapterNumber}.`,
    channelId: "stories",
  };
}
