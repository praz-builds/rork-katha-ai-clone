/**
 * Server-Sent Events over `expo/fetch`.
 *
 * # Why not the obvious transports
 *
 * `supabase.functions.invoke()` awaits the whole body before it resolves. There
 * is no option that changes that, so every streaming call has to bypass it and
 * build the URL and `Authorization` header by hand.
 *
 * React Native's global `fetch` does not help either: it is a polyfill over
 * XHR, and `response.body` is `null` there. Code written against the web
 * platform's streaming API compiles, runs, and silently never streams - which
 * is the worst of the three outcomes, because it looks like it works.
 *
 * Expo SDK 54 ships `expo/fetch`, a WinterCG implementation whose
 * `FetchResponse` exposes a real `ReadableStream<Uint8Array>`. That is the only
 * reason this file needs no new dependency. On web it resolves to the platform
 * fetch, which streams natively.
 */

import { fetch as expoFetch } from "expo/fetch";

export interface SseEvent {
  event: string;
  data: unknown;
}

export class StreamTransportError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "StreamTransportError";
  }
}

/**
 * Split a raw SSE buffer into complete frames, returning the unconsumed tail.
 *
 * Frames are separated by a blank line, and the tail matters: a frame split
 * across two network reads is normal, and parsing half of one drops whatever it
 * carried. Exported for tests, because this is the part that silently corrupts
 * a story when it is wrong.
 */
export function splitSseFrames(
  buffer: string,
): { frames: string[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  return { frames: parts, rest };
}

/**
 * Parse one complete SSE frame into its event name and JSON payload.
 *
 * Returns `null` for a frame carrying no `data:` line - keep-alive comments and
 * bare `event:` lines both reach here and neither is a message.
 */
export function parseSseFrame(frame: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    // A multi-line `data:` payload is concatenated by the SSE spec. Our server
    // never sends one, but honouring it costs a line and removes a footgun.
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

/**
 * POST a JSON body and yield each SSE event as it arrives.
 *
 * A non-2xx never streams: the server decides everything that can reject a
 * request before it opens the body, so an error here is ordinary JSON and is
 * surfaced as a `StreamTransportError` carrying the status.
 */
export async function postEventStream(
  input: {
    url: string;
    headers: Record<string, string>;
    body: unknown;
    signal?: AbortSignal;
    onEvent: (event: SseEvent) => void;
  },
): Promise<void> {
  const response = await expoFetch(input.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...input.headers,
    },
    body: JSON.stringify(input.body),
    signal: input.signal,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      const named = (payload as { error?: unknown })?.error;
      if (typeof named === "string" && named.trim()) message = named;
    } catch {
      // A non-JSON error body tells us nothing the status has not already.
    }
    throw new StreamTransportError(message, response.status);
  }

  if (!response.body) {
    // Reachable if this ever runs on a transport without stream support. Fail
    // loudly rather than hanging: a caller that silently never streams is the
    // exact failure this module exists to prevent.
    throw new StreamTransportError(
      "This device returned no readable stream for a streaming response",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = splitSseFrames(buffer);
      buffer = rest;
      for (const frame of frames) {
        const parsed = parseSseFrame(frame);
        if (parsed) input.onEvent(parsed);
      }
    }
    // A final frame with no trailing blank line still has to be delivered.
    const parsed = parseSseFrame(buffer);
    if (parsed) input.onEvent(parsed);
  } finally {
    reader.releaseLock();
  }
}
