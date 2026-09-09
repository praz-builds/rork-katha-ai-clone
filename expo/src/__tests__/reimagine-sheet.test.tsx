import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

import { ReimagineSheet } from "@/components/reader/ReimagineSheet";
import type { Chapter, SavedCharacter, Story } from "@/types/domain";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
}));

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

const chapter: Chapter = {
  id: "c2",
  storyId: "s1",
  title: "The Corner Table",
  chapterNumber: 2,
  isPublished: true,
  paragraphs: ["Aarav waited. Maya did not come.", "Somewhere a kettle sang."],
};

const story: Story = {
  id: "s1",
  title: "Kismat Cafe Reunion",
  authorId: "me",
  genre: "romance",
  storyMode: "series",
  plannedChapterCount: 7,
  synopsis: "",
  characters: [
    { name: "Aarav", role: "A returning engineer" },
    { name: "Maya", role: "The one who stayed" },
    { name: "Uncle Farooq", role: "Never on this page" },
  ],
  chapters: [chapter, chapter],
  likes: 0,
  bookmarks: 0,
  views: 0,
  tags: [],
  publishedOffset: 0,
  isFeatured: false,
  language: "English",
};

const kabir: SavedCharacter = {
  id: "saved-kabir",
  name: "Kabir",
  role: "A courier",
  createdAt: "2026-09-09T00:00:00Z",
};

async function renderSheet(overrides: Partial<React.ComponentProps<typeof ReimagineSheet>> = {}) {
  const onSubmit = jest.fn();
  const view = await render(
    <ReimagineSheet
      visible
      story={story}
      chapter={chapter}
      isAuthor
      onClose={jest.fn()}
      onSubmit={onSubmit}
      loadSavedCharacters={async () => [kabir]}
      {...overrides}
    />,
  );
  return { view, onSubmit };
}

it("lists only the roster characters on this page, and starts with the button off", async () => {
  const { view } = await renderSheet();
  expect(view.getByText("Chapter 2 · rewrites this chapter only")).toBeTruthy();
  expect(view.getByText("Aarav")).toBeTruthy();
  expect(view.getByText("Maya")).toBeTruthy();
  expect(view.queryByText("Uncle Farooq")).toBeNull();
  expect(view.getByText("Reimagine · 1 credit")).toBeTruthy();
  expect(view.getByLabelText("Reimagine chapter").props.accessibilityState.disabled).toBe(true);
});

it("a prompt alone is enough to submit, and the request carries it trimmed", async () => {
  const { view, onSubmit } = await renderSheet();
  await fireEvent.changeText(view.getByLabelText("What should change"), "  Make it rain.  ");
  const button = view.getByLabelText("Reimagine chapter");
  expect(button.props.accessibilityState.disabled).toBe(false);
  await fireEvent.press(button);
  expect(onSubmit).toHaveBeenCalledWith({
    storyId: "s1",
    chapterNumber: 2,
    prompt: "Make it rain.",
    replacements: [],
  });
});

it("replaces a character from the saved library, offers apply-to-all, and can be cleared", async () => {
  const { view, onSubmit } = await renderSheet();
  await fireEvent.press(view.getByLabelText("Replace Aarav"));
  const kabirRow = await view.findByLabelText("Choose Kabir");
  await fireEvent.press(kabirRow);

  await waitFor(() => expect(view.getByText("→ Kabir")).toBeTruthy());
  expect(view.getByLabelText("Change replacement for Aarav")).toBeTruthy();
  const checkbox = view.getByLabelText("Apply Kabir to all chapters");
  expect(checkbox.props.accessibilityState.checked).toBe(false);
  await fireEvent.press(checkbox);
  expect(view.getByLabelText("Apply Kabir to all chapters").props.accessibilityState.checked).toBe(true);

  // A replacement alone enables the button, with no prompt.
  await fireEvent.press(view.getByLabelText("Reimagine chapter"));
  expect(onSubmit).toHaveBeenCalledWith({
    storyId: "s1",
    chapterNumber: 2,
    prompt: "",
    replacements: [{
      fromName: "Aarav",
      to: { savedCharacterId: "saved-kabir", name: "Kabir", portraitUrl: undefined },
      applyToAllChapters: true,
    }],
  });

  await fireEvent.press(view.getByLabelText("Keep Aarav"));
  expect(view.queryByText("→ Kabir")).toBeNull();
  expect(view.getByLabelText("Reimagine chapter").props.accessibilityState.disabled).toBe(true);
});

it("tells a non-author the rewrite lands in a private copy", async () => {
  const { view } = await renderSheet({ isAuthor: false, story: { ...story, authorId: "someone-else" } });
  expect(view.getByText("Makes a private copy in your library")).toBeTruthy();
  expect(view.getByLabelText("Reimagine in my copy")).toBeTruthy();
});

it("says so when nothing on the roster is on this page, and hides apply-to-all for a standalone", async () => {
  const standalone: Story = {
    ...story,
    storyMode: "standalone",
    plannedChapterCount: undefined,
    characters: [{ name: "Nobody Here" }],
    chapters: [chapter],
  };
  const { view } = await renderSheet({ story: standalone });
  expect(view.getByText("No named characters found")).toBeTruthy();
  expect(view.getByText("Rewrites the whole story")).toBeTruthy();
});

it("shows the previous failure and restores the prompt", async () => {
  const { view } = await renderSheet({ errorMessage: "The rewrite stopped early.", initialPrompt: "Keep the kettle." });
  expect(view.getByText("The rewrite stopped early.")).toBeTruthy();
  expect(view.getByLabelText("What should change").props.value).toBe("Keep the kettle.");
});
