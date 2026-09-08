import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  GENRE_ALLOWED_SPICE,
  GENRE_DEFAULT_SPICE,
  GENRE_MIGRATION_MAP,
  PRIMARY_GENRES,
  SPICE_LEVELS,
  UI_GENRE_ORDER,
  UI_GENRES,
} from "./types.ts";

// ---------------------------------------------------------------------------
// v7 taxonomy (2026-09-08): 19 primary genres, 12 in the UI
// ---------------------------------------------------------------------------

const NEW_GENRES = ["educational", "fanfiction", "folktale", "sliceOfLife"];

const REMOVED_FROM_UI_GENRES = [
  "romantasy",
  "darkRomance",
  "paranormalRomance",
  "cozyFantasy",
  "poetry",
  "thriller",
  "contemporary",
];

Deno.test("PRIMARY_GENRES has exactly 19 members: 15 pre-v7 plus 4 new", () => {
  assertEquals(PRIMARY_GENRES.size, 19);
  for (const genre of NEW_GENRES) {
    assert(PRIMARY_GENRES.has(genre), `${genre} missing from PRIMARY_GENRES`);
  }
});

// This is the list the client reads to know what a removed genre is not
// offered as, and what a new genre is offered as. Backend owns this
// membership; the client owns the actual creation-screen component.
Deno.test("the new genres are all present in the UI-facing genre list", () => {
  for (const genre of NEW_GENRES) {
    assert(UI_GENRES.has(genre), `${genre} missing from UI_GENRES`);
  }
});

Deno.test("UI_GENRES has exactly the 12 product-decided members, no more", () => {
  assertEquals(UI_GENRES.size, 12);
  for (const genre of REMOVED_FROM_UI_GENRES) {
    assert(!UI_GENRES.has(genre), `${genre} should be removed from UI_GENRES`);
  }
});

Deno.test("UI_GENRE_ORDER matches the product owner's exact display order", () => {
  assertEquals(UI_GENRE_ORDER, [
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
  // Romance is deliberately last, per the product decision.
  assertEquals(UI_GENRE_ORDER[UI_GENRE_ORDER.length - 1], "romance");
});

Deno.test("UI_GENRE_ORDER and UI_GENRES agree on membership", () => {
  assertEquals(UI_GENRE_ORDER.length, UI_GENRES.size);
  for (const genre of UI_GENRE_ORDER) {
    assert(
      UI_GENRES.has(genre),
      `${genre} in UI_GENRE_ORDER but not UI_GENRES`,
    );
  }
});

// A removed genre must still be a real PrimaryGenre — reading, continuation
// and rendering must never break for a story already written in one.
Deno.test("every genre removed from the UI stays a valid PrimaryGenre", () => {
  for (const genre of REMOVED_FROM_UI_GENRES) {
    assert(
      PRIMARY_GENRES.has(genre),
      `${genre} was dropped from PRIMARY_GENRES`,
    );
  }
});

Deno.test("every removed genre's migration target is itself a valid, surviving genre", () => {
  for (const genre of REMOVED_FROM_UI_GENRES) {
    const target = GENRE_MIGRATION_MAP[genre];
    assert(target, `${genre} has no migration target`);
    assert(PRIMARY_GENRES.has(target), `${target} is not a valid PrimaryGenre`);
    assert(
      UI_GENRES.has(target),
      `${genre} migrates to ${target}, which is itself not in the UI`,
    );
  }
});

// sliceOfLife used to be a migration-map alias for contemporary. As a real
// genre in its own right, it must not redirect anywhere.
Deno.test("sliceOfLife is not a migration-map key", () => {
  assertEquals(GENRE_MIGRATION_MAP["sliceOfLife"], undefined);
  assertEquals(GENRE_MIGRATION_MAP["sliceoflife"], undefined);
});

Deno.test("every PrimaryGenre has a default and an allowed spice set", () => {
  for (const genre of PRIMARY_GENRES) {
    assert(
      genre in GENRE_DEFAULT_SPICE,
      `${genre} missing from GENRE_DEFAULT_SPICE`,
    );
    assert(
      genre in GENRE_ALLOWED_SPICE,
      `${genre} missing from GENRE_ALLOWED_SPICE`,
    );
    assert(
      SPICE_LEVELS.has(GENRE_DEFAULT_SPICE[genre]),
      `${genre}'s default spice is not a live tier`,
    );
    for (const level of GENRE_ALLOWED_SPICE[genre]) {
      assert(
        SPICE_LEVELS.has(level),
        `${genre} allows a non-live tier ${level}`,
      );
    }
  }
});
