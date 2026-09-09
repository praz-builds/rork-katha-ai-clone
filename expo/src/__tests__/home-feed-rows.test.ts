/**
 * What Home is made of, checked at the seam that decides it.
 *
 * `buildFeedRows` is a pure function so that "which rows, in which order" is
 * a fact about data rather than about render timing. The one rule these
 * tests exist for: the writer's own stories lead the page once there are
 * any, and the row does not exist before that.
 */
import { buildFeedRows, yourStories } from "@/screens/HomeScreen";
import { stories } from "@/data/seed";
import type { Story } from "@/types/domain";

const mine = (overrides: Partial<Story>): Story => ({
  ...stories[0],
  id: `mine-${Math.random().toString(36).slice(2)}`,
  authorId: "viewer",
  isFeatured: false,
  ...overrides,
});

it("has no 'Your stories' row for a reader who has written nothing", () => {
  const rows = buildFeedRows(stories, []);
  expect(rows.find((row) => row.key === "yours")).toBeUndefined();
  expect(rows[0].key).toBe("originals");
});

it("leads with 'Your stories' once the reader owns a story with a chapter", () => {
  const written = mine({ chapters: stories[0].chapters.slice(0, 1) });
  const rows = buildFeedRows(stories, [], [written]);

  expect(rows[0]).toMatchObject({ key: "yours", title: "Your stories" });
  expect(rows[0].stories.map((story) => story.id)).toEqual([written.id]);
  // The house picks still follow; nothing else moved.
  expect(rows[1].key).toBe("originals");
});

// A story reaches the client whole or not at all - a chapter is one
// request/response and is persisted complete - so "no chapter yet" is the
// only unready state there is, and it is simply absent from the rail.
it("leaves out a story that has no chapter yet", () => {
  const empty = mine({ chapters: [] });
  const written = mine({ chapters: stories[0].chapters.slice(0, 1) });

  expect(yourStories([empty, written]).map((story) => story.id)).toEqual([written.id]);
  expect(buildFeedRows(stories, [], [empty]).find((row) => row.key === "yours"))
    .toBeUndefined();
});

it("keeps the caller's order, newest first", () => {
  const newer = mine({ chapters: stories[0].chapters.slice(0, 1) });
  const older = mine({ chapters: stories[0].chapters.slice(0, 1) });
  const rows = buildFeedRows(stories, [], [newer, older]);

  expect(rows[0].stories.map((story) => story.id)).toEqual([newer.id, older.id]);
});
