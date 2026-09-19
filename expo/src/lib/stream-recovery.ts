/**
 * What to do when a generation stream goes quiet: ask the server how it ended.
 *
 * # Why recover instead of failing
 *
 * Observed on production on 2026-09-18: twice a `continue-story` stream went
 * silent and the reader waited ~25 minutes on a spinner. Both times the chapter
 * had been written and persisted; replaying the same `request_id` afterwards
 * returned it as plain JSON. The generation did not fail. The connection did,
 * and the client had no way to learn the difference.
 *
 * The request id is the whole answer. Every generation endpoint is idempotent
 * on it (`generation_operations`), and a replay tells the caller exactly where
 * the work stands without charging again:
 *
 * | replay answer                                   | meaning                     |
 * |-------------------------------------------------|-----------------------------|
 * | 200, plain JSON with the chapter                | finished - use it as `done` |
 * | 409 "already in progress" / `status: reserved`  | still running - ask again   |
 * | 409 "previous generation failed" / `refunded`   | failed, credit returned     |
 *
 * So a stalled stream is not an error to show; it is a question to ask. Failing
 * it instead would tell a reader their chapter was lost while the server was
 * holding it for them, and their retry - under a fresh id - would buy it twice.
 *
 * # Why bounded
 *
 * The server's own stream deadline is 180s (`STREAM_DEADLINE_MS`), so a
 * generation still "in progress" three minutes after the stream died is not
 * going to finish in any time a reader will wait. A reservation abandoned by a
 * dead isolate is reconciled to `refunded` after five minutes, on the next
 * replay - which is the reader's own retry, under the same id, and it gets the
 * honest answer then.
 *
 * Kept apart from `api.ts` so it can be tested with nothing but a fetch mock,
 * and so it cannot import `GenerationRequestError` and grow opinions about UI
 * copy: it reports a verdict and the caller decides what the reader is told.
 */

import { fetch as expoFetch } from "expo/fetch";

/**
 * No bytes for this long and the stream is presumed dead.
 *
 * Three missed heartbeats: the server writes a keep-alive comment every ~15s
 * (`_shared/sse.ts`). Long enough that a slow provider handshake or a brief
 * radio handover never trips it, short enough that the reader is not left
 * wondering.
 */
export const STREAM_STALL_TIMEOUT_MS = 45_000;

/**
 * The waits between replays while the server says "still in progress".
 *
 * The first replay goes out immediately, because the likeliest reason for a
 * stall late in a chapter is that the work is already done and only the last
 * events were lost. After that it backs off, since each replay is a request
 * against a function the reader's own generation may still be running in.
 * Sums to 179s: about the server's 180s stream deadline, after which "in
 * progress" no longer means anything a reader should wait for.
 */
export const REPLAY_BACKOFF_MS: readonly number[] = [
  2_000,
  4_000,
  8_000,
  15_000,
  30_000,
  30_000,
  30_000,
  30_000,
  30_000,
];

/**
 * One replay is a lookup, not a generation, and answers in well under a
 * second. One that takes this long is itself a dead connection and is counted
 * as "no answer yet", not waited on - otherwise the recovery could hang in
 * exactly the way the stream it is recovering did.
 */
export const REPLAY_ATTEMPT_TIMEOUT_MS = 20_000;

export type ReplayVerdict =
  | { kind: "done"; payload: Record<string, unknown> }
  | { kind: "pending" }
  | { kind: "failed"; message: string; resetRequestId: boolean };

export type RecoveryOutcome =
  | Exclude<ReplayVerdict, { kind: "pending" }>
  | { kind: "exhausted" };

/**
 * Read one replay answer.
 *
 * Shared by the replay loop and by the first request itself: a reader's retry
 * of an id that is still running gets the same 409 a replay would, and should
 * be answered the same way - by waiting for the result, not by an error.
 */
export function classifyReplayResponse(
  status: number,
  body: unknown,
): ReplayVerdict {
  const payload = body && typeof body === "object"
    ? body as Record<string, unknown>
    : null;

  if (status >= 200 && status < 300) {
    // The finished payload. Anything else under a 2xx is not a shape any
    // generation endpoint returns, and asking again is the harmless reading.
    return payload ? { kind: "done", payload } : { kind: "pending" };
  }

  const message = typeof payload?.error === "string" && payload.error.trim()
    ? payload.error
    : `Request failed (${status})`;

  if (status === 409) {
    // Refunded is checked first and by its structured fields, because the
    // wording differs by endpoint: `reimagine-chapter` says "The previous
    // rewrite failed" where the others say "generation". What they share is
    // that the id is spent - a replay will only ever repeat the failure - so
    // the retry must mint a new one.
    if (
      payload?.status === "refunded" ||
      payload?.code === "operation_refunded" ||
      /start a new request/i.test(message)
    ) {
      return { kind: "failed", message, resetRequestId: true };
    }
    if (
      payload?.status === "reserved" ||
      payload?.code === "chapter_generating" ||
      // "Generation is already in progress.", "This chapter is already being
      // rewritten.", and the reservation race's "Generation already
      // completed; retry with the same request ID." - which is precisely
      // what the next replay does.
      /in progress|already being|already completed/i.test(message)
    ) {
      return { kind: "pending" };
    }
    return { kind: "failed", message, resetRequestId: false };
  }

  // The recovery path's own 503 ("Generation recovery is pending retry."), a
  // gateway hiccup, a rate limit: none of them says how the generation ended.
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return { kind: "pending" };
  }

  // 401, 402, 404 and the rest are the server deciding, and it will decide the
  // same way next time.
  return { kind: "failed", message, resetRequestId: false };
}

/**
 * Replay a request once and classify the answer.
 *
 * The body is sent unchanged, `stream: true` included, so the server takes the
 * same path it took the first time. For an id it already knows, every endpoint
 * answers a replay as plain JSON before it would open a stream. If it answers
 * with a stream anyway, the id was never reserved - the first request died
 * before reaching the server - and this replay has just started the
 * generation for real. That stream is let go (the server finishes and persists
 * without a listener) and the next replay collects the result.
 */
export async function replayOnce(input: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  timeoutMs?: number;
}): Promise<ReplayVerdict> {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      abort.abort();
      resolve("timeout");
    }, input.timeoutMs ?? REPLAY_ATTEMPT_TIMEOUT_MS);
  });

  try {
    const request = (async (): Promise<ReplayVerdict> => {
      const response = await expoFetch(input.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...input.headers,
        },
        body: JSON.stringify(input.body),
        signal: abort.signal,
      });
      const contentType = response.headers?.get?.("content-type") ?? "";
      if (response.ok && contentType.includes("text/event-stream")) {
        response.body?.cancel().catch(() => {});
        return { kind: "pending" };
      }
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // An unreadable body classifies on its status alone.
      }
      return classifyReplayResponse(response.status, body);
    })();
    // Losing the race to the timer means an abort rejection nobody awaits.
    request.catch(() => {});

    const answer = await Promise.race([request, timedOut]);
    return answer === "timeout" ? { kind: "pending" } : answer;
  } catch {
    // Offline, DNS, a reset: no answer is not a "no".
    return { kind: "pending" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Replay until the server says finished or failed, or the budget runs out.
 *
 * `headers` is a function because a recovery can outlive an access token: the
 * stream that stalled may have been open for minutes, and a stale bearer would
 * turn "still in progress" into a 401 that reads as a failure.
 */
export async function recoverByReplay(input: {
  url: string;
  headers: () => Promise<Record<string, string>>;
  body: unknown;
  backoffMs?: readonly number[];
  attemptTimeoutMs?: number;
}): Promise<RecoveryOutcome> {
  const backoff = input.backoffMs ?? REPLAY_BACKOFF_MS;
  for (let attempt = 0; ; attempt += 1) {
    const verdict = await replayOnce({
      url: input.url,
      headers: await input.headers(),
      body: input.body,
      timeoutMs: input.attemptTimeoutMs,
    });
    if (verdict.kind !== "pending") return verdict;
    if (attempt >= backoff.length) return { kind: "exhausted" };
    await new Promise((resolve) => setTimeout(resolve, backoff[attempt]));
  }
}
