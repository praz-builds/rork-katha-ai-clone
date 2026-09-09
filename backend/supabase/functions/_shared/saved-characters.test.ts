import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  rememberStoryCharacters,
  resolveSavedCharacters,
  type SavedCharacterClient,
  type SavedCharacterRow,
} from "./saved-characters.ts";

function client(
  rows: SavedCharacterRow[] | Error,
  rpc: { data?: unknown; error?: unknown } = { data: 2 },
): { client: SavedCharacterClient; queries: unknown[]; rpcs: unknown[] } {
  const queries: unknown[] = [];
  const rpcs: unknown[] = [];
  return {
    queries,
    rpcs,
    client: {
      from(table) {
        return {
          select(columns) {
            return {
              eq(column, value) {
                return {
                  in(inColumn, values) {
                    queries.push({
                      table,
                      columns,
                      column,
                      value,
                      inColumn,
                      values,
                    });
                    return Promise.resolve(
                      rows instanceof Error
                        ? { data: null, error: rows }
                        : { data: rows, error: null },
                    );
                  },
                };
              },
            };
          },
        };
      },
      rpc(fn, args) {
        rpcs.push({ fn, args });
        return Promise.resolve({
          data: rpc.data ?? null,
          error: rpc.error ?? null,
        });
      },
    },
  };
}

const SAVED: SavedCharacterRow = {
  id: "saved-1",
  name: "Maya",
  description: "The girl at the counter",
  background: "Runs the cafe now",
  appearance: "Blue marker on her hands",
  portrait_url: "https://cdn/maya.png",
};

Deno.test("a brief with no saved ids never queries the library", async () => {
  const { client: c, queries } = client([SAVED]);
  const out = await resolveSavedCharacters(c, "u1", [{ name: "Aarav" }]);
  assertEquals(out, [{ name: "Aarav" }]);
  assertEquals(queries, []);
});

Deno.test("blank fields are filled from the saved row and the portrait travels", async () => {
  const { client: c, queries } = client([SAVED]);
  const out = await resolveSavedCharacters(c, "u1", [
    { name: "Maya", description: "", savedCharacterId: "saved-1" },
    { name: "Aarav", description: "Returning son" },
  ]);
  assertEquals(out[0], {
    name: "Maya",
    description: "The girl at the counter",
    background: "Runs the cafe now",
    appearance: "Blue marker on her hands",
    portraitUrl: "https://cdn/maya.png",
    savedCharacterId: "saved-1",
  });
  assertEquals(out[1], { name: "Aarav", description: "Returning son" });
  assertEquals((queries[0] as { column: string; value: string }).value, "u1");
});

Deno.test("what the writer typed wins over the saved row", async () => {
  const { client: c } = client([SAVED]);
  const out = await resolveSavedCharacters(c, "u1", [
    {
      name: "Maya",
      appearance: "Now grey-haired",
      savedCharacterId: "saved-1",
    },
  ]);
  assertEquals(out[0].appearance, "Now grey-haired");
  assertEquals(out[0].description, "The girl at the counter");
});

Deno.test("an id that is not the caller's is dropped, and the character keeps the brief's fields", async () => {
  const { client: c } = client([]);
  const out = await resolveSavedCharacters(c, "u1", [
    { name: "Maya", description: "typed", savedCharacterId: "someone-elses" },
  ]);
  assertEquals(out, [{
    name: "Maya",
    description: "typed",
    savedCharacterId: undefined,
  }]);
});

Deno.test("a lookup failure never fails the generation", async () => {
  const { client: c } = client(new Error("down"));
  const out = await resolveSavedCharacters(c, "u1", [
    { name: "Maya", savedCharacterId: "saved-1" },
  ]);
  assertEquals(out, [{ name: "Maya", savedCharacterId: undefined }]);
});

Deno.test("remembering a cast calls the service RPC and swallows its failure", async () => {
  const ok = client([], { data: 3 });
  assertEquals(await rememberStoryCharacters(ok.client, "u1", "s1"), 3);
  assertEquals(ok.rpcs, [{
    fn: "remember_story_characters",
    args: { p_user_id: "u1", p_story_id: "s1" },
  }]);
  const bad = client([], { error: { message: "no such function" } });
  assertEquals(await rememberStoryCharacters(bad.client, "u1", "s1"), 0);
});
