import {
  canRetry,
  initialListenState,
  isWaiting,
  type ListenState,
  listenCopy,
  listenReducer,
  NARRATION_EXPECTED_MS,
  NARRATION_OVERDUE_MS,
  shouldPoll,
} from "@/lib/listen-machine";

const T0 = 1_000_000;

function open(): ListenState {
  return listenReducer(initialListenState, { type: "open", at: T0 });
}

function requesting(): ListenState {
  return listenReducer(open(), { type: "requesting", at: T0 });
}

function generating(): ListenState {
  return listenReducer(requesting(), {
    type: "outcome",
    outcome: { kind: "pending" },
    at: T0 + 500,
  });
}

describe("the stages advance on real work, not on a timer", () => {
  it("walks checking -> requesting -> generating -> ready as the server answers", () => {
    expect(open().phase).toBe("checking");
    expect(requesting().phase).toBe("requesting");
    expect(generating().phase).toBe("generating");

    const ready = listenReducer(generating(), {
      type: "outcome",
      outcome: { kind: "ready", audioUrl: "https://audio/x.mp3" },
      at: T0 + 4000,
    });
    expect(ready.phase).toBe("ready");
    expect(ready.audioUrl).toBe("https://audio/x.mp3");
  });

  it("says something different at every stage, so the screen never sits mute", () => {
    const stages = ["checking", "requesting", "generating", "slow", "overdue"] as const;
    const statuses = stages.map((phase) => listenCopy(phase).status);
    expect(new Set(statuses).size).toBe(stages.length);
    statuses.forEach((status) => expect(status.trim().length).toBeGreaterThan(0));
  });

  it("skips the request entirely when narration is already on the chapter", () => {
    const cached = listenReducer(open(), {
      type: "cached",
      audioUrl: "https://audio/cached.mp3",
    });
    expect(cached.phase).toBe("ready");
    expect(cached.audioUrl).toBe("https://audio/cached.mp3");
  });
});

describe("time is only ever used to admit the wait is long", () => {
  it("holds at generating right up to the stated expectation", () => {
    const nearly = listenReducer(generating(), {
      type: "tick",
      at: T0 + NARRATION_EXPECTED_MS - 1,
    });
    expect(nearly.phase).toBe("generating");
  });

  it("goes slow at the expectation and overdue well past it", () => {
    const slow = listenReducer(generating(), {
      type: "tick",
      at: T0 + NARRATION_EXPECTED_MS,
    });
    expect(slow.phase).toBe("slow");

    const overdue = listenReducer(slow, {
      type: "tick",
      at: T0 + NARRATION_OVERDUE_MS,
    });
    expect(overdue.phase).toBe("overdue");
  });

  it("keeps polling while overdue, because a late job should still play", () => {
    expect(shouldPoll("overdue")).toBe(true);
    const landed = listenReducer(
      { ...generating(), phase: "overdue", elapsedMs: NARRATION_OVERDUE_MS },
      {
        type: "outcome",
        outcome: { kind: "ready", audioUrl: "https://audio/late.mp3" },
        at: T0 + NARRATION_OVERDUE_MS + 5000,
      },
    );
    expect(landed.phase).toBe("ready");
  });

  it("never ticks a screen that has already finished", () => {
    const failed = listenReducer(generating(), {
      type: "outcome",
      outcome: { kind: "failed", errorCode: "provider_failed" },
      at: T0 + 3000,
    });
    expect(listenReducer(failed, { type: "tick", at: T0 + 999_999 }))
      .toBe(failed);
  });
});

describe("every refusal has its own ending", () => {
  it("treats the entitlement gate as an explanation, not a fault, and offers no retry", () => {
    const refused = listenReducer(requesting(), {
      type: "outcome",
      outcome: { kind: "unavailable", message: "Narration unlock is not available yet" },
      at: T0 + 800,
    });
    expect(refused.phase).toBe("unavailable");
    expect(refused.message).toBe("Narration unlock is not available yet");
    expect(canRetry(refused.phase)).toBe(false);
  });

  it("offers a retry for a provider failure and for being offline", () => {
    expect(canRetry("failed")).toBe(true);
    expect(canRetry("offline")).toBe(true);
  });

  it("keeps the failure code, so the report says which failure it was", () => {
    const failed = listenReducer(generating(), {
      type: "outcome",
      outcome: { kind: "failed", errorCode: "generation_timed_out" },
      at: T0 + 9000,
    });
    expect(failed.errorCode).toBe("generation_timed_out");
  });

  it("goes back to checking when the job it was polling has vanished", () => {
    const missing = listenReducer(generating(), {
      type: "outcome",
      outcome: { kind: "missing" },
      at: T0 + 3000,
    });
    expect(missing.phase).toBe("checking");
    expect(shouldPoll(missing.phase)).toBe(false);
  });
});

describe("late answers cannot resurrect a finished screen", () => {
  it("ignores an outcome that arrives after the screen already failed", () => {
    const failed = listenReducer(generating(), {
      type: "outcome",
      outcome: { kind: "failed", errorCode: null },
      at: T0 + 2000,
    });
    const late = listenReducer(failed, {
      type: "outcome",
      outcome: { kind: "pending" },
      at: T0 + 2500,
    });
    expect(late).toBe(failed);
    expect(late.phase).toBe("failed");
  });

  it("ignores a `requesting` echo once the screen has moved on", () => {
    const g = generating();
    expect(listenReducer(g, { type: "requesting", at: T0 + 1000 })).toBe(g);
  });
});

describe("retry", () => {
  it("starts the whole acquisition over and counts the attempt", () => {
    const failed = listenReducer(generating(), {
      type: "outcome",
      outcome: { kind: "failed", errorCode: "provider_failed" },
      at: T0 + 2000,
    });
    const again = listenReducer(failed, { type: "retry", at: T0 + 10_000 });
    expect(again.phase).toBe("checking");
    expect(again.errorCode).toBeNull();
    expect(again.elapsedMs).toBe(0);
    expect(again.startedAt).toBe(T0 + 10_000);
    expect(again.attempt).toBe(failed.attempt + 1);
  });
});

describe("which phases are a wait", () => {
  it("counts every preparing phase and no terminal one", () => {
    expect(isWaiting("checking")).toBe(true);
    expect(isWaiting("requesting")).toBe(true);
    expect(isWaiting("generating")).toBe(true);
    expect(isWaiting("slow")).toBe(true);
    expect(isWaiting("overdue")).toBe(true);
    expect(isWaiting("ready")).toBe(false);
    expect(isWaiting("failed")).toBe(false);
    expect(isWaiting("unavailable")).toBe(false);
    expect(isWaiting("offline")).toBe(false);
  });

  it("does not poll before anything has been requested", () => {
    expect(shouldPoll("checking")).toBe(false);
    expect(shouldPoll("requesting")).toBe(false);
    expect(shouldPoll("generating")).toBe(true);
  });
});
