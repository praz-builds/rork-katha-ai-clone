import { fonts, profileHeading } from "@/theme";

// Keep this source scan independent of ambient Node declarations. The test
// runner supplies these modules; these narrow declarations describe only the
// calls this test makes, instead of making the Expo client type graph depend
// on a Node import.
declare const __dirname: string;
declare function require(id: string): unknown;
const { readFileSync, readdirSync } = require("fs") as {
  readFileSync(path: string, encoding: "utf8"): string;
  readdirSync(path: string): string[];
};
const { join } = require("path") as { join(...parts: string[]): string };

const SRC = join(__dirname, "..");
const PROFILE_COMPONENTS = join(SRC, "components", "profile");
const SCREENS = join(SRC, "screens");

// The three screens that render Profile, the public profile, and Journey.
const PROFILE_SCREENS = ["ProfileScreen.tsx", "AuthorScreen.tsx", "JourneyScreen.tsx"];

/** Every Profile-owned source file the no-display-font contract covers. */
function profileSources(): { name: string; body: string }[] {
  const sheets = readdirSync(PROFILE_COMPONENTS)
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => ({ name: `components/profile/${f}`, body: readFileSync(join(PROFILE_COMPONENTS, f), "utf8") }));
  const screens = PROFILE_SCREENS.map((f) => ({
    name: `screens/${f}`,
    body: readFileSync(join(SCREENS, f), "utf8"),
  }));
  return [...sheets, ...screens];
}

const DISPLAY_TYPE_STEPS = [
  "largeTitle",
  "title",
  "section",
  "titleSmall",
] as const;

/**
 * A display-ramp spread is safe only when the approved UI token follows it in
 * the same style object; later object properties win at runtime. This catches
 * `...type.section` just as surely as a literal `fonts.display`.
 */
function unoverriddenDisplayRampSpreads(source: string): string[] {
  const found: string[] = [];
  for (const step of DISPLAY_TYPE_STEPS) {
    const matcher = new RegExp(`\\.\\.\\.type\\.${step}\\b`, "g");
    for (const match of source.matchAll(matcher)) {
      const restOfStyle = source.slice(match.index!);
      const end = restOfStyle.indexOf("}");
      const styleBody = end === -1 ? restOfStyle : restOfStyle.slice(0, end);
      if (!/\.\.\.profileHeading\b/.test(styleBody)) {
        found.push(`type.${step}`);
      }
    }
  }
  for (const match of source.matchAll(/\.\.\.onboardingType\.title\b/g)) {
    const restOfStyle = source.slice(match.index!);
    const end = restOfStyle.indexOf("}");
    const styleBody = end === -1 ? restOfStyle : restOfStyle.slice(0, end);
    if (!/\.\.\.profileHeading\b/.test(styleBody)) {
      found.push("onboardingType.title");
    }
  }
  return found;
}

describe("Profile typography", () => {
  it("rejects display-ramp spreads unless profileHeading overrides them", () => {
    expect(
      unoverriddenDisplayRampSpreads(
        "heading: { ...type.section, color: colors.ink }",
      ),
    ).toEqual(["type.section"]);
    expect(
      unoverriddenDisplayRampSpreads(
        "heading: { ...type.titleSmall, ...profileHeading, color: colors.ink }",
      ),
    ).toEqual([]);
    expect(
      unoverriddenDisplayRampSpreads(
        "heading: { ...onboardingType.title, color: colors.ink }",
      ),
    ).toEqual(["onboardingType.title"]);
  });

  it("uses the approved UI family rather than display, brand, or reader text", () => {
    expect(profileHeading).toMatchObject({
      fontFamily: fonts.ui,
      fontWeight: "700",
    });
    expect(profileHeading.fontFamily).not.toBe(fonts.display);
    expect(profileHeading.fontFamily).not.toBe(fonts.brand);
    expect(profileHeading.fontFamily).not.toBe(fonts.reader);
  });

  // A glob that matches nothing passes vacuously, which is how a scan like
  // this rots. Pin the shape of what it found before asserting on it.
  it("scans every Profile-owned file, not an empty set", () => {
    const found = profileSources().map((f) => f.name);
    expect(found.length).toBeGreaterThanOrEqual(12);
    for (const screen of PROFILE_SCREENS) {
      expect(found).toContain(`screens/${screen}`);
    }
    expect(found).toContain("components/profile/BlockedAccountsSheet.tsx");
  });

  // The token alone only constrains the token. This is what stops a NEW
  // heading from spelling the display font directly in a screen or sheet --
  // the drift the original guard existed to catch.
  it.each(profileSources())("$name reaches for no non-UI font family", ({ body }) => {
    expect(body).not.toMatch(/fonts\.display/);
    expect(body).not.toMatch(/fonts\.brand/);
    expect(body).not.toMatch(/fonts\.reader/);
    expect(unoverriddenDisplayRampSpreads(body)).toEqual([]);
  });
});
