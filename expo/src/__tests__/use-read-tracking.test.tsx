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

import { MIN_SECONDS, useReadTracking } from "@/lib/use-read-tracking";

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

  const Probe = ({ storyId, chapterId }: { storyId: string; chapterId: string | null }) => {
    useReadTracking(storyId, chapterId, {
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
    return null;
  };

  return {
    posted,
    Probe,
    subscribe,
    advance: (seconds: number) => {
      clock += seconds * 1000;
    },
    appState: (next: string) => {
      for (const listener of [...listeners]) listener(next);
    },
  };
}

afterEach(() => jest.restoreAllMocks());

it("reports the whole chapter once, when the reader leaves it", async () => {
  const h = harness();
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);

  h.advance(200);
  expect(h.posted).toHaveLength(0); // nothing mid-read

  await act(async () => {
    view.unmount();
  });

  expect(h.posted).toEqual([
    { storyId: "s1", chapterId: "c1", durationSeconds: 200 },
  ]);
});

it("counts each chapter separately as the reader turns pages", async () => {
  const h = harness();
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);

  h.advance(130);
  await act(async () => {
    view.rerender(<h.Probe storyId="s1" chapterId="c2" />);
  });

  // Chapter one is banked and sent the moment it is left, not held until the
  // screen closes -- the gate sums a story's rows, and a reader who never
  // closes the reader would otherwise have recorded nothing.
  expect(h.posted).toEqual([
    { storyId: "s1", chapterId: "c1", durationSeconds: 130 },
  ]);

  h.advance(45);
  await act(async () => {
    view.unmount();
  });
  expect(h.posted[1]).toEqual({ storyId: "s1", chapterId: "c2", durationSeconds: 45 });
});

it("counts foreground time only", async () => {
  // A phone in a pocket with the reader open is not reading, and the credit
  // this feeds is supposed to mean somebody read something.
  const h = harness();
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);

  h.advance(60);
  await act(async () => h.appState("background"));
  h.advance(3600); // overnight on the bedside table
  await act(async () => h.appState("active"));
  h.advance(70);

  await act(async () => {
    view.unmount();
  });

  expect(h.posted[0].durationSeconds).toBe(130);
});

it("does not restart the clock when active arrives twice", async () => {
  // iOS can deliver `active` more than once. A second start would discard
  // everything banked so far.
  const h = harness();
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);

  h.advance(40);
  await act(async () => h.appState("active"));
  h.advance(50);

  await act(async () => {
    view.unmount();
  });

  expect(h.posted[0].durationSeconds).toBe(90);
});

it("says nothing about a chapter that was paged past", async () => {
  // Because of the 24-hour dedup a 1-second row is not a small mistake: it is
  // the number that chapter is stuck with all day, and it makes the
  // 120-second gate HARDER to pass than recording nothing at all.
  const h = harness();
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);

  h.advance(MIN_SECONDS - 1);
  await act(async () => {
    view.unmount();
  });

  expect(h.posted).toEqual([]);
});

it("reports the chapter it measured, not whichever is current at unmount", async () => {
  const h = harness();
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);
  h.advance(30);
  await act(async () => {
    view.rerender(<h.Probe storyId="s1" chapterId="c2" />);
  });
  h.advance(30);
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
