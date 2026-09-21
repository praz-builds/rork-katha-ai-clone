import {
  canRetry,
  initialListenState,
  isWaiting,
  type ListenManifest,
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

  /*
    AND ASKS AGAIN. `checking` is not a polled phase, and the screen's
    acquisition effect depends on `attempt` and nothing else -- so returning to
    `checking` without bumping it changed the phase and re-ran nothing, and the
    reader was left on a loader that would never move for as long as they were
    willing to look at it.
  */
  it("bumps the attempt so the screen re-requests instead of sitting still", () => {
    const before = generating();
    const missing = listenReducer(before, {
      type: "outcome",
      outcome: { kind: "missing" },
      at: T0 + 3000,
    });
    expect(missing.attempt).toBe(before.attempt + 1);
    expect(missing.recoveries).toBe(1);
  });

  it("stops asking, and says so, after two vanished jobs", () => {
    let state = generating();
    for (let round = 0; round < 2; round += 1) {
      state = listenReducer(state, {
        type: "outcome",
        outcome: { kind: "missing" },
        at: T0 + 3000,
      });
      expect(state.phase).toBe("checking");
      // The screen re-opens on the new attempt, which is where the loop would
      // run away if `recoveries` were reset by it.
      state = listenReducer(state, { type: "open", at: T0 + 3100 });
      state = listenReducer(state, { type: "requesting", at: T0 + 3100 });
      state = listenReducer(state, {
        type: "outcome",
        outcome: { kind: "pending" },
        at: T0 + 3200,
      });
    }

    const third = listenReducer(state, {
      type: "outcome",
      outcome: { kind: "missing" },
      at: T0 + 4000,
    });
    expect(third.phase).toBe("failed");
    expect(third.errorCode).toBe("narration_job_missing");
    expect(canRetry(third.phase)).toBe(true);
  });

  it("a reader's own Try again restores the recovery allowance", () => {
    const spent = listenReducer(generating(), {
      type: "outcome",
      outcome: { kind: "missing" },
      at: T0 + 3000,
    });
    const retried = listenReducer(spent, { type: "retry", at: T0 + 5000 });
    expect(retried.recoveries).toBe(0);
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

describe("a chapter that can be listened to while it is still being made", () => {
  const manifest = (ready: number, total: number): ListenManifest => ({
    chunks: total,
    entries: Array.from({ length: ready }, (_, index) => ({
      index,
      url: `https://audio/c${index}.mp3`,
      durationMs: 45_000,
      charCount: 9_000,
    })),
  });

  it("plays the first chunk the moment it exists, without waiting for the rest", () => {
    const playing = listenReducer(generating(), {
      type: "outcome",
      outcome: { kind: "pending", manifest: manifest(1, 13) },
      at: T0 + 45_000,
    });
    expect(playing.phase).toBe("ready");
    expect(playing.audioUrl).toBe("https://audio/c0.mp3");
    expect(playing.manifest?.chunks).toBe(13);
  });

  it("KEEPS POLLING once it is playing, or the later chunks never arrive", () => {
    const playing = listenReducer(generating(), {
      type: "outcome",
      outcome: { kind: "pending", manifest: manifest(1, 13) },
      at: T0 + 45_000,
    });
    // The whole mechanism depends on this: chunk urls only ever come from a
    // poll, and a player stopped at chunk 0 is a chapter that plays 45 seconds
    // and stops.
    expect(shouldPoll(playing.phase, playing.manifest)).toBe(true);

    const complete = listenReducer(playing, {
      type: "outcome",
      outcome: { kind: "pending", manifest: manifest(13, 13) },
      at: T0 + 101_000,
    });
    expect(shouldPoll(complete.phase, complete.manifest)).toBe(false);
  });

  it("stays on a waiting phase while no chunk is playable yet", () => {
    const stillWaiting = listenReducer(generating(), {
      type: "outcome",
      outcome: { kind: "pending", manifest: manifest(0, 13) },
      at: T0 + 5_000,
    });
    expect(stillWaiting.phase).toBe("generating");
    expect(stillWaiting.manifest).toBeNull();
  });

  it("takes on the chunks a later poll brings, and never gives any back", () => {
    const playing = listenReducer(generating(), {
      type: "outcome",
      outcome: { kind: "pending", manifest: manifest(1, 13) },
      at: T0 + 45_000,
    });
    const grown = listenReducer(playing, {
      type: "outcome",
      outcome: { kind: "pending", manifest: manifest(4, 13) },
      at: T0 + 60_000,
    });
    expect(grown.manifest?.entries).toHaveLength(4);

    // A poll that answers with less than we are already playing is stale, not
    // a retraction.
    const stale = listenReducer(grown, {
      type: "outcome",
      outcome: { kind: "pending", manifest: manifest(2, 13) },
      at: T0 + 61_000,
    });
    expect(stale).toBe(grown);
  });

  it("does not swap to the stitched file halfway through playing the pieces", () => {
    const playing = listenReducer(generating(), {
      type: "outcome",
      outcome: { kind: "pending", manifest: manifest(1, 13) },
      at: T0 + 45_000,
    });
    const completed = listenReducer(playing, {
      type: "outcome",
      outcome: {
        kind: "ready",
        audioUrl: "https://audio/whole-chapter.mp3",
        manifest: manifest(13, 13),
      },
      at: T0 + 101_000,
    });
    // A playthrough commits to its source. The stitched file is the permanent
    // cache for the NEXT listen.
    expect(completed.audioUrl).toBe("https://audio/c0.mp3");
    expect(completed.manifest?.entries).toHaveLength(13);
  });

  it("ends the playthrough when the row goes terminally failed, rather than polling a dead chapter forever", () => {
    // Chunk 1 failed at the provider. Nothing will ever arrive, the parts have
    // been deleted, and "never fail backwards out of playback" would leave the
    // reader listening to chunk 0, then to silence, with the playhead parked
    // at the end and a poll running every 2.5 seconds for as long as the
    // screen is open.
    const playing = listenReducer(generating(), {
      type: "outcome",
      outcome: { kind: "pending", manifest: manifest(1, 13) },
      at: T0 + 45_000,
    });
    const dead = listenReducer(playing, {
      type: "outcome",
      outcome: { kind: "failed", errorCode: "narration_chunk_start_failed" },
      at: T0 + 70_000,
    });
    expect(dead.phase).toBe("failed");
    expect(dead.errorCode).toBe("narration_chunk_start_failed");
    expect(shouldPoll(dead.phase, dead.manifest)).toBe(false);
  });

  it("ends the playthrough when the row has gone (edit-story rewrote the chapter)", () => {
    const playing = listenReducer(generating(), {
      type: "outcome",
      outcome: { kind: "pending", manifest: manifest(1, 13) },
      at: T0 + 45_000,
    });
    const gone = listenReducer(playing, {
      type: "outcome",
      outcome: { kind: "missing" },
      at: T0 + 70_000,
    });
    expect(gone.phase).toBe("failed");
    expect(gone.errorCode).toBe("narration_job_missing");
    expect(shouldPoll(gone.phase, gone.manifest)).toBe(false);
  });

  it("keeps playing through a dropped poll: offline and unavailable are not terminal here", () => {
    // The opposite defect. A network blip or the entitlement gate says nothing
    // about the chunks already in hand, and dropping a reader out of playback
    // for one is the same mistake in the other direction.
    const playing = listenReducer(generating(), {
      type: "outcome",
      outcome: { kind: "pending", manifest: manifest(2, 13) },
      at: T0 + 45_000,
    });
    expect(
      listenReducer(playing, {
        type: "outcome",
        outcome: { kind: "offline" },
        at: T0 + 50_000,
      }),
    ).toBe(playing);
    expect(
      listenReducer(playing, {
        type: "outcome",
        outcome: { kind: "unavailable", message: "not yet" },
        at: T0 + 50_000,
      }),
    ).toBe(playing);
  });

  it("plays the stitched file for a narration that was already finished", () => {
    const cached = listenReducer(open(), {
      type: "cached",
      audioUrl: "https://audio/cached.mp3",
    });
    expect(cached.manifest).toBeNull();
    expect(shouldPoll(cached.phase, cached.manifest)).toBe(false);
  });

  it("plays the stitched file when the server sends no manifest at all", () => {
    const landed = listenReducer(generating(), {
      type: "outcome",
      outcome: { kind: "ready", audioUrl: "https://audio/legacy.mp3" },
      at: T0 + 101_000,
    });
    expect(landed.audioUrl).toBe("https://audio/legacy.mp3");
    expect(landed.manifest).toBeNull();
    expect(shouldPoll(landed.phase, landed.manifest)).toBe(false);
  });
});
