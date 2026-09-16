// Normalisation and verdict relay for the invite-code endpoint. The rules --
// who may claim, when it pays, and the caps -- are SQL's, and are tested in
// `00089_..._test.ts` against real Postgres.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeCode, shapeClaimResult } from "./index.ts";

/**
 * A code travels by voice, by screenshot and through autocorrect. "  Ada  "
 * and "ADA" are the same invite, and the RPC lowercases identically, so a
 * mismatch here would refuse a code the database would have matched.
 */
Deno.test("a code is trimmed and lowercased", () => {
  assertEquals(normalizeCode("  Ada_Lovelace_12 "), "ada_lovelace_12");
  assertEquals(normalizeCode("KT8F2A19C4"), "kt8f2a19c4");
  assertEquals(normalizeCode(""), "");
  assertEquals(normalizeCode("   "), "");
  assertEquals(normalizeCode(null), "");
  assertEquals(normalizeCode(12345), "");
});

Deno.test("an accepted claim is a bare ok", () => {
  assertEquals(shapeClaimResult({ ok: true }), { ok: true });
});

Deno.test("every contract refusal is relayed, and nothing else is", () => {
  for (const reason of ["self", "invalid", "already", "too_old", "tester"]) {
    assertEquals(shapeClaimResult({ ok: false, reason }), {
      ok: false,
      reason,
    });
  }
  for (
    const bad of [{ ok: false, reason: "nope" }, { ok: false }, {}, null, 7]
  ) {
    assertEquals(shapeClaimResult(bad), null, JSON.stringify(bad));
  }
});

Deno.test("jsonb delivered as a string is still read", () => {
  assertEquals(shapeClaimResult('{"ok":false,"reason":"too_old"}'), {
    ok: false,
    reason: "too_old",
  });
});
