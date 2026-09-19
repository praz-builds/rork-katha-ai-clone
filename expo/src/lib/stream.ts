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
  constructor(
    message: string,
    readonly status?: number,
    /**
     * The parsed JSON error body, when there was one. The caller needs more
     * than the message: `status: "refunded"` is what says a request id is
     * spent and the next attempt needs a fresh one.
     */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "StreamTransportError";
  }
}

/**
 * No bytes at all - not an event, not a keep-alive comment - for longer than
 * the watchdog allows.
 *
 * Deliberately NOT a `StreamTransportError`. That one means the server
 * answered and said no, which is final. This one means we stopped hearing from
 * it, which says nothing about how the generation ended: on production the
 * chapter was persisted both times a stream went quiet. The caller's job is to
 * find out, by replaying the request id, not to report a failure.
 */
export class StreamStalledError extends Error {
  constructor(readonly silentForMs: number) {
    super(`The stream went silent for ${Math.round(silentForMs / 1000)}s`);
    this.name = "StreamStalledError";
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
 * surfaced as a `StreamTransportError` carrying the status and the body.
 *
 * A 2xx that is plain JSON is not an error either. Replaying a request id whose
 * generation already finished returns the finished payload as JSON, not as a
 * stream, and it resolves as `{ json }` so the caller can treat it as the
 * terminal result it is.
 *
 * # The stall watchdog
 *
 * With `stallTimeoutMs`, any silence longer than that - before the response
 * arrives or between two reads - aborts the request and rejects with
 * `StreamStalledError`. Every chunk resets it, keep-alive comments included:
 * the server writes one every ~15s (`backend/.../_shared/sse.ts`) precisely so
 * that a healthy stream is never silent for long, and a quiet one can be
 * called dead. Before this existed a dropped connection hung a reader's
 * spinner for 25 minutes on production.
 *
 * The watchdog races each await rather than trusting the abort alone: an
 * aborted `fetch` is only as prompt as the transport under it, and a read
 * pending on a half-open socket is exactly the case that never settles.
 */
export async function postEventStream(
  input: {
    url: string;
    headers: Record<string, string>;
    body: unknown;
    signal?: AbortSignal;
    onEvent: (event: SseEvent) => void;
    /** Fired once the server has accepted the request with a 2xx. */
    onOpen?: () => void;
    /** Reject with `StreamStalledError` after this long with no bytes. */
    stallTimeoutMs?: number;
  },
): Promise<{ json?: unknown }> {
  const abort = new AbortController();
  const forwardAbort = () => abort.abort();
  if (input.signal?.aborted) abort.abort();
  input.signal?.addEventListener("abort", forwardAbort);

  // The watchdog. `stalled` rejects the moment the timer fires, and every
  // await below races it, so a silent connection cannot hold this function
  // open no matter what the transport does with the abort.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectStalled: (error: StreamStalledError) => void = () => {};
  const stalled = new Promise<never>((_, reject) => {
    rejectStalled = reject;
  });
  // Nobody may be racing it at the instant it fires; that is not unhandled.
  stalled.catch(() => {});
  const armWatchdog = () => {
    if (input.stallTimeoutMs === undefined) return;
    if (timer !== undefined) clearTimeout(timer);
    const ms = input.stallTimeoutMs;
    timer = setTimeout(() => {
      abort.abort();
      rejectStalled(new StreamStalledError(ms));
    }, ms);
  };

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    armWatchdog();
    const pending = expoFetch(input.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...input.headers,
      },
      body: JSON.stringify(input.body),
      signal: abort.signal,
    });
    // Lost the race to the watchdog: its eventual abort rejection is expected.
    pending.catch(() => {});
    const response = await Promise.race([pending, stalled]);

    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      let payload: unknown;
      try {
        payload = await response.json();
        const named = (payload as { error?: unknown })?.error;
        if (typeof named === "string" && named.trim()) message = named;
      } catch {
        // A non-JSON error body tells us nothing the status has not already.
      }
      throw new StreamTransportError(message, response.status, payload);
    }

    input.onOpen?.();

    const contentType = response.headers?.get?.("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return { json: await Promise.race([response.json(), stalled]) };
    }

    if (!response.body) {
      // Reachable if this ever runs on a transport without stream support. Fail
      // loudly rather than hanging: a caller that silently never streams is the
      // exact failure this module exists to prevent.
      throw new StreamTransportError(
        "This device returned no readable stream for a streaming response",
      );
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      armWatchdog();
      const { done, value } = await Promise.race([reader.read(), stalled]);
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
    return {};
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    input.signal?.removeEventListener("abort", forwardAbort);
    if (reader) {
      if (abort.signal.aborted) {
        // Settles a read still pending on the dead connection, so the stream
        // is not left locked with a promise nobody will ever see.
        reader.cancel().catch(() => {});
      }
      try {
        reader.releaseLock();
      } catch {
        // A transport that refuses to release under a pending read; the
        // cancel above is what matters.
      }
    }
  }
}
