/**
 * The story landing page.
 *
 * The assertion that matters most here is the chapter list handing back the
 * right INDEX. `onRead(n)` becomes the reader's opening chapter, so an
 * off-by-one puts a reader who tapped "Chapter 2" into chapter 1 - a bug that
 * looks like nothing at all in a screenshot and is only felt while reading.
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy({}, {
    get: () => () => ReactModule.createElement(ReactModule.Fragment),
  });
});

/* eslint-disable import/first */
import StoryDetailScreen from "@/screens/StoryDetailScreen";
import { stories } from "@/data/seed";
import type { Story } from "@/types/domain";
/* eslint-enable import/first */

const series = stories.find((story) => story.chapters.length > 1);
const standalone = stories.find((story) => story.chapters.length === 1);

/** `render` is async in RNTL 14, so every call site awaits this. */
const renderDetail = (story: Story, onRead = jest.fn()) =>
  render(
    <StoryDetailScreen
      story={story}
      onBack={jest.fn()}
      onRead={onRead}
      onAuthor={jest.fn()}
    />,
  );

it("has a series to test against in the seed catalogue", () => {
  // Guards the two tests below: if seed data ever loses its multi-chapter
  // stories, they would pass vacuously instead of failing loudly.
  expect(series).toBeDefined();
  expect(standalone).toBeDefined();
});

it("shows the title and the primary read action", async () => {
  const view = await renderDetail(series!);
  expect(view.getByText(series!.title)).toBeTruthy();
  expect(view.getByLabelText("Continue reading")).toBeTruthy();
});

it("opens the chapter the reader actually tapped", async () => {
  const onRead = jest.fn();
  const view = await renderDetail(series!, onRead);

  const last = series!.chapters[series!.chapters.length - 1];
  await fireEvent.press(
    view.getByLabelText(
      `Read chapter ${last.chapterNumber}: ${last.title}`,
    ),
  );

  expect(onRead).toHaveBeenCalledWith(series!.chapters.length - 1);
});

it("offers a single-chapter story a start action, not a chapter list", async () => {
  const view = await renderDetail(standalone!);
  expect(view.getByLabelText("Start reading")).toBeTruthy();
  expect(view.queryByLabelText(/^Read chapter/)).toBeNull();
});
