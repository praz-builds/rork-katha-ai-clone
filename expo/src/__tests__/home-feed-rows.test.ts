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
import { dailyFeedSeed } from "@/lib/feed-shuffle";
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

  it("does not show a Tonight card again on Katha Originals one row down", () => {
    const rows = buildFeedRows(stories, [], [], [], "guessing");
    const tonight = rows.find((row) => row.key === "tonight")!;
    const originals = rows.find((row) => row.key === "originals");
    const shown = new Set(tonight.stories.map((story) => story.id));
    // A featured story the mood claims is on Tonight; the house shelf keeps
    // the rest rather than repeating it.
    expect(tonight.stories.some((story) => story.isFeatured)).toBe(true);
    expect(originals?.stories.every((story) => !shown.has(story.id))).toBe(true);
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

/*
  The founder's walk of the preview: all three Home rails opened on the same
  story. With every count at zero, Trending (by reads), Most loved (by likes)
  and Originals (catalogue order) all fell back to the same first card.
*/
describe("variety across the rails", () => {
  /** A catalogue with no signal at all: every read and like at zero. */
  const levelField = (): Story[] =>
    Array.from({ length: 30 }, (_, index) => ({
      ...stories[index % stories.length],
      id: `level-${index}`,
      views: 0,
      likes: 0,
      isFeatured: index % 2 === 0,
    }));

  const firstIds = (rows: ReturnType<typeof buildFeedRows>) =>
    rows.map((row) => row.stories[0]?.id);

  it("never opens two rails on the same story when counts are level", () => {
    const today = new Date(2026, 8, 24, 9);
    for (const reader of ["reader-a", "reader-b", null]) {
      const rows = buildFeedRows(
        levelField(), [], [], [], null, dailyFeedSeed(reader, today),
      );
      expect(rows.map((row) => row.key)).toEqual(["originals", "trending", "loved"]);
      const firsts = firstIds(rows);
      expect(new Set(firsts).size).toBe(firsts.length);
    }
  });

  it("does not repeat a story across rails while unseen ones are left", () => {
    const rows = buildFeedRows(
      levelField(), [], [], [], null, dailyFeedSeed("reader-a", new Date(2026, 8, 24)),
    );
    const ids = rows.flatMap((row) => row.stories.map((story) => story.id));
    // 30 stories, three rails of at most ten: room for every card to be new.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("holds the same order all day, so the page does not reshuffle under a thumb", () => {
    const morning = dailyFeedSeed("reader-a", new Date(2026, 8, 24, 7, 5));
    const night = dailyFeedSeed("reader-a", new Date(2026, 8, 24, 23, 40));
    expect(morning).toBe(night);
    const a = buildFeedRows(levelField(), [], [], [], null, morning);
    const b = buildFeedRows(levelField(), [], [], [], null, night);
    expect(a.map((row) => row.stories.map((s) => s.id)))
      .toEqual(b.map((row) => row.stories.map((s) => s.id)));
  });

  it("changes with the day and with the reader", () => {
    const orderFor = (reader: string, day: number) =>
      buildFeedRows(
        levelField(), [], [], [], null, dailyFeedSeed(reader, new Date(2026, 8, day)),
      ).map((row) => row.stories.map((s) => s.id).join(",")).join("|");
    const base = orderFor("reader-a", 24);
    expect(orderFor("reader-a", 25)).not.toBe(base);
    expect(orderFor("reader-b", 24)).not.toBe(base);
  });

  it("lets a real count beat 'already shown', even for a house Original", () => {
    // The most read and most loved story in the catalogue is an Original, so
    // Originals shows it first. Trending and Most loved must still lead with
    // it: "already shown" only breaks ties, it never hides a real count.
    const field = levelField();
    const star = field[0];
    star.isFeatured = true;
    star.views = 5000;
    star.likes = 900;
    const genre = star.genre;
    const seed = dailyFeedSeed("reader-a", new Date(2026, 8, 24));

    const fallback = buildFeedRows(field, [], [], [], null, seed);
    expect(fallback.find((row) => row.key === "originals")!.stories.map((s) => s.id))
      .toContain(star.id);
    expect(fallback.find((row) => row.key === "trending")!.stories[0].id).toBe(star.id);
    expect(fallback.find((row) => row.key === "loved")!.stories[0].id).toBe(star.id);

    const withGenre = buildFeedRows(field, [genre], [], [], null, seed);
    expect(withGenre.find((row) => row.key === `genre-${genre}`)!.stories[0].id)
      .toBe(star.id);
  });

  /*
    What degrades on a tiny catalogue, written down rather than discovered.
    With fewer stories than rails there are not enough cards for every rail
    to open on a different one; the guarantee is that nothing throws, no rail
    is empty, and every rail that CAN open fresh does.
  */
  it.each([0, 1, 2, 3])("builds sane rails from %i level stories", (n) => {
    const field = levelField().slice(0, n).map((story) => ({ ...story, isFeatured: false }));
    const rows = buildFeedRows(
      field, [], [], [], null, dailyFeedSeed("reader-a", new Date(2026, 8, 24)),
    );
    if (n === 0) {
      expect(rows).toEqual([]);
      return;
    }
    // No Originals (none featured): Trending and Most loved, both full.
    expect(rows.map((row) => row.key)).toEqual(["trending", "loved"]);
    for (const row of rows) expect(row.stories).toHaveLength(n);
    const [trending, loved] = rows.map((row) => row.stories[0].id);
    if (n === 1) {
      // One story is the only card either rail can open on.
      expect(loved).toBe(trending);
    } else {
      // Two or more: Most loved opens on something Trending did not lead with.
      expect(loved).not.toBe(trending);
    }
  });

  it("lets a real count beat the shuffle", () => {
    const field = levelField();
    const popular = field[7];
    popular.views = 500;
    popular.isFeatured = false;
    const rows = buildFeedRows(
      field, [], [], [], null, dailyFeedSeed("reader-a", new Date(2026, 8, 24)),
    );
    expect(rows.find((row) => row.key === "trending")!.stories[0].id).toBe(popular.id);
  });
});
