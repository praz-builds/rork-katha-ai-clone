/**
 * What Home is made of, checked at the seam that decides it.
 *
 * `buildFeedRows` is a pure function so that "which rows, in which order" is
 * a fact about data rather than about render timing.
 *
 * The order is a product decision and these tests are where it is written
 * down: Your stories, then Continue reading, then Katha Originals, then one
 * rail per genre the reader chose in onboarding - with the generic
 * Trending/Most loved cuts surviving only for a reader who chose none.
 */
import { buildFeedRows, continueReading, yourStories } from "@/screens/HomeScreen";
import { stories } from "@/data/seed";
import { genreLabels } from "@/theme";
import type { Genre, Story } from "@/types/domain";

const mine = (overrides: Partial<Story>): Story => ({
  ...stories[0],
  id: `mine-${Math.random().toString(36).slice(2)}`,
  authorId: "viewer",
  isFeatured: false,
  ...overrides,
});

/** A genre that actually has seed stories behind it, so the rail is not empty. */
const populatedGenre = (): Genre => stories[0].genre;

describe("the order of the page", () => {
  it("has no 'Your stories' row for a reader who has written nothing", () => {
    const rows = buildFeedRows(stories, []);
    expect(rows.find((row) => row.key === "yours")).toBeUndefined();
  });

  it("leads with 'Your stories' once the reader owns a story with a chapter", () => {
    const written = mine({ chapters: stories[0].chapters.slice(0, 1) });
    const rows = buildFeedRows(stories, [], [written]);

    expect(rows[0]).toMatchObject({ key: "yours", title: "Your stories" });
    expect(rows[0].stories.map((story) => story.id)).toEqual([written.id]);
  });

  it("puts Continue reading above Katha Originals, as a named rail", () => {
    // Injected: the client has no read position yet, so the row is empty in
    // production. The ORDER it takes when it does exist is the rule under test.
    const rows = buildFeedRows(stories, [], [], [stories[0]]);
    const keys = rows.map((row) => row.key);

    expect(keys.indexOf("continue")).toBeLessThan(keys.indexOf("originals"));
    expect(rows.find((row) => row.key === "continue")?.title)
      .toBe("Continue reading");
  });

  it("runs yours, continue, originals, then the reader's genres", () => {
    const genre = populatedGenre();
    const written = mine({ chapters: stories[0].chapters.slice(0, 1) });
    const rows = buildFeedRows(stories, [genre], [written], [stories[0]]);

    expect(rows.map((row) => row.key)).toEqual([
      "yours",
      "continue",
      "originals",
      `genre-${genre}`,
    ]);
    expect(rows[3].title).toBe(genreLabels[genre]);
  });
});

describe("the genres the reader chose", () => {
  it("gets one rail each, ordered by reads so the popular ones surface first", () => {
    const genre = populatedGenre();
    const rows = buildFeedRows(stories, [genre]);
    const rail = rows.find((row) => row.key === `genre-${genre}`);

    expect(rail).toBeDefined();
    const views = rail!.stories.map((story) => story.views);
    expect(views).toEqual([...views].sort((a, b) => b - a));
    expect(rail!.stories.every((story) => story.genre === genre)).toBe(true);
  });

  it("renders a genre picked twice only once", () => {
    const genre = populatedGenre();
    const rows = buildFeedRows(stories, [genre, genre]);
    expect(rows.filter((row) => row.key === `genre-${genre}`)).toHaveLength(1);
  });

  it("skips a chosen genre nothing has been written in yet", () => {
    // `educational` has no seed stories, so its rail would be an empty shelf.
    const empty = "educational" as Genre;
    expect(stories.some((story) => story.genre === empty)).toBe(false);
    const rows = buildFeedRows(stories, [empty]);
    expect(rows.find((row) => row.key === `genre-${empty}`)).toBeUndefined();
  });

  it("replaces the generic Trending and Most loved rails entirely", () => {
    const rows = buildFeedRows(stories, [populatedGenre()]);
    expect(rows.find((row) => row.key === "trending")).toBeUndefined();
    expect(rows.find((row) => row.key === "loved")).toBeUndefined();
  });
});

// Trending and Most loved are the answer to "this reader gave us no signal",
// not a permanent fixture of the page.
it("falls back to Trending and Most loved when no genres were chosen", () => {
  // No Continue reading row: nothing records that this reader began anything.
  const rows = buildFeedRows(stories, []);
  expect(rows.map((row) => row.key)).toEqual([
    "originals",
    "trending",
    "loved",
  ]);
});

describe("what belongs in a rail", () => {
  // A story reaches the client whole or not at all - a chapter is one
  // request/response and is persisted complete - so "no chapter yet" is the
  // only unready state there is, and it is simply absent from the rail.
  it("leaves out a story of the reader's that has no chapter yet", () => {
    const empty = mine({ chapters: [] });
    const written = mine({ chapters: stories[0].chapters.slice(0, 1) });

    expect(yourStories([empty, written]).map((story) => story.id))
      .toEqual([written.id]);
    expect(buildFeedRows(stories, [], [empty]).find((row) => row.key === "yours"))
      .toBeUndefined();
  });

  it("keeps the caller's order for the reader's own stories, newest first", () => {
    const newer = mine({ chapters: stories[0].chapters.slice(0, 1) });
    const older = mine({ chapters: stories[0].chapters.slice(0, 1) });
    const rows = buildFeedRows(stories, [], [newer, older]);

    expect(rows[0].stories.map((story) => story.id)).toEqual([newer.id, older.id]);
  });

  // Nothing on the client records a read position, so there is no honest way
  // to say a reader started something. The previous stand-in was featured
  // multi-chapter stories, which listed the same cards under "Continue
  // reading" as under "Katha Originals" one row below -- claiming the reader
  // had begun books they had never opened.
  it("claims nothing is being continued until a read position is real", () => {
    expect(continueReading(stories)).toEqual([]);
  });

  it("renders no Continue reading row rather than an invented one", () => {
    const rows = buildFeedRows(stories, []);
    expect(rows.find((row) => row.key === "continue")).toBeUndefined();
  });

  it("never repeats an Originals story as something already begun", () => {
    const rows = buildFeedRows(stories, []);
    const continueRow = rows.find((row) => row.key === "continue");
    const originalsRow = rows.find((row) => row.key === "originals");
    expect(originalsRow?.stories.length).toBeGreaterThan(0);
    // The duplication this replaced was visible on screen: one row apart.
    expect(continueRow).toBeUndefined();
  });
});

/*
  "Tonight only. It sets the story" is what onboarding says under the mood
  question, and this rail is the promise being kept. It is the first shelf
  that is not the reader's own, and it is gone when the session is.
*/
describe("the Tonight rail", () => {
  it("does not exist for a reader who was never asked", () => {
    const rows = buildFeedRows(stories, [populatedGenre()], [], [], null);
    expect(rows.find((row) => row.key === "tonight")).toBeUndefined();
  });

  it("answers a mood with that mood's genres, above the house picks", () => {
    // `guessing` is mystery, thriller, horror. The seed has mystery.
    const rows = buildFeedRows(stories, [], [], [], "guessing");
    const tonight = rows.find((row) => row.key === "tonight");

    expect(tonight).toBeDefined();
    expect(tonight!.title).toBe("Tonight · Something that keeps me guessing");
    expect(
      tonight!.stories.every((story) =>
        ["mystery", "thriller", "horror"].includes(story.genre)
      ),
    ).toBe(true);
    const keys = rows.map((row) => row.key);
    expect(keys.indexOf("tonight")).toBeLessThan(keys.indexOf("originals"));
  });

  it("sits under the reader's own stories, never above them", () => {
    const written = mine({ chapters: stories[0].chapters.slice(0, 1) });
    const rows = buildFeedRows(stories, [], [written], [], "escape");
    expect(rows.map((row) => row.key).slice(0, 2)).toEqual(["yours", "tonight"]);
  });

  it("reads 'surprise me' as the reader's own genres", () => {
    const genre = populatedGenre();
    const rows = buildFeedRows(stories, [genre], [], [], "surprise");
    const tonight = rows.find((row) => row.key === "tonight");
    expect(tonight).toBeDefined();
    expect(tonight!.stories.every((story) => story.genre === genre)).toBe(true);
  });

  it("reads 'quick' as stories that end when they end", () => {
    const quick = mine({ storyMode: "standalone", isFeatured: false });
    const long = mine({ storyMode: "series", plannedChapterCount: 7 });
    const rows = buildFeedRows([quick, long], [], [], [], "quick");
    const tonight = rows.find((row) => row.key === "tonight");
    expect(tonight?.stories.map((story) => story.id)).toEqual([quick.id]);
  });

  it("draws no rail for a mood it does not know, or one nothing answers", () => {
    expect(
      buildFeedRows(stories, [], [], [], "melancholy").find((row) => row.key === "tonight"),
    ).toBeUndefined();
    // `surprise` with no genres chosen has nothing to pick from.
    expect(
      buildFeedRows(stories, [], [], [], "surprise").find((row) => row.key === "tonight"),
    ).toBeUndefined();
  });
});
