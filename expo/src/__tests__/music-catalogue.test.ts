import {
  defaultTrackForStory,
  musicTrackUrl,
  findMusicTrack,
  MUSIC_TRACKS,
  musicGenreFor,
  orderTracksForGenre,
  type MusicTrack,
} from "@/lib/music-catalogue";
import { GENRES, UI_GENRES } from "@/types/domain";

// jest.setup.js empties the catalogue for every other suite; this one checks the real rows.
jest.unmock("@/lib/music-catalogue");

const fixture: MusicTrack[] = [
  { id: "a", title: "A", genres: ["fantasy"], file: "a.m4a" },
  { id: "b", title: "B", genres: ["scifi"], file: "b.m4a" },
  { id: "c", title: "C", genres: ["fantasy", "adventure"], file: "c.m4a" },
];

describe("the shipped catalogue", () => {
  it("has two tracks for each of the twelve scored genres, with unique ids", () => {
    expect(MUSIC_TRACKS).toHaveLength(24);
    expect(new Set(MUSIC_TRACKS.map((track) => track.id)).size).toBe(24);
    for (const genre of ["fantasy", "romance", "adventure", "comedy", "educational", "fanfiction", "folktale", "historical", "scifi", "mystery", "horror", "sliceOfLife"] as const) {
      expect(MUSIC_TRACKS.filter((track) => track.genres.includes(genre))).toHaveLength(2);
    }
  });

  it("names every id and file `<genre>_<nn>`, and keeps the two in step", () => {
    // Saved per-genre defaults are keyed on the id, and the bucket object is
    // named from the file. A row where they disagree is a 404 at play time.
    for (const track of MUSIC_TRACKS) {
      expect(track.id).toMatch(/^[a-z_]+_\d{2}$/);
      expect(track.file).toBe(`${track.id}.m4a`);
    }
  });

  it("builds a public storage URL from the project's Supabase URL", () => {
    // Set here rather than read: the URL is inlined at build time, and a test
    // that asserted against whatever the environment happened to hold would
    // pass against an empty string.
    const previous = process.env.EXPO_PUBLIC_SUPABASE_URL;
    process.env.EXPO_PUBLIC_SUPABASE_URL = "https://example.supabase.co/";
    try {
      const track = MUSIC_TRACKS.find((row) => row.id === "fantasy_01")!;
      expect(musicTrackUrl(track)).toBe(
        "https://example.supabase.co/storage/v1/object/public/music/fantasy_01.m4a",
      );
    } finally {
      process.env.EXPO_PUBLIC_SUPABASE_URL = previous;
    }
  });

  it("gives every genre on the Create screen a default track, borrowed or its own", () => {
    for (const genre of UI_GENRES) {
      expect(defaultTrackForStory("any-story", genre)).toBeDefined();
    }
  });

  it("gives EVERY genre a track, not only the ones Create offers", () => {
    // UI_GENRES is the 12 genres Create shows. GENRES is all 17 the client can
    // hold, and a story reaches the reader carrying one of those 17 -- not one
    // of the 12. Stories created before the v7 taxonomy, and Katha Originals,
    // carry romantasy, darkRomance, thriller, contemporary and poetry; there
    // are contemporary stories in production today. Checking only UI_GENRES
    // would have passed while those five opened in silence.
    //
    // This is also the guard for the next genre added to the taxonomy: it
    // fails here rather than being discovered as one genre that never plays.
    const silent = GENRES.filter((genre) => !defaultTrackForStory("any-story", genre));
    expect(silent).toEqual([]);
  });

  it("covers the genres the backend can store but the client does not name", () => {
    // The backend's PrimaryGenre union has 19 members; the client's GENRES has
    // 17. `cozyFantasy` and `paranormalRomance` exist server-side only, so a
    // row carrying one arrives as a string this client cannot type.
    //
    // `isGenre` in api.ts is what stops that reaching the reader: an unknown
    // value falls back to a real genre. This asserts the other half of that
    // contract -- that whatever it falls back to can actually play. If the
    // fallback ever changes, this is the test that should be revisited.
    for (const fallback of ["adventure"] as const) {
      expect(defaultTrackForStory("any-story", fallback)).toBeDefined();
    }
  });

  it("gives fantasy and romance their own music, not a borrowed genre's", () => {
    // The two most-picked genres on the Create screen. They borrowed until
    // their own tracks arrived, and a regression to borrowing would be silent.
    expect(musicGenreFor("fantasy")).toBe("fantasy");
    expect(musicGenreFor("romance")).toBe("romance");
    expect(defaultTrackForStory("any-story", "fantasy")?.genres).toEqual(["fantasy"]);
    expect(orderTracksForGenre(MUSIC_TRACKS, "romance").slice(0, 2).map((track) => track.id))
      .toEqual(["romance_01", "romance_02"]);
  });

  it("still lends music to the genres that have none of their own", () => {
    expect(musicGenreFor("romantasy")).toBe("fantasy");
    expect(musicGenreFor("thriller")).toBe("mystery");
    expect(musicGenreFor("poetry")).toBe("sliceOfLife");
  });
});

describe("defaultTrackForStory", () => {
  it("returns the same track for the same story every time", () => {
    expect(defaultTrackForStory("story-42", "fantasy", fixture)).toBe(defaultTrackForStory("story-42", "fantasy", fixture));
  });

  it("only picks from the story's genre, and spreads stories across both tracks", () => {
    const picked = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const track = defaultTrackForStory(`story-${i}`, "fantasy", fixture);
      expect(["a", "c"]).toContain(track?.id);
      picked.add(track!.id);
    }
    expect(picked.size).toBe(2);
  });

  it("returns undefined when the genre has no music", () => {
    expect(defaultTrackForStory("story-1", "horror", fixture)).toBeUndefined();
    expect(defaultTrackForStory("story-1", "fantasy", [])).toBeUndefined();
  });
});

it("orders genre-matching tracks first, each group kept in catalogue order", () => {
  expect(orderTracksForGenre(fixture, "fantasy").map((track) => track.id)).toEqual(["a", "c", "b"]);
});

it("leaves order unchanged when nothing matches the requested genre", () => {
  expect(orderTracksForGenre(fixture, "horror").map((track) => track.id)).toEqual(["a", "b", "c"]);
});

it("returns an empty list for an empty catalogue", () => {
  expect(orderTracksForGenre([], "fantasy")).toEqual([]);
});

describe("findMusicTrack", () => {
  it("finds a track by id in a given list", () => {
    expect(findMusicTrack("c", fixture)).toEqual(fixture[2]);
  });

  it("returns undefined for null, undefined and unknown ids", () => {
    expect(findMusicTrack(null, fixture)).toBeUndefined();
    expect(findMusicTrack(undefined, fixture)).toBeUndefined();
    expect(findMusicTrack("does-not-exist", fixture)).toBeUndefined();
  });

  it("defaults to the real catalogue", () => {
    expect(findMusicTrack("horror_01")?.title).toBe("Horror");
    expect(findMusicTrack("a")).toBeUndefined();
  });
});
