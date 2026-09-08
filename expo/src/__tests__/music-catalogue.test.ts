import { findMusicTrack, MUSIC_TRACKS, orderTracksForGenre, type MusicTrack } from "@/lib/music-catalogue";

const fixture: MusicTrack[] = [
  { id: "a", title: "A", genres: ["fantasy"], source: { uri: "https://example.com/a.mp3" } },
  { id: "b", title: "B", genres: ["scifi"], source: { uri: "https://example.com/b.mp3" } },
  { id: "c", title: "C", genres: ["fantasy", "adventure"], source: { uri: "https://example.com/c.mp3" } },
];

it("ships with an empty track list until licensed audio is added", () => {
  expect(MUSIC_TRACKS).toEqual([]);
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

  it("defaults to the real (currently empty) catalogue", () => {
    expect(findMusicTrack("a")).toBeUndefined();
  });
});
