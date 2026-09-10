/**
 * The saved-character library, against a configured backend.
 *
 * Two defects this covers, both of which made the library silently useless for
 * every signed-in writer:
 *
 * - It read and wrote a table called `saved_characters`. Migration 00057
 *   creates `user_characters`, and no migration has ever created the other
 *   one, so a list resolved to a PostgREST error and a save threw.
 * - What the writer types goes in `appearance`, and there has never been a
 *   column called `role`. Selecting one would have failed even against the
 *   right table. The retired `description` column is still read as the
 *   fallback for characters saved before Craft merged the two fields.
 *
 * And one that would have corrupted a writer's own data: the
 * update-or-insert lookup used `ilike` with the name as the pattern, so `%`
 * and `_` in a character's name were wildcards and could match -- and then
 * OVERWRITE -- a different saved character.
 */

const mockCalls: {
  table: string;
  select?: string;
  ilike?: [string, string];
  insert?: Record<string, unknown>;
  update?: Record<string, unknown>;
}[] = [];

let mockLookupRows: Record<string, unknown>[] = [];

const row: Record<string, unknown> = {
  id: "saved-1",
  name: "Naina",
  description: "A 29-year-old baker",
  background: null,
  appearance: null as string | null,
  portrait_url: null,
  source_story_id: null,
  created_at: "2026-09-09T00:00:00Z",
};

function mockBuilder(table: string) {
  const call: (typeof mockCalls)[number] = { table };
  mockCalls.push(call);
  const chain = {
    select(columns: string) {
      call.select = columns;
      return chain;
    },
    order() {
      return Promise.resolve({ data: [row], error: null });
    },
    ilike(column: string, pattern: string) {
      call.ilike = [column, pattern];
      return chain;
    },
    limit() {
      return Promise.resolve({ data: mockLookupRows, error: null });
    },
    insert(values: Record<string, unknown>) {
      call.insert = values;
      return chain;
    },
    update(values: Record<string, unknown>) {
      call.update = values;
      return chain;
    },
    eq() {
      return chain;
    },
    single() {
      return Promise.resolve({ data: row, error: null });
    },
  };
  return chain;
}

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { from: (table: string) => mockBuilder(table) },
}));
jest.mock("@/lib/session", () => ({
  bootstrapUser: async () => ({ userId: "user-1", isAnonymous: false, balance: 0 }),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

/* eslint-disable import/first */
import {
  escapeLikePattern,
  listSavedCharacters,
  saveCharacterToLibrary,
} from "@/lib/saved-characters";
/* eslint-enable import/first */

beforeEach(() => {
  mockCalls.length = 0;
  mockLookupRows = [];
});

it("reads the table migration 00057 actually creates, by the column it actually has", async () => {
  const characters = await listSavedCharacters();

  expect(mockCalls[0].table).toBe("user_characters");
  // `description` is still SELECTED although nothing writes it: a character
  // saved before Craft merged Description into Appearance has its text only
  // there, and dropping the column from the read would list them as a name.
  expect(mockCalls[0].select).toContain("description");
  expect(mockCalls[0].select).not.toMatch(/\brole\b/);
  expect(characters[0].appearance).toBe("A 29-year-old baker");
});

it("writes the appearance into `appearance`, and never resurrects `description`", async () => {
  await saveCharacterToLibrary({ name: "Naina", appearance: "A 29-year-old baker" });

  const insert = mockCalls.find((call) => call.insert)?.insert;
  expect(insert).toMatchObject({
    name: "Naina",
    appearance: "A 29-year-old baker",
    owner_id: "user-1",
  });
  expect(insert).not.toHaveProperty("role");
  // The retired column is read-only. A save that wrote it would keep two
  // spellings of one field alive indefinitely.
  expect(insert).not.toHaveProperty("description");
});

// The stored row wins when it has one; the retired column is the fallback and
// never a second value shown beside it.
it("prefers a stored appearance over the retired description", async () => {
  row.appearance = "Flour on her sleeves";
  try {
    const characters = await listSavedCharacters();
    expect(characters[0].appearance).toBe("Flour on her sleeves");
  } finally {
    row.appearance = null;
  }
});

describe("the name a writer typed is not a search pattern", () => {
  it("escapes the LIKE wildcards before looking a character up", async () => {
    await saveCharacterToLibrary({ name: "Mr_Fox" });

    const lookup = mockCalls.find((call) => call.ilike);
    // Unescaped, `_` matches any single character: "Mr_Fox" would have found
    // "MrsFox" and the update below would have rewritten somebody else.
    expect(lookup?.ilike).toEqual(["name", "Mr\\_Fox"]);
  });

  it("escapes the escape character itself, and %", () => {
    expect(escapeLikePattern("100% Ravi")).toBe("100\\% Ravi");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
    expect(escapeLikePattern("Naina Mistry")).toBe("Naina Mistry");
  });
});

it("updates the entry already carrying the name rather than adding a second", async () => {
  mockLookupRows = [{ id: "saved-1", portrait_url: "https://example.test/naina.png" }];

  await saveCharacterToLibrary({ name: "Naina", appearance: "A baker, older now" });

  const update = mockCalls.find((call) => call.update)?.update;
  expect(update).toMatchObject({ appearance: "A baker, older now" });
  // A save that carries no new portrait keeps the one already paid for.
  expect(update?.portrait_url).toBe("https://example.test/naina.png");
  expect(mockCalls.some((call) => call.insert)).toBe(false);
});
