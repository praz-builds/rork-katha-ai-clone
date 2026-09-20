/**
 * The paths a story took, shown at the boundary where they were on the table.
 *
 * At the end of a chapter that was continued, the reader sees the directions
 * that were offered then and which one the story went with. It is a record,
 * not an offer: nothing in it is pressable and nothing in it is announced as a
 * control, because the decision was made and re-making it here would be a
 * second chapter and a second credit.
 *
 * The attribution is the part that can lie. `direction_chosen_by` distinguishes
 * a person's tap from the model's pick from a fallback with no pick in it, and
 * a reader must never be told they chose a path the model chose.
 */

import React from "react";
import { cleanup, render } from "@testing-library/react-native";
import ChapterEnd from "@/components/reader/ChapterEnd";
import { setViewerId } from "@/lib/ownership";
import type { Chapter, OfferedDirection, Story } from "@/types/domain";

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: false,
  SUPABASE_URL: "https://example.test",
  SUPABASE_ANON_KEY: "anon",
  supabase: { functions: { invoke: jest.fn() } },
}));
jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn() }));
jest.mock("@/lib/notifications", () => ({
  pushPermissionGranted: jest.fn().mockResolvedValue(false),
}));

const OFFERED: OfferedDirection[] = [
  { id: "beat-2", prompt: "Ask Aaji to open the stuck page." },
  { id: "hook-0", prompt: "Follow the map fragment under the floorboard." },
];

function makeStory(chapterTwo: Partial<Chapter> = {}): Story {
  const chapter1: Chapter = {
    id: "chapter-1",
    storyId: "story-1",
    title: "Chapter 1: Arrival",
    paragraphs: ["The bus left her at the gate."],
    chapterNumber: 1,
    chapterRole: "series_opening",
    isPublished: true,
  };
  const chapter2: Chapter = {
    id: "chapter-2",
    storyId: "story-1",
    title: "Chapter 2: The Attic",
    paragraphs: ["The attic door had not opened in years."],
    chapterNumber: 2,
    chapterRole: "mid_series",
    isPublished: true,
    directionsOffered: OFFERED,
    directionChosen: OFFERED[0].prompt,
    directionChosenBy: "reader",
    ...chapterTwo,
  };
  return {
    id: "story-1",
    title: "The Old Fort",
    authorId: "author-1",
    genre: "adventure",
    storyMode: "series",
    plannedChapterCount: 3,
    synopsis: "A child rediscovers her grandmother's fort.",
    chapters: [chapter1, chapter2],
    likes: 0,
    bookmarks: 0,
    views: 0,
    tags: [],
    publishedOffset: 0,
    isFeatured: false,
    language: "English",
  };
}

/** Rendered at the end of chapter one, which is the boundary that was decided. */
async function renderBoundary(story: Story) {
  return await render(
    <ChapterEnd
      story={story}
      chapter={story.chapters[0]}
      onContinue={jest.fn()}
      credits={99}
    />,
  );
}

afterEach(() => {
  cleanup();
  setViewerId(null);
});

it("shows every direction that was offered, with the one taken marked", async () => {
  const { getByTestId, getByLabelText } = await renderBoundary(makeStory());

  expect(getByTestId("chapter-end-paths")).toBeTruthy();
  // Spoken as taken and not-taken rather than left to a visual marking, which
  // a screen reader cannot see at all.
  expect(getByLabelText(/^Taken: Ask Aaji to open the stuck page\./)).toBeTruthy();
  expect(
    getByLabelText("Not taken: Follow the map fragment under the floorboard."),
  ).toBeTruthy();
});

it("is frozen: no control, nothing to press", async () => {
  const { getByTestId } = await renderBoundary(makeStory());

  const block = getByTestId("chapter-end-paths");
  const roles: unknown[] = [];
  const presses: unknown[] = [];
  const walk = (node: { props?: Record<string, unknown>; children?: unknown[] }) => {
    const props = node.props ?? {};
    if (props.accessibilityRole) roles.push(props.accessibilityRole);
    if (props.onPress) presses.push(props.onPress);
    (node.children ?? []).forEach((child) => {
      if (child && typeof child === "object") {
        walk(child as { props?: Record<string, unknown>; children?: unknown[] });
      }
    });
  };
  walk(block as unknown as { props?: Record<string, unknown>; children?: unknown[] });

  // A record that can be tapped is an offer, and an offer here spends a credit
  // on a chapter that already exists.
  expect(presses).toHaveLength(0);
  expect(roles).not.toContain("button");
});

it("says the reader chose it when the reader chose it", async () => {
  setViewerId("author-1");
  const { getByText } = await renderBoundary(makeStory());

  expect(getByText("You chose this.")).toBeTruthy();
});

it("names the author instead of 'you' on somebody else's story", async () => {
  // The column records that a person tapped, not that THIS person tapped.
  setViewerId("someone-else");
  const { getByText, queryByText } = await renderBoundary(makeStory());

  expect(getByText("The author chose this.")).toBeTruthy();
  expect(queryByText("You chose this.")).toBeNull();
});

it("never tells a reader they chose what the model chose", async () => {
  setViewerId("author-1");
  const { getByText, queryByText } = await renderBoundary(
    makeStory({ directionChosenBy: "model" }),
  );

  expect(getByText("Katha chose this one.")).toBeTruthy();
  expect(queryByText("You chose this.")).toBeNull();
});

it("keeps a ranking fallback distinct from a choice the model made", async () => {
  // 00078 recorded these separately on purpose: 'ranking' is the top option
  // taken because no choosing call happened. Calling that a choice is the
  // small lie the column exists to prevent.
  const { getByText, queryByText } = await renderBoundary(
    makeStory({ directionChosenBy: "ranking" }),
  );

  expect(getByText("Katha continued with the first of these.")).toBeTruthy();
  expect(queryByText("Katha chose this one.")).toBeNull();
});

it("says nothing about who decided when nothing was recorded", async () => {
  const { getByTestId, queryByText } = await renderBoundary(
    makeStory({ directionChosenBy: undefined }),
  );

  // The cards still stand -- the offer is known even when the chooser is not.
  expect(getByTestId("chapter-end-paths")).toBeTruthy();
  expect(queryByText(/chose/)).toBeNull();
  expect(queryByText(/Katha continued/)).toBeNull();
});

it("shows a direction the reader typed, which was never on a card", async () => {
  const { getByLabelText } = await renderBoundary(
    makeStory({ directionChosen: "Take Meera to the fort path at dawn." }),
  );

  // Without this the block would list two paths, neither of them the one the
  // chapter was actually written from.
  expect(
    getByLabelText(/^Taken: Take Meera to the fort path at dawn\./),
  ).toBeTruthy();
  expect(getByLabelText("Not taken: Ask Aaji to open the stuck page.")).toBeTruthy();
});

it.each([
  ["a chapter written before the columns existed", { directionsOffered: undefined }],
  ["an offer that parsed down to nothing", { directionsOffered: [] }],
])("renders nothing at all for %s", async (_label, overrides) => {
  const { queryByTestId, toJSON } = await renderBoundary(
    makeStory({ ...overrides, directionChosen: undefined, directionChosenBy: undefined }),
  );

  expect(queryByTestId("chapter-end-paths")).toBeNull();
  // Not an empty heading, not a spacer: nothing.
  expect(toJSON()).toBeNull();
});

it("leaves the live chapter end alone", async () => {
  // The last chapter is still being decided, so its boundary is the offer, not
  // a record. Rendering both would show a reader the paths from a decision
  // they have not made yet.
  const story = makeStory();
  const { queryByTestId } = await render(
    <ChapterEnd
      story={story}
      chapter={story.chapters[1]}
      onContinue={jest.fn()}
      credits={99}
    />,
  );

  expect(queryByTestId("chapter-end-paths")).toBeNull();
});
