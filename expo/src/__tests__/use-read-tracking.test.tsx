/**
 * The read tracker, tested on the rules that make the number mean something.
 *
 * WHY THE NUMBER MATTERS MORE THAN USUAL. The server deduplicates per user and
 * chapter over 24 hours, so **the first duration a chapter is given is the one
 * it keeps for the rest of the day.** A wrong number here is not a wrong
 * number, it is a wrong number that cannot be corrected — and the thing it
 * feeds is a credit gate that needs 120 seconds. Under-reporting silently
 * denies somebody a credit they earned; over-reporting pays for reading nobody
 * did.
 *
 * So: one post per chapter, at the end, counting foreground time only, and
 * nothing at all for a chapter that was paged past.
 */
import React from "react";
import { AppState } from "react-native";
import { act, render } from "@testing-library/react-native";

import { MIN_SECONDS, POST_AT_SECONDS, useReadTracking } from "@/lib/use-read-tracking";

type Posted = { storyId: string; chapterId: string | null; durationSeconds: number };

/** Drives the hook and lets a test move the clock and the app state by hand. */
function harness() {
  const posted: Posted[] = [];
  let clock = 1_000_000;

  const listeners: ((s: string) => void)[] = [];
  // `spyOn` on an already-spied method hands back the SAME spy, call history
  // and all, so without this the counts accumulate across the file and the
  // subscription assertion below reads every earlier test's subscribes.
  const subscribe = jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event: string, handler: (s: never) => void) => {
      listeners.push(handler as (s: string) => void);
      return {
        remove: () => {
          const at = listeners.indexOf(handler as (s: string) => void);
          if (at >= 0) listeners.splice(at, 1);
        },
      } as never;
    });

  subscribe.mockClear();

  let flush: () => void = () => {};
  const Probe = ({ storyId, chapterId }: { storyId: string; chapterId: string | null }) => {
    const tracking = useReadTracking(storyId, chapterId, {
      now: () => clock,
      recordRead: async (input) => {
        posted.push({
          storyId: input.storyId,
          chapterId: input.chapterId ?? null,
          durationSeconds: input.durationSeconds,
        });
        return { recorded: true, counted: true };
      },
    });
    flush = tracking.flushNow;
    return null;
  };

  return {
    posted,
    Probe,
    composerFocus: () => flush(),
    subscribe,
    /** Move the clock AND let any timer that is now due fire. */
    advance: async (seconds: number) => {
      clock += seconds * 1000;
      await act(async () => {
        jest.advanceTimersByTime(seconds * 1000);
      });
    },
    appState: (next: string) => {
      for (const listener of [...listeners]) listener(next);
    },
  };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// A chapter the reader leaves before the threshold is reported on the way out,
// with its real dwell. This is what feeds `read_count` and the streak for a
// short read -- and 90 seconds fails the credit gate exactly as 0 would, so
// recording it costs the reader nothing.
it("reports a short chapter on the way out, with its real dwell", async () => {
  const h = harness();
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(90);
  expect(h.posted).toHaveLength(0); // nothing yet: under the threshold

  await act(async () => {
    view.unmount();
  });

  expect(h.posted).toEqual([
    { storyId: "s1", chapterId: "c1", durationSeconds: 90 },
  ]);
});

it("counts each chapter separately as the reader turns pages", async () => {
  const h = harness();
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(70);
  await act(async () => {
    view.rerender(<h.Probe storyId="s1" chapterId="c2" />);
  });

  // Chapter one is banked and sent the moment it is left, not held until the
  // screen closes -- the gate sums a story's rows, and a reader who never
  // closes the reader would otherwise have recorded nothing.
  expect(h.posted).toEqual([
    { storyId: "s1", chapterId: "c1", durationSeconds: 70 },
  ]);

  // And the next chapter starts from zero rather than inheriting the first
  // one's time, which would post it at the threshold 50 seconds early.
  await h.advance(45);
  await act(async () => {
    view.unmount();
  });
  expect(h.posted[1]).toEqual({ storyId: "s1", chapterId: "c2", durationSeconds: 45 });
});

it("excludes background time from the dwell it reports", async () => {
  // A phone in a pocket with the reader open is not reading, and the credit
  // this feeds is supposed to mean somebody read something.
  const h = harness();
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(40);
  await act(async () => h.appState("background"));
  await h.advance(3600); // overnight on the bedside table
  await act(async () => h.appState("active"));
  await h.advance(30);

  await act(async () => {
    view.unmount();
  });

  expect(h.posted[0].durationSeconds).toBe(70);
});

it("does not restart the clock when active arrives twice", async () => {
  // iOS can deliver `active` more than once. A second start would discard
  // everything banked so far.
  const h = harness();
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(40);
  await act(async () => h.appState("active"));
  await h.advance(35);

  await act(async () => {
    view.unmount();
  });

  expect(h.posted[0].durationSeconds).toBe(75);
});

it("says nothing about a chapter that was paged past", async () => {
  // Because of the 24-hour dedup a 1-second row is not a small mistake: it is
  // the number that chapter is stuck with all day, and it makes the
  // 120-second gate HARDER to pass than recording nothing at all.
  const h = harness();
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(MIN_SECONDS - 1);
  await act(async () => {
    view.unmount();
  });

  expect(h.posted).toEqual([]);
});

it("reports the chapter it measured, not whichever is current at unmount", async () => {
  const h = harness();
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);
  await h.advance(30);
  await act(async () => {
    view.rerender(<h.Probe storyId="s1" chapterId="c2" />);
  });
  await h.advance(30);
  await act(async () => {
    view.unmount();
  });

  expect(h.posted.map((p) => p.chapterId)).toEqual(["c1", "c2"]);
});

it("removes its app-state listener when the chapter changes", async () => {
  // One subscription per chapter, or a long reading session accumulates a
  // listener per page turn and every one of them banks into a dead closure.
  const h = harness();
  const removals: number[] = [];
  h.subscribe.mockImplementation(() => {
    return { remove: () => removals.push(1) } as never;
  });

  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);
  await act(async () => {
    view.rerender(<h.Probe storyId="s1" chapterId="c2" />);
  });
  await act(async () => {
    view.unmount();
  });

  expect(h.subscribe).toHaveBeenCalledTimes(2);
  expect(removals).toHaveLength(2);
});

it("never throws into the reader when the endpoint fails", async () => {
  // Nothing a reader can see depends on this, and an error about telemetry
  // over a story they are reading would be worse than the missing row.
  const failing = jest.fn().mockRejectedValue(new Error("offline"));
  const Probe = () => {
    useReadTracking("s1", "c1", {
      now: () => 0,
      recordRead: failing as never,
    });
    return null;
  };
  const view = await render(<Probe />);
  await act(async () => {
    view.unmount();
  });
  // Reaching here without an unhandled rejection is the assertion.
  expect(failing).not.toHaveBeenCalled(); // 0 seconds is under the minimum
});

// ── The bug the first version of this hook shipped ────────────────────────
//
// The comment box is INSIDE the reader: `ChapterSocial` renders at the end of
// the chapter with its own composer. So somebody who reads a chapter and says
// something at the bottom of it never leaves, and a hook that only flushed on
// the way out wrote the row AFTER the comment. The gate sums reads with
// `read_at < comment.created_at`, so the sum was zero and the claim was
// refused -- "Read the story first", after ten minutes on the chapter.
//
// It could not heal: the comment's timestamp is fixed, and the 24-hour dedup
// means no later read can produce an earlier row. A one-chapter story could
// never qualify at all.
it("reports the read while the reader is still on the chapter", async () => {
  const h = harness();
  await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(POST_AT_SECONDS - 1);
  expect(h.posted).toHaveLength(0);

  await h.advance(1);

  // Posted without leaving, so the row exists before the composer is used.
  expect(h.posted).toEqual([
    { storyId: "s1", chapterId: "c1", durationSeconds: POST_AT_SECONDS },
  ]);
});

it("does not post a second time when the reader finally leaves", async () => {
  // The server dedups per chapter over 24 hours, so a second call tells it
  // nothing -- and the first row keeps its duration regardless.
  const h = harness();
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(600);
  expect(h.posted).toHaveLength(1);

  await act(async () => {
    view.unmount();
  });
  expect(h.posted).toHaveLength(1);
});

it("counts only foreground time towards the threshold", async () => {
  // Two minutes on the bedside table is not two minutes of reading, and the
  // credit this feeds is meant to mean somebody read something.
  const h = harness();
  await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(60);
  await act(async () => h.appState("background"));
  await h.advance(3600);
  expect(h.posted).toHaveLength(0);

  await act(async () => h.appState("active"));
  await h.advance(59);
  expect(h.posted).toHaveLength(0);

  await h.advance(1);
  expect(h.posted).toHaveLength(1);
});

// ── The shape the threshold cannot reach ──────────────────────────────────
//
// Two chapters that each stay under 120 seconds. Chapter 1 flushes on the page
// turn; chapter 2 is still mounted when the reader starts typing, so it has no
// row at all and the sum is 70 over 140 seconds of real reading. The composer
// taking focus is the one moment on the path to a claim that a clock cannot
// see, and the gate counts only reads recorded BEFORE the comment exists.
it("writes the current chapter's read when the composer takes focus", async () => {
  const h = harness();
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(70);
  await act(async () => {
    view.rerender(<h.Probe storyId="s1" chapterId="c2" />);
  });
  await h.advance(70);

  // Chapter 2 has nothing recorded yet.
  expect(h.posted).toHaveLength(1);

  await act(async () => h.composerFocus());

  expect(h.posted).toHaveLength(2);
  expect(h.posted[1]).toEqual({ storyId: "s1", chapterId: "c2", durationSeconds: 70 });
});

it("does not write a second row when the composer is focused twice", async () => {
  // The server would dedup it anyway; asking twice is just a wasted request.
  const h = harness();
  await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(70);
  await act(async () => h.composerFocus());
  await act(async () => h.composerFocus());

  expect(h.posted).toHaveLength(1);
});

it("writes nothing when the composer is focused on a chapter barely opened", async () => {
  // Same reason as the floor everywhere else: under the dedup, a one-second
  // row is the number that chapter is stuck with for the day.
  const h = harness();
  await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(MIN_SECONDS - 1);
  await act(async () => h.composerFocus());

  expect(h.posted).toEqual([]);
});

it("leaves the threshold post alone when the composer was focused first", async () => {
  const h = harness();
  await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(70);
  await act(async () => h.composerFocus());
  // The timer is cancelled by the flush, so crossing 120 adds nothing.
  await h.advance(300);

  expect(h.posted).toHaveLength(1);
  expect(h.posted[0].durationSeconds).toBe(70);
});
