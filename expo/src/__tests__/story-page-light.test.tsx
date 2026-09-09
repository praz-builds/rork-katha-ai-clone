/**
 * The story page after the owner overruled the dark spec.
 *
 * The design handoff made this the one dark surface in the app so the cover
 * could dissolve into it. The dissolve was the good part; the darkness was
 * not. These pin what the page is now: the app's ordinary warm ground, the
 * cover still edgeless, four things stripped out of the middle of it, and a
 * hard sign-in wall in front of every control that writes.
 */
import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import StoryDetailScreen, {
  chipLabels,
  controlDiscBackdrop,
} from "@/screens/StoryDetailScreen";
import { contrastRatio, WCAG_AA_NORMAL } from "@/lib/contrast";
import { colors } from "@/theme";
import { stories } from "@/data/seed";
import type { Story } from "@/types/domain";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
  isSupabaseConfigured: false,
}));
jest.mock("@/lib/api", () => ({
  setAuthorFollow: jest.fn(() => Promise.resolve({ on: true, count: 1 })),
  setStoryBookmark: jest.fn(() => Promise.resolve({ on: true, count: 1 })),
  setStoryLike: jest.fn(() => Promise.resolve({ on: true, count: 1 })),
}));
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("lucide-react-native", () => {
  const MockIcon = () => null;
  return new Proxy({}, { get: () => MockIcon });
});

const standalone = stories.find((story) => story.chapters.length === 1)!;

const renderDetail = (
  overrides: Partial<Story> = {},
  props: { canEngage?: boolean; onSignIn?: jest.Mock; onAuthor?: jest.Mock } = {},
) =>
  render(
    <StoryDetailScreen
      story={{ ...standalone, ...overrides } as Story}
      onBack={jest.fn()}
      onRead={jest.fn()}
      onAuthor={props.onAuthor ?? jest.fn()}
      canEngage={props.canEngage}
      onSignIn={props.onSignIn}
    />,
  );

const serialized = (view: { toJSON: () => unknown }) => JSON.stringify(view.toJSON());

/* ────────────────────────────── 1. Light ────────────────────────────── */

describe("the page is light", () => {
  it("sits on the app's ground, not on the chrome surface", async () => {
    const view = await renderDetail();
    const tree = serialized(view);

    expect(tree).toContain(colors.bg);
    // Not one pixel of the dark overlay palette survives on this screen.
    for (const dark of [
      colors.chromeSurface,
      colors.chromeSurfaceRaised,
      colors.chromeText,
      colors.chromeMuted,
      colors.chromeBorder,
      colors.chromeTrack,
    ]) {
      expect(tree).not.toContain(dark);
    }
  });

  /**
   * The cover still has NO EDGE. That was the one thing the dark version got
   * right and the one thing the rebuild had to keep: no card, no border, no
   * radius under the art - just a fade that ends on exactly the page ground.
   */
  it("dissolves the cover into the ground with no card, border or radius", async () => {
    const view = await renderDetail();
    const tree = JSON.parse(serialized(view)) as unknown;

    // The fade's last stop is the ground colour itself. Anything else leaves a
    // visible seam where the picture stops.
    expect(serialized(view)).toContain(`"${colors.bg}"`);

    const heroStyles = collectStyles(tree).filter((style) =>
      style.backgroundColor === colors.bg && style.overflow === "hidden"
    );
    expect(heroStyles.length).toBeGreaterThan(0);
    for (const style of heroStyles) {
      expect(style.borderRadius ?? 0).toBe(0);
      expect(style.borderWidth ?? 0).toBe(0);
    }
  });
});

/** Every style object in the rendered tree, flattened. */
function collectStyles(node: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (record.props && typeof record.props === "object") {
      const style = (record.props as Record<string, unknown>).style;
      if (Array.isArray(style)) {
        style.forEach((entry) => {
          if (entry && typeof entry === "object") {
            found.push(entry as Record<string, unknown>);
          }
        });
      } else if (style && typeof style === "object") {
        found.push(style as Record<string, unknown>);
      }
    }
    Object.values(record).forEach(walk);
  };
  walk(node);
  return found;
}

/* ───────────────────── 2. The floating controls read ───────────────────── */

/**
 * The controls float over WHATEVER THE COVER IS.
 *
 * A generated cover can be a white snowfield or a night street, and the close,
 * save, share, comments and more buttons sit on top of both. The disc is white
 * at 92%, so what the glyph is actually drawn against is within a few points
 * of white either way - and this computes it rather than trusting that.
 */
describe("the floating controls over arbitrary cover art", () => {
  const cases: [string, string][] = [
    ["a blown-out white cover", "#FFFFFF"],
    ["a black night cover", "#000000"],
    ["a mid saturated cover", "#7A4E1D"],
  ];

  it.each(cases)("stays legible over %s", (_label, coverHex) => {
    const backdrop = controlDiscBackdrop(coverHex);
    expect(contrastRatio(colors.strong, backdrop))
      .toBeGreaterThanOrEqual(WCAG_AA_NORMAL);
  });

  /**
   * The saved star is the state that matters most and was the one hardest to
   * see: `colors.accent` on a near-white disc measures 2.85:1, under the 3:1
   * WCAG floor for a graphical object. `accentPressed` is the same orange one
   * step darker and clears it over every cover.
   */
  it("keeps the saved state legible too", () => {
    for (const [, coverHex] of cases) {
      const backdrop = controlDiscBackdrop(coverHex);
      expect(contrastRatio(colors.accentPressed, backdrop))
        .toBeGreaterThanOrEqual(3);
    }
    // And the reason it is not the plain accent is recorded, not assumed.
    expect(contrastRatio(colors.accent, controlDiscBackdrop("#FFFFFF")))
      .toBeLessThan(3);
  });

  it("offers comments, save, share and more beside the close button", async () => {
    const view = await renderDetail();
    expect(view.getByLabelText("Close story")).toBeTruthy();
    expect(view.getByLabelText(/Open comments/)).toBeTruthy();
    expect(view.getByLabelText("Save story")).toBeTruthy();
    expect(view.getByLabelText("Share story")).toBeTruthy();
    expect(view.getByLabelText("More options")).toBeTruthy();
  });
});

/* ───────────────────────── 3. What was stripped ───────────────────────── */

describe("the page is stripped to the decision a reader is making", () => {
  it("keeps the cover, title, meta line, genre chips, summary and both CTAs", async () => {
    const view = await renderDetail();
    expect(view.getByText(standalone.title)).toBeTruthy();
    expect(view.getByLabelText("Read story")).toBeTruthy();
    expect(view.getByLabelText("Listen to story")).toBeTruthy();
  });

  it("no longer shows the reads / likes / saves stat row", async () => {
    const view = await renderDetail();
    // The star at the top already means save, and a read count on a product
    // with no readers can only argue against opening the story.
    expect(view.queryByText("reads")).toBeNull();
    expect(view.queryByText("likes")).toBeNull();
    expect(view.queryByText("saves")).toBeNull();
  });

  it("no longer shows the About this story block", async () => {
    const view = await renderDetail();
    expect(view.queryByText("ABOUT THIS STORY")).toBeNull();
    expect(view.queryByText("Genre")).toBeNull();
    expect(view.queryByText("Language")).toBeNull();
    expect(view.queryByText("Content rating")).toBeNull();
  });

  it("no longer shows an inline comment thread at the bottom", async () => {
    const view = await renderDetail();
    // The thread's own furniture - the composer and the Top/New sort tabs -
    // exists only inside the sheet now.
    expect(view.queryByPlaceholderText(/Add a comment/i)).toBeNull();
    expect(view.queryByLabelText("Sort by top")).toBeNull();
  });

  it("still shows the AI-fiction disclosure on an educational story", async () => {
    // The block around it went; this line did not. It is the one thing here a
    // reader needs BEFORE they decide to read.
    const view = await renderDetail({ primaryGenre: "educational" });
    await waitFor(() =>
      expect(view.getByText(/Facts in it are not\s+verified/)).toBeTruthy()
    );
  });
});

/* ───────────────────────── 4. Genres only, again ───────────────────────── */

describe("chipLabels", () => {
  it("returns the primary genre and drops every theme and rating", () => {
    expect(
      chipLabels({
        ...standalone,
        primaryGenre: "romance",
        tags: ["premonition", "duty", "compassion", "fear"],
        contentRating: "sweet",
        audienceMode: "kids",
      } as Story),
    ).toEqual(["Romance"]);
  });

  it("keeps a tag that genuinely names a genre", () => {
    const labels = chipLabels({
      ...standalone,
      primaryGenre: "romance",
      tags: ["Thriller", "slow burn"],
    } as Story);
    expect(labels).toContain("Romance");
    expect(labels).toContain("Thriller");
    expect(labels).not.toContain("slow burn");
  });

  it("never repeats the primary genre when a tag names it too", () => {
    expect(
      chipLabels({
        ...standalone,
        primaryGenre: "romance",
        tags: ["romance", "Romance"],
      } as Story),
    ).toEqual(["Romance"]);
  });
});

/* ─────────────────── 5. Engagement requires a sign-in ─────────────────── */

/**
 * A guest can read anything and write nothing.
 *
 * The `comments` function requires auth, so a guest's comment was always going
 * to 401 - and it did, silently, while the comment sat on screen looking
 * posted. The wall is the fix: the control is still there, pressing it says
 * why, and nothing is optimistically shown.
 */
describe("the sign-in wall", () => {
  it("prompts instead of saving, for an anonymous viewer", async () => {
    const onSignIn = jest.fn();
    const { setStoryBookmark } = jest.requireMock("@/lib/api");
    setStoryBookmark.mockClear();
    const view = await renderDetail({}, { canEngage: false, onSignIn });

    await fireEvent.press(view.getByLabelText("Save story"));

    await waitFor(() =>
      expect(view.getByText("Sign in to save this story")).toBeTruthy()
    );
    expect(setStoryBookmark).not.toHaveBeenCalled();
    // And the star did NOT fill: an optimistic update on a write that will
    // never happen is the lie this replaces.
    expect(view.getByLabelText("Save story")).toBeTruthy();
  });

  it("prompts instead of following, for an anonymous viewer", async () => {
    const onSignIn = jest.fn();
    const { setAuthorFollow } = jest.requireMock("@/lib/api");
    setAuthorFollow.mockClear();
    const view = await renderDetail({}, { canEngage: false, onSignIn });

    await fireEvent.press(view.getByLabelText("Follow"));

    await waitFor(() => expect(view.getByText(/^Sign in to follow /)).toBeTruthy());
    expect(setAuthorFollow).not.toHaveBeenCalled();
    expect(view.getByLabelText("Follow")).toBeTruthy();
  });

  it("hands the viewer to the app's sign-in flow", async () => {
    const onSignIn = jest.fn();
    const view = await renderDetail({}, { canEngage: false, onSignIn });

    await fireEvent.press(view.getByLabelText("Save story"));
    await waitFor(() =>
      expect(view.getByText("Sign in to save this story")).toBeTruthy()
    );
    await fireEvent.press(view.getByLabelText("Sign in"));

    expect(onSignIn).toHaveBeenCalled();
  });

  it("leaves reading open to everyone", async () => {
    const onRead = jest.fn();
    const view = await render(
      <StoryDetailScreen
        story={standalone}
        onBack={jest.fn()}
        onRead={onRead}
        onAuthor={jest.fn()}
        canEngage={false}
        onSignIn={jest.fn()}
      />,
    );

    await fireEvent.press(view.getByLabelText("Read story"));

    expect(onRead).toHaveBeenCalled();
    expect(view.queryByText(/^Sign in to /)).toBeNull();
  });

  it("saves normally for a signed-in viewer", async () => {
    const { setStoryBookmark } = jest.requireMock("@/lib/api");
    setStoryBookmark.mockClear();
    const view = await renderDetail({}, { canEngage: true });

    await fireEvent.press(view.getByLabelText("Save story"));

    await waitFor(() => expect(setStoryBookmark).toHaveBeenCalled());
    expect(view.queryByText(/^Sign in to /)).toBeNull();
  });
});
