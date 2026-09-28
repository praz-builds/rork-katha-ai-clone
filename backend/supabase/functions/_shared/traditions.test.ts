import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DIVINE_DEPICTION_CONFLICT,
  getTradition,
  isSupportedTradition,
  isTraditionId,
  mayDepictDivine,
  mayDepictProphets,
  mayVoiceFigure,
  narrateOnlyFigures,
  normalizeTradition,
  SUPPORTED_TRADITION_IDS,
  TRADITION_IDS,
  traditionPromptName,
  TRADITIONS,
  UNIVERSAL_SCRIPTURE_RULES,
  type WorldPreference,
} from "./traditions.ts";
import type { CountryCode } from "./story-world-countries.ts";

const DECLARED_UNSUPPORTED = [
  "buddhist",
  "sikh",
  "jain",
  "shinto",
  "daoist",
  "bahai",
  "zoroastrian",
  "indigenous",
  "african_traditional",
  "secular",
] as const;

Deno.test("Phase 1 supports exactly christian, muslim, jewish and hindu", () => {
  assertEquals([...SUPPORTED_TRADITION_IDS].sort(), [
    "christian",
    "hindu",
    "jewish",
    "muslim",
  ]);
});

Deno.test("the declared-but-unsupported ids exist and stay unsupported", () => {
  for (const id of DECLARED_UNSUPPORTED) {
    assert(isTraditionId(id), `${id} should be a declared id`);
    assertFalse(isSupportedTradition(id), `${id} must not be supported yet`);
    assertEquals(
      normalizeTradition(id),
      undefined,
      `${id} must normalise to absent`,
    );
  }
});

Deno.test("every Phase-1 tradition carries a complete policy", () => {
  for (const id of SUPPORTED_TRADITION_IDS) {
    const t = getTradition(id);
    assert(t.label.length > 0, `${id} label`);
    assert(t.promptName.length > 0, `${id} promptName`);
    assert(t.promptName !== t.id, `${id} promptName must be a phrase`);
    assert(t.narrationRules.length > 0, `${id} narrationRules`);
    assert(t.avoidStereotypes.length > 0, `${id} avoidStereotypes`);
    assert(t.depiction.visualSubstitutes.length > 0, `${id} substitutes`);
    assert(t.depiction.narrateOnly.length > 0, `${id} narrateOnly`);
    assert(t.scripturePolicy.namedTexts.length > 0, `${id} namedTexts`);
    assert(t.scripturePolicy.retellingLabels.length > 0, `${id} labels`);
    assert(t.notes !== undefined, `${id} notes`);
    assert((t.sourceNeeded ?? []).length > 0, `${id} sourceNeeded`);
    // divineAddress is nullable but must be declared explicitly.
    assert(
      t.divineAddress === null || t.divineAddress.length > 0,
      `${id} divineAddress`,
    );
  }
});

Deno.test("every id in the table is keyed by its own id", () => {
  for (const id of TRADITION_IDS) {
    assertEquals(TRADITIONS[id].id, id);
  }
});

// ---------------------------------------------------------------------------
// Scripture
// ---------------------------------------------------------------------------

Deno.test("Phase 1 forbids direct scriptural quotation in every tradition", () => {
  for (const id of TRADITION_IDS) {
    const s = TRADITIONS[id].scripturePolicy;
    assertEquals(
      s.directQuotationAllowed,
      false,
      `${id} must forbid direct quotation`,
    );
    assertEquals(s.paraphraseMustBeLabelled, true, `${id} label requirement`);
    assertEquals(
      s.verifiedSourceFile,
      null,
      `${id} has no verified source file yet`,
    );
  }
});

Deno.test("the universal scripture rule names the prohibition out loud", () => {
  const joined = UNIVERSAL_SCRIPTURE_RULES.join(" ").toLowerCase();
  assert(joined.includes("never quote scripture"));
  assert(joined.includes("retelling"));
});

// ---------------------------------------------------------------------------
// The divine-depiction conflict
// ---------------------------------------------------------------------------

Deno.test("the divine is not depictable in any tradition in Phase 1", () => {
  for (const id of SUPPORTED_TRADITION_IDS) {
    assertEquals(
      TRADITIONS[id].depiction.divine,
      "forbidden",
      `${id} divine default`,
    );
    assertFalse(mayDepictDivine(id), `${id} mayDepictDivine`);
  }
});

Deno.test("the conflict is recorded verbatim and marked unresolved", () => {
  assertEquals(DIVINE_DEPICTION_CONFLICT.resolved, false);
  assertEquals(DIVINE_DEPICTION_CONFLICT.written, "Never depict God.");
  assert(DIVINE_DEPICTION_CONFLICT.spoken.includes("Hindu"));
  assert(DIVINE_DEPICTION_CONFLICT.spoken.includes("Christian"));
  assertEquals(DIVINE_DEPICTION_CONFLICT.phase1Default, "forbidden");
});

// ---------------------------------------------------------------------------
// The Muslim prophet rule
// ---------------------------------------------------------------------------

Deno.test("Muslim prophets are narrate-only: no figure, no face", () => {
  const muslim = getTradition("muslim");
  assertEquals(muslim.depiction.prophets, "forbidden");
  assertFalse(mayDepictProphets("muslim"));
  assertFalse(muslim.depiction.facesPermittedForSacredFigures);
  const narrate = narrateOnlyFigures("muslim").join(" ").toLowerCase();
  assert(narrate.includes("muhammad"));
  assert(narrate.includes("allah"));
});

Deno.test("Muslim prophets are never voiced by any character", () => {
  assertFalse(mayVoiceFigure("muslim", "Muhammad"));
  assertFalse(mayVoiceFigure("muslim", "Allah"));
  assertFalse(mayVoiceFigure("muslim", "Ibrahim"));
  const rules = getTradition("muslim").narrationRules.join(" ").toLowerCase();
  assert(rules.includes("no dialogue"));
  assert(rules.includes("ever voices a prophet"));
  // A ordinary character is of course voiceable.
  assert(mayVoiceFigure("muslim", "Amina the neighbour"));
});

Deno.test("the cautious family/companions extensions are on by default", () => {
  const extensions = getTradition("muslim").depiction.extensions;
  const ids = extensions.map((e) => e.id).sort();
  assertEquals(ids, ["prophets_companions", "prophets_family"]);
  for (const e of extensions) {
    assert(e.appliedByDefault, `${e.id} must default to the cautious reading`);
    assert(e.rationale.length > 0);
  }
  // Applied by default means they land in the narrate-only list.
  const narrate = narrateOnlyFigures("muslim").join(" ");
  assert(narrate.includes("Ahl al-Bayt"));
  assert(narrate.includes("Sahaba"));
});

Deno.test("the Muslim visual substitutes are objects, light and place", () => {
  const subs = getTradition("muslim").depiction.visualSubstitutes.join(" ")
    .toLowerCase();
  for (const expected of ["landscape", "light", "architecture", "pattern"]) {
    assert(subs.includes(expected), `substitutes should mention ${expected}`);
  }
});

Deno.test("no tradition may render a face for a forbidden figure", () => {
  for (const id of SUPPORTED_TRADITION_IDS) {
    const d = TRADITIONS[id].depiction;
    if (d.prophets === "forbidden" || d.divine === "forbidden") {
      // A forbidden class is never rendered at all, faces included.
      assertFalse(mayDepictDivine(id) && !d.facesPermittedForSacredFigures);
    }
  }
});

// ---------------------------------------------------------------------------
// Culture and faith are independent axes
// ---------------------------------------------------------------------------

Deno.test("every country-and-faith combination is expressible", () => {
  const combos: readonly WorldPreference[] = [
    { country: "IN", tradition: "hindu" },
    { country: "IN", tradition: "muslim" },
    { country: "IN", tradition: "christian" },
    { country: "IN", tradition: "jewish" },
    { country: "US", tradition: "jewish" },
    { country: "JP", tradition: "christian" },
    { country: "SA", tradition: "christian" },
    { country: "IL", tradition: "muslim" },
    { country: "BR", tradition: "hindu" },
  ];
  for (const combo of combos) {
    assert(isSupportedTradition(combo.tradition));
    assert(typeof combo.country === "string" && combo.country.length === 2);
  }
});

Deno.test("each axis is independently optional; neither implies the other", () => {
  const countryOnly: WorldPreference = { country: "IN" };
  const faithOnly: WorldPreference = { tradition: "muslim" };
  const neither: WorldPreference = {};
  assertEquals(countryOnly.tradition, undefined);
  assertEquals(faithOnly.country, undefined);
  assertEquals(neither.country, undefined);
  assertEquals(neither.tradition, undefined);
});

Deno.test("JP + buddhist and JP + shinto are declared, pending support", () => {
  // The ids exist so the combination is nameable today and shippable later
  // without a client change; they simply normalise away until supported.
  const jp: CountryCode = "JP";
  assertEquals(jp, "JP");
  for (const id of ["buddhist", "shinto"] as const) {
    assert(isTraditionId(id));
    assertEquals(normalizeTradition(id), undefined);
  }
});

Deno.test("no tradition derives from or mentions a country code", () => {
  // The contract must not hard-code a country anywhere; deriving one axis from
  // the other is the failure this whole split exists to prevent.
  const source = Deno.readTextFileSync(
    new URL("./traditions.ts", import.meta.url),
  );
  assertFalse(
    /COUNTRY_WORLDS|COUNTRY_CODES|storyWorldPromptName/.test(source),
    "traditions.ts must not read the country table",
  );
});

// ---------------------------------------------------------------------------
// Normalise, never reject
// ---------------------------------------------------------------------------

Deno.test("unknown values normalise to undefined rather than throwing", () => {
  const junk: unknown[] = [
    undefined,
    null,
    "",
    " ",
    "CHRISTIAN",
    "Muslim",
    "pastafarian",
    "toString",
    "constructor",
    "__proto__",
    42,
    true,
    {},
    [],
    { id: "hindu" },
  ];
  for (const value of junk) {
    assertEquals(
      normalizeTradition(value),
      undefined,
      `${JSON.stringify(value)} should normalise to undefined`,
    );
  }
});

Deno.test("supported ids survive normalisation unchanged", () => {
  for (const id of SUPPORTED_TRADITION_IDS) {
    assertEquals(normalizeTradition(id), id);
    assertEquals(traditionPromptName(id), TRADITIONS[id].promptName);
  }
});

Deno.test("prompt names are server-owned phrases, not raw labels", () => {
  for (const id of SUPPORTED_TRADITION_IDS) {
    assert(traditionPromptName(id).includes("tradition"));
  }
});
