/**
 * Profile is product UI, not story prose. Keep its typography correction from
 * quietly drifting back when a new heading or sheet is added.
 */
import fs from "node:fs";
import path from "node:path";

const PROFILE_UI_FILES = [
  "screens/ProfileScreen.tsx",
  "screens/AuthorScreen.tsx",
  "screens/JourneyScreen.tsx",
  "components/profile/MemberSheet.tsx",
  "components/profile/DeleteAccountSheet.tsx",
  "components/profile/StoryWorldSheet.tsx",
  "components/profile/StatGrid.tsx",
  "components/profile/IdentityEditor.tsx",
  "components/profile/StreakCard.tsx",
  "components/profile/FeedbackSheet.tsx",
  "components/profile/FeatureVoteSheet.tsx",
] as const;

describe("Profile typography", () => {
  it("keeps Profile UI out of the display font", () => {
    for (const relative of PROFILE_UI_FILES) {
      const source = fs.readFileSync(path.join(process.cwd(), "src", relative), "utf8");
      expect(source).not.toMatch(/fonts\.display\b/);
    }
  });
});
