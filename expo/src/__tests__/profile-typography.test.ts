import { fonts, profileHeading } from "@/theme";

// `@types/node` is deliberately not a dependency (see button-recipe.test.ts),
// so the Node functions this test needs are declared, not imported. Three
// other suites in this directory do the same and typecheck clean --
// store-catalog.test.ts, story-world.test.ts and create-flow-more-options
// .test.ts -- so reading source files here is an established pattern, not a
// constraint of the Expo test environment.
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

describe("Profile typography", () => {
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
  });
});
