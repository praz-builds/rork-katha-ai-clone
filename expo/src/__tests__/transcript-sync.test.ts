import {
  buildCues,
  buildTranscriptLines,
  cueIndexAt,
  cueStartMs,
  estimateCues,
  formatClock,
} from "@/lib/transcript-sync";

const PARAGRAPHS = [
  "She opened the door. The hallway was dark.",
  "Somewhere below, a clock struck three.",
];

describe("splitting a chapter into transcript lines", () => {
  it("splits on sentence ends and remembers which paragraph a line came from", () => {
    const lines = buildTranscriptLines(PARAGRAPHS);
    expect(lines.map((line) => line.text)).toEqual([
      "She opened the door.",
      "The hallway was dark.",
      "Somewhere below, a clock struck three.",
    ]);
    expect(lines.map((line) => line.paragraphIndex)).toEqual([0, 0, 1]);
    expect(lines.map((line) => line.startsParagraph)).toEqual([true, false, true]);
    expect(lines.map((line) => line.index)).toEqual([0, 1, 2]);
  });

  it("keeps a trailing fragment with no full stop rather than dropping it", () => {
    const lines = buildTranscriptLines(["A first line. And then"]);
    expect(lines.map((line) => line.text)).toEqual(["A first line.", "And then"]);
  });

  it("produces nothing for empty prose", () => {
    expect(buildTranscriptLines([])).toEqual([]);
    expect(buildTranscriptLines(["   "])).toEqual([]);
  });
});

describe("the proportional estimate", () => {
  it("gives a longer line a longer slice, in proportion to its length", () => {
    const lines = buildTranscriptLines(["ab. abcdefgh."]);
    const cues = estimateCues(lines, 1000);
    // Weights are 3 ("ab.") and 9 ("abcdefgh."), so the split is 250/750.
    expect(cues[0].startMs).toBeCloseTo(0);
    expect(cues[0].endMs).toBeCloseTo(250);
    expect(cues[1].startMs).toBeCloseTo(250);
    expect(cues[1].endMs).toBe(1000);
  });

  it("tiles the whole duration with no gaps and no overhang", () => {
    const lines = buildTranscriptLines(PARAGRAPHS);
    const cues = estimateCues(lines, 60_000);
    expect(cues[0].startMs).toBe(0);
    expect(cues[cues.length - 1].endMs).toBe(60_000);
    for (let i = 1; i < cues.length; i += 1) {
      expect(cues[i].startMs).toBe(cues[i - 1].endMs);
    }
  });

  it("returns no cues at all when the duration is not known yet", () => {
    const lines = buildTranscriptLines(PARAGRAPHS);
    expect(estimateCues(lines, 0)).toEqual([]);
    expect(estimateCues(lines, Number.NaN)).toEqual([]);
    // Which the screen renders as an unhighlighted transcript, not as a
    // highlight parked on line one.
    expect(cueIndexAt(estimateCues(lines, 0), 5000)).toBe(-1);
  });

  it("never gives a line a zero-width slice it could not be active in", () => {
    const lines = buildTranscriptLines(["Yes. " + "x".repeat(500) + "."]);
    const cues = estimateCues(lines, 10_000);
    cues.forEach((cue) => expect(cue.endMs).toBeGreaterThan(cue.startMs));
  });
});

describe("real timings win over the estimate", () => {
  it("uses supplied timings when the pipeline provides them", () => {
    const lines = buildTranscriptLines(PARAGRAPHS);
    const cues = buildCues(lines, 60_000, [
      { index: 0, startMs: 0, endMs: 1200 },
      { index: 1, startMs: 1200, endMs: 4000 },
      { index: 2, startMs: 4000, endMs: 9000 },
    ]);
    expect(cues.map((cue) => cue.endMs)).toEqual([1200, 4000, 9000]);
  });

  it("falls back to the estimate when no timings are supplied", () => {
    const lines = buildTranscriptLines(PARAGRAPHS);
    expect(buildCues(lines, 60_000)).toEqual(estimateCues(lines, 60_000));
  });

  it("drops a supplied timing that points at no line", () => {
    const lines = buildTranscriptLines(["Only one sentence."]);
    const cues = buildCues(lines, 5000, [
      { index: 0, startMs: 0, endMs: 5000 },
      { index: 9, startMs: 5000, endMs: 6000 },
    ]);
    expect(cues).toHaveLength(1);
  });
});

describe("finding the line being read", () => {
  const lines = buildTranscriptLines(PARAGRAPHS);
  const cues = estimateCues(lines, 30_000);

  it("clamps to the first line before the audio starts", () => {
    expect(cueIndexAt(cues, -500)).toBe(0);
    expect(cueIndexAt(cues, 0)).toBe(0);
  });

  it("clamps to the last line at and past the end", () => {
    expect(cueIndexAt(cues, 30_000)).toBe(cues.length - 1);
    expect(cueIndexAt(cues, 99_999)).toBe(cues.length - 1);
  });

  it("finds the line whose span contains the playhead", () => {
    cues.forEach((cue) => {
      const middle = (cue.startMs + cue.endMs) / 2;
      expect(cueIndexAt(cues, middle)).toBe(cue.index);
    });
  });

  it("answers -1 when there is nothing to highlight", () => {
    expect(cueIndexAt([], 1000)).toBe(-1);
  });

  it("hands back a line's start so tapping it can seek there", () => {
    expect(cueStartMs(cues, 1)).toBe(cues[1].startMs);
    expect(cueStartMs(cues, 42)).toBeNull();
  });
});

describe("the clock", () => {
  it("formats minutes and seconds, and hours only past an hour", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(9_000)).toBe("0:09");
    expect(formatClock(65_000)).toBe("1:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
  });

  it("refuses to render nonsense", () => {
    expect(formatClock(-1)).toBe("0:00");
    expect(formatClock(Number.NaN)).toBe("0:00");
  });
});
