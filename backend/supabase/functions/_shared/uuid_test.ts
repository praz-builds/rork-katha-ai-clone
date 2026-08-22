import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseUuid } from "./uuid.ts";

Deno.test("UUID validation accepts Postgres-compatible versions", () => {
  assertEquals(
    parseUuid("6ba7b810-9dad-41d1-80b4-00c04fd430c8"),
    "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
  );
  assertEquals(
    parseUuid("018f06a7-4f2e-7cc4-9231-52c6a8f59baf"),
    "018f06a7-4f2e-7cc4-9231-52c6a8f59baf",
  );
  assertEquals(parseUuid("not-a-uuid"), null);
  assertEquals(parseUuid(null), null);
});
