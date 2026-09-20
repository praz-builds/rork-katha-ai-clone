import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

import { RepromptSheet } from "@/components/reader/RepromptSheet";
import type { Chapter, Story } from "@/types/domain";

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
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
  chapters: [chapter, chapter],
  likes: 0,
  bookmarks: 0,
  views: 0,
  tags: [],
  publishedOffset: 0,
  isFeatured: false,
  language: "English",
};

async function renderSheet(
  overrides: Partial<React.ComponentProps<typeof RepromptSheet>> = {},
) {
  const onSubmit = jest.fn();
  const view = await render(
    <RepromptSheet
      visible
      story={story}
      chapter={chapter}
      onClose={jest.fn()}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { view, onSubmit };
}

it("offers one control and nothing else, with the button off until it is used", async () => {
  const { view } = await renderSheet();
  expect(view.getByText("Re-prompt this chapter")).toBeTruthy();
  expect(view.getByText("Chapter 2 · rewrites this chapter only")).toBeTruthy();
  // The roster is deliberately gone: a writer who wants somebody else in the
  // story says so in the box, and gets prose written for them rather than a
  // find-and-replace that cannot touch a pronoun.
  expect(view.queryByText("Aarav")).toBeNull();
  expect(view.queryByText(/Characters/i)).toBeNull();
  // The first run on a chapter is free on a free account; the literal
  // "1 credit" that used to sit here was wrong for it and for every subscriber.
  expect(view.getByText("Re-prompt · 1 free")).toBeTruthy();
  expect(
    view.getByLabelText("Re-prompt chapter").props.accessibilityState.disabled,
  ).toBe(true);
});

it("submits the trimmed prompt and nothing else", async () => {
  const { view, onSubmit } = await renderSheet();
  await fireEvent.changeText(
    view.getByLabelText("What should change"),
    "  Make it rain.  ",
  );
  const button = view.getByLabelText("Re-prompt chapter");
  expect(button.props.accessibilityState.disabled).toBe(false);
  await fireEvent.press(button);
  expect(onSubmit).toHaveBeenCalledWith({
    storyId: "s1",
    chapterNumber: 2,
    prompt: "Make it rain.",
  });
});

it("an empty prompt cannot be submitted, because there is nothing else to ask for", async () => {
  const { view, onSubmit } = await renderSheet();
  await fireEvent.changeText(view.getByLabelText("What should change"), "   ");
  const button = view.getByLabelText("Re-prompt chapter");
  expect(button.props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(button);
  expect(onSubmit).not.toHaveBeenCalled();
});

it("a standalone story is re-prompted whole, and says so", async () => {
  const { view } = await renderSheet({
    story: { ...story, storyMode: "standalone", plannedChapterCount: undefined },
  });
  expect(view.getByText("Re-prompt this story")).toBeTruthy();
  expect(view.getByText("Writes this story again, your way")).toBeTruthy();
  expect(view.getByLabelText("Re-prompt story")).toBeTruthy();
});

it("restores a prompt after a failure rather than making the writer retype it", async () => {
  const { view } = await renderSheet({
    initialPrompt: "Make it rain.",
    errorMessage: "The rewrite failed on the server.",
  });
  expect(view.getByText("The rewrite failed on the server.")).toBeTruthy();
  expect(view.getByLabelText("What should change").props.value).toBe("Make it rain.");
});
