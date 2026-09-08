/**
 * The genre list has two audiences that must never desync: `Genre`, which
 * every story ever published is typed against, and `UI_GENRES`, the twelve
 * genres a picker actually offers today. A genre can retire from `UI_GENRES`
 * - and five have - without a single existing story losing its label, its
 * color, or its icon. These tests pin the new UI order and prove the
 * retired genres are still fully readable everywhere a genre is keyed.
 */
import React from "react";
import { render } from "@testing-library/react-native";

jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy(
    {},
    { get: () => () => ReactModule.createElement(ReactModule.Fragment) },
  );
});

/* eslint-disable import/first */
import { StoryCard } from "@/components/KathaPrimitives";
import { GENRE_EMOJI } from "@/lib/genre-content";
import { genreGradients, genreLabels } from "@/theme";
import { GENRES, UI_GENRES, KIDS_UI_GENRES } from "@/types/domain";
import type { Genre, Story } from "@/types/domain";
/* eslint-enable import/first */

/** Genres that used to be offered but no longer appear in `UI_GENRES`. */
const REMOVED_GENRES: readonly Genre[] = [
  "romantasy",
  "darkRomance",
  "poetry",
  "thriller",
  "contemporary",
];

function storyWithGenre(genre: Genre): Story {
  return {
    id: `genre-fixture-${genre}`,
    title: "A Story With A Retired Genre",
    authorId: "author-1",
    genre,
    synopsis: "A synopsis.",
    chapters: [],
    likes: 12,
    bookmarks: 3,
    views: 4200,
    tags: [],
    publishedOffset: 10,
    isFeatured: false,
    language: "English",
  };
}

describe("UI_GENRES", () => {
  it("is exactly the twelve display genres, in the fixed app order, romance last", () => {
    expect(UI_GENRES).toEqual([
      "adventure",
      "comedy",
      "educational",
      "fanfiction",
      "folktale",
      "historical",
      "scifi",
      "fantasy",
      "mystery",
      "horror",
      "sliceOfLife",
      "romance",
    ]);
    expect(UI_GENRES).toHaveLength(12);
    expect(UI_GENRES[UI_GENRES.length - 1]).toBe("romance");
  });

  it("contains no genre outside Genre's own value set", () => {
    for (const genre of UI_GENRES) {
      expect(GENRES).toContain(genre);
    }
  });
});

describe("removed genres", () => {
  it("are absent from UI_GENRES", () => {
    for (const genre of REMOVED_GENRES) {
      expect(UI_GENRES).not.toContain(genre);
    }
  });

  it("are still valid Genre values with a real label", () => {
    for (const genre of REMOVED_GENRES) {
      expect(GENRES).toContain(genre);
      expect(typeof genreLabels[genre]).toBe("string");
      expect(genreLabels[genre].length).toBeGreaterThan(0);
    }
  });

  it("plus UI_GENRES account for every value in GENRES - nothing lost, nothing extra", () => {
    const expected = new Set<Genre>([...UI_GENRES, ...REMOVED_GENRES]);
    expect(new Set(GENRES)).toEqual(expected);
    expect(GENRES).toHaveLength(UI_GENRES.length + REMOVED_GENRES.length);
  });

  it("still render a proper label instead of a blank or a crash", async () => {
    // One render for every retired genre, rather than mount/unmount per
    // genre - React Native Testing Library warns about overlapping act()
    // calls when a fresh tree mounts before the previous one has settled.
    const { getByText } = await render(
      <React.Fragment>
        {REMOVED_GENRES.map((genre) => (
          <StoryCard key={genre} story={storyWithGenre(genre)} />
        ))}
      </React.Fragment>,
    );
    for (const genre of REMOVED_GENRES) {
      const escaped = genreLabels[genre].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(getByText(new RegExp(escaped))).toBeTruthy();
    }
  });
});

describe("every genre in the Genre type", () => {
  it("has a label, a 3-stop gradient, and an emoji - exhaustively, not just for the twelve on screen", () => {
    for (const genre of GENRES) {
      expect(typeof genreLabels[genre]).toBe("string");
      expect(genreLabels[genre].length).toBeGreaterThan(0);

      expect(genreGradients[genre]).toHaveLength(3);
      for (const stop of genreGradients[genre]) {
        expect(stop).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }

      expect(typeof GENRE_EMOJI[genre]).toBe("string");
      expect(GENRE_EMOJI[genre].length).toBeGreaterThan(0);
    }
  });

  it("the four new genres are present with a label", () => {
    for (const genre of ["educational", "fanfiction", "folktale", "sliceOfLife"] as const) {
      expect(GENRES).toContain(genre);
      expect(UI_GENRES).toContain(genre);
      expect(genreLabels[genre]).toBeTruthy();
    }
  });
});

/**
 * The genres deliberately kept out of kids mode. Romance carries adult
 * relationship content; horror is built to frighten. Changing this list is a
 * product decision, and the tests below make it a visible one.
 */
const EXPECTED_KIDS_EXCLUSIONS: readonly string[] = ["horror", "romance"];

// Kids mode is the one place where forgetting must fail CLOSED.
//
// Everywhere else a genre added to `UI_GENRES` should appear by default, and a
// blocklist gives that. Kids mode inverts it: the failure of forgetting is not
// a genre quietly absent from a picker, it is a genre inappropriate for a child
// quietly present in one. So the allowlist is named explicitly, and this test
// fails the moment `UI_GENRES` grows without someone deciding.
it("keeps a new genre out of kids mode until it is named", () => {
  const undecided = UI_GENRES.filter((genre) =>
    !KIDS_UI_GENRES.includes(genre) && !EXPECTED_KIDS_EXCLUSIONS.includes(genre)
  );
  expect(undecided).toEqual([]);
});

it("excludes exactly the genres that are unfit for a child", () => {
  expect([...KIDS_UI_GENRES]).toEqual(
    UI_GENRES.filter((genre) => !EXPECTED_KIDS_EXCLUSIONS.includes(genre)),
  );
});
