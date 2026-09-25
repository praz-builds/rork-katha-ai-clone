import { fonts, profileHeading } from "@/theme";

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
});
