// The player only touches expo-av through the `createSound` it is given, so
// the real module is never called here -- but importing it pulls in a native
// module that does not exist under Jest.
jest.mock("expo-av", () => ({
  Audio: { Sound: { createAsync: jest.fn() } },
}));

import {
  CHUNK_PRELOAD_LEAD_MS,
  type ChunkEstimate,
  type ChunkPart,
  type ChunkPlayerStatus,
  createChunkPlayer,
  type CreateSound,
} from "@/lib/chunk-player";

/**
 * The chunk player, driven without expo-av, a device or a renderer.
 *
 * Everything here turns on what the player does at a *boundary*, and a boundary
 * is one `didJustFinish` callback -- so a fake `createAsync` that hands back the
 * status callback is the whole harness. `created` is in load order, which is
 * also how the tests assert that two sounds exist and never three.
 */

type FakeSound = {
  playAsync: jest.Mock;
  pauseAsync: jest.Mock;
  unloadAsync: jest.Mock;
  setPositionAsync: jest.Mock;
  setRateAsync: jest.Mock;
};

type Created = {
  uri: string;
  initial: Record<string, unknown>;
  sound: FakeSound;
  emit: (status: Record<string, unknown>) => void;
};

type HarnessOptions = {
  /** What is known about pieces that are not playable yet. */
  pending?: ChunkEstimate[];
  /** Urls whose load rejects, the way a deleted or expired part does. */
  failing?: string[];
  /** A url whose load hangs until `release()` is called. */
  hold?: string;
};

function harness(
  parts: ChunkPart[],
  totalChunks: number,
  options: HarnessOptions = {},
) {
  const created: Created[] = [];
  const statuses: ChunkPlayerStatus[] = [];
  const onFinish = jest.fn();
  const onError = jest.fn();
  const failing = new Set(options.failing ?? []);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  const createSound = jest.fn(
    async (
      source: { uri: string },
      initial: Record<string, unknown>,
      callback: (status: Record<string, unknown>) => void,
    ) => {
      if (options.hold === source.uri) await held;
      if (failing.has(source.uri)) {
        // What expo-av does with an object that is not there: the promise
        // rejects. The server's own failure path deletes the parts, so this
        // is reachable while a reader is mid-chapter.
        throw new Error("could not load audio");
      }
      const sound: FakeSound = {
        playAsync: jest.fn(async () => {}),
        pauseAsync: jest.fn(async () => {}),
        unloadAsync: jest.fn(async () => {}),
        setPositionAsync: jest.fn(async () => {}),
        setRateAsync: jest.fn(async () => {}),
      };
      created.push({
        uri: source.uri,
        initial,
        sound,
        emit: (status) =>
          callback({
            isLoaded: true,
            isPlaying: true,
            positionMillis: 0,
            ...status,
          }),
      });
      return { sound, status: { isLoaded: true } };
    },
  );

  const player = createChunkPlayer({
    parts,
    pending: options.pending,
    totalChunks,
    rate: 1,
    onStatus: (status) => statuses.push(status),
    onFinish,
    onError,
    createSound: createSound as unknown as CreateSound,
  });

  return {
    player,
    created,
    statuses,
    onFinish,
    onError,
    /** Every call, including the ones still held -- `created` only has the resolved ones. */
    createSound,
    loadsOf: (uri: string) =>
      createSound.mock.calls.filter((call) =>
        (call[0] as { uri: string }).uri === uri
      ).length,
    release: () => release(),
    last: () => statuses[statuses.length - 1],
  };
}

/** Let every queued promise settle; the player's boundary work is async. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
  }
}

const TWO_PARTS: ChunkPart[] = [
  { index: 0, url: "https://audio/c0.mp3", durationMs: 5_000, charCount: 100 },
  { index: 1, url: "https://audio/c1.mp3", durationMs: 7_000, charCount: 140 },
];

describe("one chapter, played in pieces", () => {
  it("starts on the first piece and reports one timeline across both", async () => {
    const h = harness(TWO_PARTS, 2);
    await h.player.start();
    expect(h.created).toHaveLength(1);
    expect(h.created[0].uri).toBe("https://audio/c0.mp3");

    h.created[0].emit({ positionMillis: 1_000, durationMillis: 5_000 });
    expect(h.last().positionMs).toBe(1_000);
    expect(h.last().durationMs).toBe(12_000);
    expect(h.last().durationIsProvisional).toBe(false);
  });

  it("preloads the next piece before the boundary, without playing it", async () => {
    // A realistic chunk is minutes long, so the lead is a small window at the
    // end of it rather than the whole thing.
    const h = harness(
      [
        { ...TWO_PARTS[0], durationMs: 60_000 },
        TWO_PARTS[1],
      ],
      2,
    );
    await h.player.start();

    // Comfortably inside the chunk: nothing to preload yet.
    h.created[0].emit({ positionMillis: 100, durationMillis: 60_000 });
    await flush();
    expect(h.created).toHaveLength(1);

    h.created[0].emit({
      positionMillis: 60_000 - CHUNK_PRELOAD_LEAD_MS + 1_000,
      durationMillis: 60_000,
    });
    await flush();
    expect(h.created).toHaveLength(2);
    expect(h.created[1].uri).toBe("https://audio/c1.mp3");
    expect(h.created[1].initial.shouldPlay).toBe(false);
  });

  it("swaps on didJustFinish with no pause in playback, and keeps two sounds", async () => {
    const h = harness(TWO_PARTS, 2);
    await h.player.start();
    h.created[0].emit({ positionMillis: 4_000, durationMillis: 5_000 });
    await flush();
    expect(h.created).toHaveLength(2);

    h.created[0].emit({
      positionMillis: 5_000,
      durationMillis: 5_000,
      didJustFinish: true,
    });
    await flush();

    expect(h.created[1].sound.playAsync).toHaveBeenCalled();
    // The piece that just ended is unloaded, so there are never three.
    expect(h.created[0].sound.unloadAsync).toHaveBeenCalled();
    expect(h.last().isPlaying).toBe(true);
    expect(h.last().waitingForChunk).toBe(false);
    // Position is cumulative: the start of the second piece is 5s in.
    expect(h.last().positionMs).toBe(5_000);
    expect(h.onFinish).not.toHaveBeenCalled();

    h.created[1].emit({ positionMillis: 2_000, durationMillis: 7_000 });
    expect(h.last().positionMs).toBe(7_000);
  });

  it("adopts a preload that is still in flight instead of loading the piece twice", async () => {
    // The boundary arrives while the preload for the very same piece is still
    // loading -- an eight-second lead against a chunk that takes longer than
    // that to fetch, which is a slow connection, not a rare one.
    const h = harness(
      [{ ...TWO_PARTS[0], durationMs: 60_000 }, TWO_PARTS[1]],
      2,
      { hold: "https://audio/c1.mp3" },
    );
    await h.player.start();

    h.created[0].emit({
      positionMillis: 60_000 - CHUNK_PRELOAD_LEAD_MS + 1_000,
      durationMillis: 60_000,
    });
    await flush();
    expect(h.loadsOf("https://audio/c1.mp3")).toBe(1);

    // The piece ends before that preload has resolved.
    h.created[0].emit({
      positionMillis: 60_000,
      durationMillis: 60_000,
      didJustFinish: true,
    });
    await flush();

    // **One load, not two.** The boundary used to start its own, so for as
    // long as both were in flight there were two fetches and two decoders for
    // one piece, and the handover landed on whichever resolved first.
    expect(h.loadsOf("https://audio/c1.mp3")).toBe(1);

    h.release();
    await flush();

    // And the adopted sound is the one that plays: it was loaded paused, the
    // way the standby slot always is, so the boundary has to start it.
    const second = h.created[1];
    expect(second.uri).toBe("https://audio/c1.mp3");
    expect(second.sound.playAsync).toHaveBeenCalled();
    expect(second.sound.unloadAsync).not.toHaveBeenCalled();
    expect(h.created).toHaveLength(2);
    expect(h.last().isPlaying).toBe(true);
    expect(h.last().waitingForChunk).toBe(false);
    expect(h.created[0].sound.unloadAsync).toHaveBeenCalled();
  });

  it("finishes the chapter once, at the end of the last piece", async () => {
    const h = harness(TWO_PARTS, 2);
    await h.player.start();
    h.created[0].emit({
      positionMillis: 5_000,
      durationMillis: 5_000,
      didJustFinish: true,
    });
    await flush();
    h.created[1].emit({
      positionMillis: 7_000,
      durationMillis: 7_000,
      didJustFinish: true,
    });
    await flush();

    expect(h.onFinish).toHaveBeenCalledTimes(1);
    expect(h.last().isPlaying).toBe(false);
  });
});

describe("a piece that has not been synthesized yet", () => {
  it("pauses at the boundary and says so rather than ending the chapter", async () => {
    const h = harness([TWO_PARTS[0]], 2);
    await h.player.start();
    h.created[0].emit({
      positionMillis: 5_000,
      durationMillis: 5_000,
      didJustFinish: true,
    });
    await flush();

    expect(h.last().waitingForChunk).toBe(true);
    expect(h.last().isPlaying).toBe(false);
    // Not the end of the chapter. The chapter is not over; the audio is.
    expect(h.onFinish).not.toHaveBeenCalled();
    expect(h.created).toHaveLength(1);
  });

  it("resumes by itself when a later poll brings that piece in", async () => {
    const h = harness([TWO_PARTS[0]], 2);
    await h.player.start();
    h.created[0].emit({
      positionMillis: 5_000,
      durationMillis: 5_000,
      didJustFinish: true,
    });
    await flush();
    expect(h.last().waitingForChunk).toBe(true);

    h.player.setParts(TWO_PARTS, 2);
    await flush();

    expect(h.created).toHaveLength(2);
    expect(h.created[1].uri).toBe("https://audio/c1.mp3");
    expect(h.created[1].initial.shouldPlay).toBe(true);
    expect(h.last().waitingForChunk).toBe(false);
    expect(h.last().isPlaying).toBe(true);
  });
});

describe("a piece that will not load", () => {
  it("reports the first piece failing instead of leaving a dead transport", async () => {
    // The screen calls this as `void player.start()`. A rejection with nobody
    // listening was an unhandled promise AND silence: the reader got a player
    // bar whose Play button did nothing, and no failure was ever dispatched.
    const h = harness(TWO_PARTS, 2, { failing: ["https://audio/c0.mp3"] });

    await expect(h.player.start()).resolves.toBeUndefined();

    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onError.mock.calls[0][0].index).toBe(0);
    expect(h.last().isPlaying).toBe(false);
  });

  it("stops at a boundary it cannot cross, and never reports playback that is not happening", async () => {
    // `failNarration` removes the parts while a reader may be streaming chunk
    // 0 from that same prefix, so a piece the manifest promised can be gone by
    // the time the boundary reaches it.
    const h = harness(TWO_PARTS, 2, { failing: ["https://audio/c1.mp3"] });
    await h.player.start();
    h.created[0].emit({
      positionMillis: 5_000,
      durationMillis: 5_000,
      didJustFinish: true,
    });
    await flush();

    expect(h.onError).toHaveBeenCalledTimes(1);
    expect(h.onError.mock.calls[0][0].index).toBe(1);
    // The defect this pins: `currentIndex` had advanced while `current` still
    // held the finished sound, so the bar said playing at 5,000ms of nothing.
    expect(h.last().isPlaying).toBe(false);
    expect(h.last().waitingForChunk).toBe(false);
    await h.player.play();
    expect(h.last().isPlaying).toBe(false);
    expect(h.created[0].sound.unloadAsync).toHaveBeenCalled();
  });
});

describe("scrubbing one timeline over several files", () => {
  it("seeks into the piece that holds that moment, at the right offset", async () => {
    const h = harness(TWO_PARTS, 2);
    await h.player.start();
    h.created[0].emit({ positionMillis: 500, durationMillis: 5_000 });

    await h.player.seek(8_000);
    await flush();

    const loaded = h.created[h.created.length - 1];
    expect(loaded.uri).toBe("https://audio/c1.mp3");
    expect(loaded.initial.positionMillis).toBe(3_000);
    expect(h.last().positionMs).toBe(8_000);
    expect(h.created[0].sound.unloadAsync).toHaveBeenCalled();
  });

  it("keeps the seek's position when it lands mid-boundary-load", async () => {
    // The boundary load is in flight (not preloaded) when the reader scrubs
    // backwards. That load resolves to nothing because the seek bumped the
    // token -- and it used to write `waiting` over the seek's own state, so
    // the next poll's `setParts` yanked the reader forward to the next piece
    // from wherever they had just scrubbed to.
    const h = harness(TWO_PARTS, 2, { hold: "https://audio/c1.mp3" });
    await h.player.start();
    h.created[0].emit({
      positionMillis: 5_000,
      durationMillis: 5_000,
      didJustFinish: true,
    });
    await flush();

    await h.player.seek(1_000);
    await flush();
    expect(h.last().positionMs).toBe(1_000);

    h.release();
    await flush();

    expect(h.last().waitingForChunk).toBe(false);
    expect(h.last().positionMs).toBe(1_000);

    // The poll that follows must not be read as "the piece you were waiting
    // for arrived".
    h.player.setParts(TWO_PARTS, 2);
    await flush();
    expect(h.last().positionMs).toBe(1_000);
  });

  it("stays in the current piece for a seek inside it", async () => {
    const h = harness(TWO_PARTS, 2);
    await h.player.start();

    await h.player.seek(2_000);
    await flush();

    expect(h.created).toHaveLength(1);
    expect(h.created[0].sound.setPositionAsync).toHaveBeenCalledWith(2_000);
  });
});

describe("a total that is not knowable yet", () => {
  it("estimates the tail from characters and flags it as provisional", async () => {
    const parts: ChunkPart[] = [
      { index: 0, url: "https://audio/c0.mp3", durationMs: null, charCount: 100 },
      { index: 1, url: "https://audio/c1.mp3", durationMs: null, charCount: 200 },
    ];
    const h = harness(parts, 3);
    await h.player.start();
    h.created[0].emit({ positionMillis: 0, durationMillis: 5_000 });

    // 50ms a character, measured off the piece that is actually playing.
    expect(h.last().durationMs).toBe(5_000 + 10_000);
    expect(h.last().durationIsProvisional).toBe(true);
  });
});

describe("a total that spans the chapter before the chapter exists", () => {
  it("counts pieces that are not synthesized yet, from their character counts", async () => {
    // The server sends `char_count` on unready manifest entries for exactly
    // this. Dropping them made the provisional total cover only what existed,
    // so the scrubber hit 100% of "~10:12" at the end of chunk 0 and then
    // jumped to "~20:00" when chunk 1 landed.
    const h = harness([TWO_PARTS[0]], 2, {
      pending: [{ index: 1, charCount: 140 }],
    });
    await h.player.start();
    h.created[0].emit({ positionMillis: 0, durationMillis: 5_000 });

    // 50ms a character off the piece that is playing: 5,000 + 140 x 50.
    expect(h.last().durationMs).toBe(12_000);
    expect(h.last().durationIsProvisional).toBe(true);
  });
});

describe("speed", () => {
  it("applies to the piece playing and the one already loaded behind it", async () => {
    const h = harness(TWO_PARTS, 2);
    await h.player.start();
    h.created[0].emit({ positionMillis: 4_000, durationMillis: 5_000 });
    await flush();

    await h.player.setRate(1.5);
    expect(h.created[0].sound.setRateAsync).toHaveBeenCalledWith(1.5, true);
    expect(h.created[1].sound.setRateAsync).toHaveBeenCalledWith(1.5, true);
  });
});

describe("leaving", () => {
  it("unloads both slots and stops answering", async () => {
    const h = harness(TWO_PARTS, 2);
    await h.player.start();
    h.created[0].emit({ positionMillis: 4_000, durationMillis: 5_000 });
    await flush();

    await h.player.dispose();
    expect(h.created[0].sound.unloadAsync).toHaveBeenCalled();
    expect(h.created[1].sound.unloadAsync).toHaveBeenCalled();

    const before = h.statuses.length;
    h.created[0].emit({
      positionMillis: 5_000,
      durationMillis: 5_000,
      didJustFinish: true,
    });
    await flush();
    expect(h.statuses).toHaveLength(before);
    expect(h.onFinish).not.toHaveBeenCalled();
  });
});
