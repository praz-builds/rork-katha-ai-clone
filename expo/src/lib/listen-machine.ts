/**
 * The Listen screen's state machine.
 *
 * Pure on purpose: no timers, no fetches, no React. Everything that decides
 * *what the reader is told* lives here so it can be tested against the real
 * sequence of server answers rather than against a stopwatch. The screen owns
 * the polling loop and feeds this reducer the outcomes it gets back; the
 * reducer owns the phase, and the phase owns the words.
 *
 * ## The stages are real
 *
 * `checking` -> `requesting` -> `generating` are three genuinely different
 * things happening, in order, and each one advances only when the previous one
 * actually finished:
 *
 * - `checking`  -- resolving which voice this reader listens in, and whether
 *                  narration for that voice already exists on the chapter.
 * - `requesting`-- `generate-audio` has been called and has not answered yet.
 *                  It is deciding entitlement and claiming the row.
 * - `generating`-- the server accepted the job (HTTP 202 / `PENDING`) and
 *                  RunPod is reading the chapter. `audio-status` is polling.
 *
 * Nothing here is driven by a timer pretending to be progress. The two places
 * time *is* used are `slow` and `overdue`, and both are honest statements about
 * the clock rather than claims about the work: "this has now taken longer than
 * we said it would" and "this has taken so much longer that you should be
 * offered a way out".
 */

/**
 * How long a first narration is expected to take.
 *
 * **This is an expectation band, not a measurement.** Nothing in the repository
 * records how long `minimax-speech-02-hd` takes on a real chapter, so this
 * number is a conservative statement of what the reader should brace for, and
 * the copy under the loader says "usually" rather than naming seconds.
 *
 * It is deliberately the *same* constant that flips the screen into `slow`. The
 * expectation the screen states and the moment it admits the expectation was
 * wrong can therefore never drift apart: correct this one number once narration
 * is measured in production and both move together.
 */
export const NARRATION_EXPECTED_MS = 60_000;

/**
 * When to stop reassuring and start offering a way out.
 *
 * `audio-status` fails a job itself once it goes stale (`NARRATION_JOB_STALE_MS`
 * on the backend), so `overdue` is not a substitute for that timeout -- it is
 * the point at which the *reader* should be told plainly that this is wrong and
 * given somewhere else to be. Polling continues underneath.
 */
export const NARRATION_OVERDUE_MS = 180_000;

/**
 * How many times a vanished narration job is silently re-requested.
 *
 * `missing` means the row being polled is not there -- reclaimed as stale, or
 * never written. Asking again is the right answer, and it is what the screen
 * now does; but a backend losing every job would otherwise leave this screen
 * requesting forever behind a loader that never changes. Two recoveries, then
 * the reader is told plainly and handed Try again, which is the same honesty
 * `overdue` exists for.
 */
export const MAX_NARRATION_RECOVERIES = 2;

export type ListenPhase =
  | "checking"
  | "requesting"
  | "generating"
  | "slow"
  | "overdue"
  | "ready"
  | "failed"
  | "unavailable"
  | "offline";

export type ListenState = {
  phase: ListenPhase;
  /** Playable URL, once there is one. */
  audioUrl: string | null;
  /** Server-supplied failure code, for the report and for support. */
  errorCode: string | null;
  /** Server-supplied refusal wording, when the server had one. */
  message: string | null;
  /** When the wait began, in `Date.now()` terms. Null before it does. */
  startedAt: number | null;
  /** How long the wait has run. Drives `slow` and `overdue` and nothing else. */
  elapsedMs: number;
  /** How many times the reader has asked for this narration in this session. */
  attempt: number;
  /**
   * How many times a vanished job has sent this screen back to `checking`.
   *
   * Counted apart from `attempt`, which is the reader's own Try again presses:
   * this one bounds an automatic loop, and sharing a counter would let someone
   * who pressed Try again twice exhaust a recovery allowance they never used.
   */
  recoveries: number;
};

/** Outcome shape from `@/lib/narration`, restated structurally so this module stays dependency-free. */
export type ListenOutcome =
  | { kind: "ready"; audioUrl: string; cached?: boolean }
  | { kind: "pending" }
  | { kind: "failed"; errorCode: string | null }
  | { kind: "unavailable"; message: string }
  | { kind: "missing" }
  | { kind: "offline" };

export type ListenEvent =
  /** The screen opened, or the reader moved to another chapter. */
  | { type: "open"; at: number }
  /** Narration for the chosen voice was already on the chapter row. No request needed. */
  | { type: "cached"; audioUrl: string }
  /** `generate-audio` has been called. */
  | { type: "requesting"; at: number }
  /** Either function answered. */
  | { type: "outcome"; outcome: ListenOutcome; at: number }
  /** A second of wall clock passed. */
  | { type: "tick"; at: number }
  /** The reader pressed Try again. */
  | { type: "retry"; at: number };

export const initialListenState: ListenState = {
  phase: "checking",
  audioUrl: null,
  errorCode: null,
  message: null,
  startedAt: null,
  elapsedMs: 0,
  attempt: 0,
  recoveries: 0,
};

/** Phases where work is still in flight and the loader is on screen. */
const WAITING: readonly ListenPhase[] = [
  "checking",
  "requesting",
  "generating",
  "slow",
  "overdue",
];

export function isWaiting(phase: ListenPhase): boolean {
  return WAITING.includes(phase);
}

/**
 * Should the screen keep polling `audio-status`?
 *
 * `checking` is excluded: nothing has been requested yet, so there is no job to
 * poll. `overdue` is included -- the reader has been offered a way out, but a
 * job that finishes at 200 seconds should still start playing for whoever
 * decided to wait.
 */
export function shouldPoll(phase: ListenPhase): boolean {
  return phase === "generating" || phase === "slow" || phase === "overdue";
}

/**
 * Is Try again worth offering?
 *
 * `unavailable` is not retryable and must never grow a retry button: the
 * entitlement gate will answer exactly the same way the second time, and a
 * button that cannot succeed is worse than no button. `failed` and `offline`
 * are both worth another attempt.
 */
export function canRetry(phase: ListenPhase): boolean {
  return phase === "failed" || phase === "offline";
}

/** Escalate a waiting phase by the clock. Never touches a terminal phase. */
function byElapsed(phase: ListenPhase, elapsedMs: number): ListenPhase {
  if (phase !== "generating" && phase !== "slow" && phase !== "overdue") {
    return phase;
  }
  if (elapsedMs >= NARRATION_OVERDUE_MS) return "overdue";
  if (elapsedMs >= NARRATION_EXPECTED_MS) return "slow";
  return "generating";
}

export function listenReducer(
  state: ListenState,
  event: ListenEvent,
): ListenState {
  switch (event.type) {
    case "open":
      return {
        ...initialListenState,
        startedAt: event.at,
        attempt: state.attempt,
        recoveries: state.recoveries,
      };

    case "retry":
      return {
        ...initialListenState,
        startedAt: event.at,
        attempt: state.attempt + 1,
        // A reader's own retry is a fresh start, allowance of automatic
        // recoveries included.
        recoveries: 0,
      };

    case "cached":
      return {
        ...state,
        phase: "ready",
        audioUrl: event.audioUrl,
        errorCode: null,
        message: null,
      };

    case "requesting":
      // Only from `checking`. A `requesting` event arriving on a screen that
      // has already failed or already has audio is a late echo of a request
      // that was abandoned, and must not drag the screen back into a wait.
      if (state.phase !== "checking") return state;
      return {
        ...state,
        phase: "requesting",
        startedAt: state.startedAt ?? event.at,
      };

    case "outcome": {
      // A terminal screen ignores late answers for the same reason.
      if (!isWaiting(state.phase)) return state;
      const elapsedMs = state.startedAt === null
        ? state.elapsedMs
        : Math.max(0, event.at - state.startedAt);
      switch (event.outcome.kind) {
        case "ready":
          return {
            ...state,
            phase: "ready",
            audioUrl: event.outcome.audioUrl,
            errorCode: null,
            message: null,
            elapsedMs,
          };
        case "pending":
          return {
            ...state,
            phase: byElapsed(
              state.phase === "generating" || state.phase === "slow" ||
                state.phase === "overdue"
                ? state.phase
                : "generating",
              elapsedMs,
            ),
            elapsedMs,
          };
        case "missing": {
          // The job being polled does not exist. Go back to `checking` AND
          // bump `attempt`, because `attempt` is the only thing the screen's
          // acquisition effect depends on: without the bump the phase changed
          // and nothing re-ran, and `checking` is not a polled phase either,
          // so the screen sat on a loader that would never move again.
          if (state.recoveries >= MAX_NARRATION_RECOVERIES) {
            return {
              ...state,
              phase: "failed",
              errorCode: "narration_job_missing",
              elapsedMs,
            };
          }
          return {
            ...state,
            phase: "checking",
            attempt: state.attempt + 1,
            recoveries: state.recoveries + 1,
            elapsedMs,
          };
        }
        case "failed":
          return {
            ...state,
            phase: "failed",
            errorCode: event.outcome.errorCode,
            elapsedMs,
          };
        case "unavailable":
          return {
            ...state,
            phase: "unavailable",
            message: event.outcome.message,
            elapsedMs,
          };
        case "offline":
          return { ...state, phase: "offline", elapsedMs };
      }
      return state;
    }

    case "tick": {
      if (!isWaiting(state.phase) || state.startedAt === null) return state;
      const elapsedMs = Math.max(0, event.at - state.startedAt);
      const phase = byElapsed(state.phase, elapsedMs);
      if (phase === state.phase && elapsedMs === state.elapsedMs) return state;
      return { ...state, phase, elapsedMs };
    }
  }
}

export type ListenCopy = {
  /** The line that changes as the work progresses. */
  status: string;
  /** The honest expectation, or the honest admission that it was wrong. */
  detail: string;
};

/**
 * What the screen says, per phase.
 *
 * Kept beside the reducer rather than in the component so a test can assert
 * that the words move when the work does -- the specific defect this screen
 * replaces was a sheet that said nothing at all while a real wait ran.
 */
export function listenCopy(phase: ListenPhase): ListenCopy {
  switch (phase) {
    case "checking":
      return {
        status: "Finding your narrator",
        detail: "Checking whether this chapter has already been read aloud.",
      };
    case "requesting":
      return {
        status: "Asking for the narration",
        detail: "Nobody has listened to this chapter yet, so it has to be read.",
      };
    case "generating":
      return {
        status: "Reading the chapter aloud",
        detail: "First listen only. This usually takes under a minute.",
      };
    case "slow":
      return {
        status: "Still reading",
        detail:
          "This is taking longer than it usually does. It is still running.",
      };
    case "overdue":
      return {
        status: "This is taking much longer than it should",
        detail:
          "You can keep waiting, or come back later — the narration finishes on our side either way.",
      };
    case "ready":
      return { status: "Ready", detail: "" };
    case "failed":
      return {
        status: "The narration did not finish",
        detail: "Nothing was lost. You can ask for it again.",
      };
    case "unavailable":
      return {
        status: "Narration is not available yet",
        detail:
          "This chapter has not been recorded, and new narration is switched off right now. Reading it is always free.",
      };
    case "offline":
      return {
        status: "No connection",
        detail:
          "Narration has to be fetched. Reconnect and try again — the chapter itself is already here to read.",
      };
  }
}
