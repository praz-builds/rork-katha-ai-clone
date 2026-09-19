/**
 * The response half of every streamed endpoint: SSE framing, a keep-alive
 * heartbeat, and a close that cannot be forgotten.
 *
 * # Why a heartbeat
 *
 * Observed on production on 2026-09-18: twice a `continue-story` stream went
 * silent and the reader's spinner sat there for ~25 minutes. The chapter had in
 * fact been written and persisted -- replaying the same `request_id` later
 * handed it back as plain JSON -- but nothing ever reached the client to say
 * so. Two things were missing at once. The server sent nothing between the
 * last `delta` and the terminal event (the metadata call and the persist run
 * with the stream open and quiet for tens of seconds), so a connection that a
 * proxy or a mobile radio had silently dropped looked exactly like a slow
 * one. And the client had no way to tell those apart, because silence was the
 * normal state of a healthy stream.
 *
 * A comment frame (`: keep-alive`) every ~15s makes silence abnormal. The
 * client's stall watchdog (`expo/src/lib/stream.ts`) can then treat ~45s of no
 * bytes -- three missed heartbeats -- as a dead connection rather than a busy
 * server, and recover by replaying the request id. Without the heartbeat that
 * watchdog would have to be set longer than the longest quiet stretch the
 * pipeline ever produces, which is the 180s stream deadline, and a reader
 * would still be staring at a spinner for three minutes.
 *
 * A comment is the SSE spec's own keep-alive: every conforming parser drops it,
 * ours included (`parseSseFrame` returns null for a comment-only frame), so an
 * older client that knows nothing about heartbeats is unaffected.
 *
 * # Why one helper rather than four copies
 *
 * `generate-story-stream`, `continue-story`, `reimagine-chapter` and
 * `edit-story` each hand-rolled the same `send`/`close` pair, and they had
 * already drifted: two of them latched `closed` when the reader hung up and two
 * did not, so in `reimagine-chapter` a reader who backgrounded the app turned
 * the next `enqueue` into a throw inside the generation's own `try` -- the
 * rewrite was abandoned and refunded instead of finishing and persisting. With
 * the client now deliberately hanging up on a stalled stream and replaying the
 * id, finishing after a disconnect is no longer an edge case: it is the
 * recovery path, and every endpoint has to get it right. A timer that must be
 * cleared on every exit path is exactly the kind of thing four copies get
 * wrong one at a time.
 */

/** How often a keep-alive comment is written while a stream is open. */
export const SSE_HEARTBEAT_MS = 15_000;

/**
 * The heartbeat frame. A comment line plus the blank line that terminates a
 * frame, so it can never merge into the event that follows it.
 */
export const SSE_KEEP_ALIVE_FRAME = ": keep-alive\n\n";

export interface SseChannel {
  /** Write one named event. A no-op once the stream is closed or the reader left. */
  send(event: string, data: unknown): void;
  /** True once the stream closed or the reader hung up. Nothing will be delivered. */
  readonly closed: boolean;
}

export interface SseStreamOptions {
  /** Overridable for tests; production always uses `SSE_HEARTBEAT_MS`. */
  heartbeatMs?: number;
}

/**
 * Build the body of a streamed response.
 *
 * `run` does the generation and emits events through the channel. The
 * heartbeat starts the moment the stream opens and stops, and the stream
 * closes, when `run` settles -- whichever way it settles -- or when the reader
 * cancels. `run` is never interrupted by a disconnect: a chapter that is
 * already paid for still has to be written and persisted, because the replay
 * of its request id is how the reader gets it back.
 */
export function sseStream(
  run: (channel: SseChannel) => Promise<void>,
  options: SseStreamOptions = {},
): ReadableStream<Uint8Array> {
  const heartbeatMs = options.heartbeatMs ?? SSE_HEARTBEAT_MS;
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stopHeartbeat = () => {
    if (heartbeat !== undefined) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The READER hung up. `cancel()` below normally sees it first, but
          // an enqueue can race it; either way the answer is the same. Latch
          // it so the rest of the run is silent no-ops rather than a throw per
          // event, and stop the heartbeat, which has nobody left to keep alive.
          closed = true;
          stopHeartbeat();
        }
      };

      const channel: SseChannel = {
        send(event, data) {
          write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        },
        get closed() {
          return closed;
        },
      };

      heartbeat = setInterval(() => write(SSE_KEEP_ALIVE_FRAME), heartbeatMs);

      try {
        await run(channel);
      } catch (error) {
        // Every handler owns its failure path and sends its own `error` event;
        // reaching here means one of those paths itself threw. Logged rather
        // than rethrown, because a rejected `start` would error a stream that
        // the `finally` below is about to close cleanly.
        console.error("SSE stream body threw:", error);
      } finally {
        stopHeartbeat();
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Already cancelled by the reader between the check and the call.
          }
        }
      }
    },
    cancel() {
      // The client went away: the watchdog aborted a stalled read, the app was
      // backgrounded, or the radio dropped. The run keeps going (see above);
      // only the delivery stops.
      closed = true;
      stopHeartbeat();
    },
  });
}
