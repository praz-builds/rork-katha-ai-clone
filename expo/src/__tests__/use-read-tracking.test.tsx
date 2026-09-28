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
 * So: one row per chapter, carrying the largest honest number, counting
 * foreground time only, and nothing at all for a chapter that was paged past.
 *
 * NOT "at the end". The comment box is inside the reader, so a reader who
 * comments at the bottom of a chapter never leaves it and a row written on the
 * way out lands after the comment the gate is comparing it to. It posts at 120
 * seconds, or when the composer takes focus and that would clear the gate, and
 * only falls back to the exit for a chapter that never got there.
 */
import React from "react";
import { AppState } from "react-native";
import { act, render } from "@testing-library/react-native";

import { MIN_SECONDS, POST_AT_SECONDS, useReadTracking } from "@/lib/use-read-tracking";

type Posted = { storyId: string; chapterId: string | null; durationSeconds: number };

/** What the server said. The default is a written row. */
type Reply = { recorded: boolean; counted: boolean } | null;

/**
 * Drives the hook and lets a test move the clock and the app state by hand.
 *
 * `reply` is how the tests below reach the three answers that are not "a row
 * was written": a deduped read (`recorded: false`, which the server returns
 * with a 200 and no update to the stored duration), a failure (`null`), and a
 * request that has not answered yet.
 */
function harness(reply: (n: number) => Reply | Promise<Reply> = () => ({
  recorded: true,
  counted: true,
})) {
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
        return await reply(posted.length - 1);
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
  //
  // THIS TEST USED TO ASSERT NOTHING. `now: () => 0` is zero dwell, under
  // `MIN_SECONDS`, so the threshold never came and the endpoint was never
  // called -- it proved that a call that did not happen did not throw. It
  // matters here: `post` is async and every caller fires it as a bare `void`,
  // so a seam that REJECTS rather than resolving null is an unhandled
  // rejection, and the real `recordRead` catches its own so nothing else in
  // the suite can reach that path.
  let clock = 0;
  const failing = jest.fn().mockRejectedValue(new Error("offline"));
  const Probe = () => {
    useReadTracking("s1", "c1", {
      now: () => clock,
      recordRead: failing as never,
    });
    return null;
  };
  const view = await render(<Probe />);

  clock += POST_AT_SECONDS * 1000;
  await act(async () => {
    jest.advanceTimersByTime(POST_AT_SECONDS * 1000);
  });
  expect(failing).toHaveBeenCalledTimes(1);

  clock += 60_000;
  await act(async () => {
    view.unmount();
  });
  // The threshold post rejected, so `posted` is still false and the cleanup
  // tries again -- and reaching here at all is the rest of the assertion.
  expect(failing).toHaveBeenCalledTimes(2);
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
  // Two chapters of 70, so the flush has a story total that clears the gate.
  const h = harness();
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);
  await h.advance(70);
  await act(async () => {
    view.rerender(<h.Probe storyId="s1" chapterId="c2" />);
  });
  await h.advance(70);

  await act(async () => h.composerFocus());
  await act(async () => h.composerFocus());

  expect(h.posted).toHaveLength(2);
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

// THE REGRESSION THIS TEST USED TO PIN, now pointing the other way.
//
// It asserted that a focus at 70 seconds wrote 70 and cancelled the timer.
// That is a claim destroyed: the dedup means 70 is the number that chapter
// keeps for the day, the 120 the gate tests for never arrives, and a reader who
// then types for two minutes and posts is told to read the story first -- on a
// one-chapter story, which is a supported shape, and it PAID before the flush
// was added. `MIN_SECONDS` is a floor for "was this a page turn", not for
// "can this row satisfy a 120-second sum".
it("leaves the timer to it when focusing early would lock the chapter short", async () => {
  const h = harness();
  await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(100);
  await act(async () => h.composerFocus());
  expect(h.posted).toEqual([]); // nothing written: 100 would not clear the gate

  // The timer is still armed, so the row that does clear it still arrives.
  await h.advance(20);
  expect(h.posted).toEqual([
    { storyId: "s1", chapterId: "c1", durationSeconds: POST_AT_SECONDS },
  ]);
});

it("keeps every path armed when a post fails", async () => {
  // `recordRead` swallows failures and resolves null, so an attempt used to be
  // indistinguishable from a written row -- and the timer, the flush and the
  // cleanup all bail on `posted`. One dropped request at the 120-second mark
  // meant the reader could read for another twenty minutes and leave with no
  // row, no read_count and no streak day.
  const attempts: number[] = [];
  let failing = true;
  const Probe = () => {
    useReadTracking("s1", "c1", {
      now: () => Date.now(),
      recordRead: async (input) => {
        attempts.push(input.durationSeconds);
        return failing ? null : { recorded: true, counted: true };
      },
    });
    return null;
  };

  const view = await render(<Probe />);
  await act(async () => {
    jest.advanceTimersByTime(POST_AT_SECONDS * 1000);
  });
  expect(attempts).toEqual([POST_AT_SECONDS]);

  // The threshold post failed, so the cleanup tries again rather than assuming
  // the row is there.
  failing = false;
  await act(async () => {
    view.unmount();
  });
  expect(attempts).toHaveLength(2);
});

// ── The mirror must never read above the server ───────────────────────────
//
// The flush's guard is "does this chapter's dwell, plus what the story already
// has, clear 120". If the local number is higher than the server's, the guard
// passes on seconds that do not exist and the flush does the exact thing it
// was added to prevent: writes a short row and takes the timer with it.
//
// Two ways it used to drift, one test each.

it("does not count a deduped read, which the server threw away", async () => {
  // A re-read inside 24 hours answers `recorded: false` with a 200 and leaves
  // the stored duration alone -- there is no `update` in that branch. Paging
  // back one chapter was enough to reach it.
  const h = harness((n) => ({ recorded: n !== 1, counted: true }));
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(70); // ch1: 70 written, story total 70
  await act(async () => {
    view.rerender(<h.Probe storyId="s1" chapterId="c2" />);
  });
  await h.advance(60); // ch2: 60 posted, DEDUPED -- the server still has 70
  await act(async () => {
    view.rerender(<h.Probe storyId="s1" chapterId="c3" />);
  });
  await h.advance(10);
  expect(h.posted).toHaveLength(2);

  // 70 + 10 = 80, so this must not write. Counting the deduped 60 would make
  // it 140, and ch3 would be locked at 10 for the day with its timer gone.
  await act(async () => h.composerFocus());
  expect(h.posted).toHaveLength(2);

  // The timer still delivers the row that actually clears the gate.
  await h.advance(POST_AT_SECONDS - 10);
  expect(h.posted[2]).toEqual({
    storyId: "s1",
    chapterId: "c3",
    durationSeconds: POST_AT_SECONDS,
  });
});

it("keeps the timer when the flush's own request fails", async () => {
  // `clearTimer` used to run before the request. A flush that failed then left
  // `posted` false with nothing left to fire, and the composer is inside the
  // reader, so the cleanup that would have retried never runs either.
  const h = harness((n) => (n === 1 ? null : { recorded: true, counted: true }));
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(70);
  await act(async () => {
    view.rerender(<h.Probe storyId="s1" chapterId="c2" />);
  });
  await h.advance(55);

  await act(async () => h.composerFocus()); // 70 + 55 clears the guard, and fails
  expect(h.posted).toHaveLength(2);

  await h.advance(POST_AT_SECONDS - 55);
  expect(h.posted[2]).toEqual({
    storyId: "s1",
    chapterId: "c2",
    durationSeconds: POST_AT_SECONDS,
  });
});

it("credits a late reply to the story it was measured on, not the one now open", async () => {
  // The cleanup does not await its post, and React runs the old effect's
  // cleanup BEFORE the new effect's body. So on a `storyId` that changes
  // without a remount -- `App.tsx` renders `ReaderScreen` with no `key`, and
  // its fallback chain can swap the story in place -- the order is:
  // cleanup(A) fires, effect(B) zeroes the counter, A's reply lands.
  //
  // Without the guard B's mirror starts at A's 120. Six seconds in, the reader
  // taps the comment box, `120 + 6 >= 120` passes, and B's first chapter is
  // written as a SIX-SECOND row with its timer cancelled -- locked there for
  // the day by the dedup. Ten minutes of reading B, and "read the story
  // first", permanently.
  let release: ((value: Reply) => void) | null = null;
  const h = harness(
    (n) =>
      n === 0
        ? new Promise<Reply>((resolve) => {
            release = resolve;
          })
        : { recorded: true, counted: true },
  );
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(POST_AT_SECONDS); // s1 posts 120, and does not answer yet
  await act(async () => {
    view.rerender(<h.Probe storyId="s2" chapterId="c1" />);
  });
  await act(async () => {
    release?.({ recorded: true, counted: true });
  });

  // s2 has banked nothing, so a focus six seconds in must write nothing for
  // s2. (s1's cleanup posts again on the swap -- it is exempt from `inFlight`
  // and the server dedups it -- so what matters here is s2's own rows.)
  await h.advance(6);
  await act(async () => h.composerFocus());
  expect(h.posted.filter((row) => row.storyId === "s2")).toEqual([]);

  // And s2's own timer still delivers the row that clears the gate.
  await h.advance(POST_AT_SECONDS - 6);
  expect(h.posted.filter((row) => row.storyId === "s2")).toEqual([
    { storyId: "s2", chapterId: "c1", durationSeconds: POST_AT_SECONDS },
  ]);
});

it("still writes the read when a slow threshold post fails and the reader leaves", async () => {
  // `inFlight` must not silence the cleanup. The cleanup is the last thing
  // there is -- no timer, no subscription, nothing after it -- so skipping it
  // while a request is still out loses the read outright if that request then
  // fails. Letting it through is safe because the server serialises on
  // `pg_advisory_xact_lock(user, chapter)` before it looks for a row, so a
  // duplicate cannot write twice; the loser is answered `recorded: false`.
  let fail: ((value: Reply) => void) | null = null;
  const h = harness(
    (n) =>
      n === 0
        ? new Promise<Reply>((resolve) => {
            fail = resolve;
          })
        : { recorded: true, counted: true },
  );
  const view = await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(POST_AT_SECONDS); // out on the wire, unanswered
  expect(h.posted).toHaveLength(1);

  await h.advance(1);
  await act(async () => {
    view.unmount();
  });
  await act(async () => {
    fail?.(null);
  });

  // The threshold post failed after the reader had gone. The cleanup's own
  // attempt is the only one left, and it must have happened.
  expect(h.posted).toHaveLength(2);
  expect(h.posted[1].storyId).toBe("s1");
});

it("writes the composer's read even while the threshold post is still out", async () => {
  // THE CASE AN IN-FLIGHT GUARD USED TO COST, on a one-chapter story where the
  // reader never leaves -- which is this hook's whole premise.
  //
  // The guard was argued for on the grounds that the timer is still armed. It
  // is not: `armTimer` sets `timer = null` from inside its own callback before
  // calling `post`, so when the request on the wire IS the threshold post,
  // there is nothing behind the guard. The sequence was: timer fires at 120,
  // request is slow, reader taps the comment box at 125 and is refused, the
  // request fails at 140, and nothing is left to fire. Comment at 300, sum 0,
  // "read the story first" -- permanently, because the comment's timestamp
  // never moves.
  //
  // A duplicate costs one request; the server serialises on
  // `pg_advisory_xact_lock(user, chapter)` before it looks for a row.
  let fail: ((value: Reply) => void) | null = null;
  const h = harness(
    (n) =>
      n === 0
        ? new Promise<Reply>((resolve) => {
            fail = resolve;
          })
        : { recorded: true, counted: true },
  );
  await render(<h.Probe storyId="s1" chapterId="c1" />);

  await h.advance(POST_AT_SECONDS); // fires, and does not answer
  expect(h.posted).toHaveLength(1);

  await h.advance(5);
  await act(async () => h.composerFocus());
  // The row that makes the claim payable, written while the first is still out.
  expect(h.posted).toHaveLength(2);
  expect(h.posted[1]).toEqual({
    storyId: "s1",
    chapterId: "c1",
    durationSeconds: POST_AT_SECONDS + 5,
  });

  await act(async () => {
    fail?.(null);
  });
  expect(h.posted).toHaveLength(2);
});
