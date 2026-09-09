import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

import StoryGatedPrivateModal from "@/components/create/StoryGatedPrivateModal";

it("renders nothing when there is no gating reason", async () => {
  const onAcknowledge = jest.fn();
  const view = await render(
    <StoryGatedPrivateModal reason={null} onAcknowledge={onAcknowledge} />,
  );
  expect(view.queryByText("This one stays private")).toBeNull();
});

it("explains a living public figure gate and dismisses on acknowledgement", async () => {
  const onAcknowledge = jest.fn();
  const view = await render(
    <StoryGatedPrivateModal
      reason="living_public_figure"
      onAcknowledge={onAcknowledge}
    />,
  );

  expect(view.getByText("This one stays private")).toBeTruthy();
  const body =
    "This story names a real person who's still alive, so it stays private. It's in your library to read and continue - it just can't be shared or made public.";
  expect(view.getByText(body)).toBeTruthy();

  // Never these words: an explanation, not a warning.
  expect(body.toLowerCase()).not.toMatch(/policy|violation/);

  fireEvent.press(view.getByLabelText("Got it, close this explanation"));
  expect(onAcknowledge).toHaveBeenCalledTimes(1);
});

it("explains a private individual gate with its own copy", async () => {
  const onAcknowledge = jest.fn();
  const view = await render(
    <StoryGatedPrivateModal
      reason="private_individual"
      onAcknowledge={onAcknowledge}
    />,
  );

  expect(
    view.getByText(
      "This story names someone from your own life, so it stays private. It's in your library to read and continue - it just can't be shared or made public.",
    ),
  ).toBeTruthy();
});

it("explains an unfinished check as temporary, without claiming the idea names anyone", async () => {
  // The 2026-09-09 defect's copy. A story that was never checked has not been
  // judged, and the two things the writer needs to know are that it is saved
  // and that it can go public later. Reusing the gate copy here would tell
  // them their idea names a real living person - something no check ever said.
  const view = await render(
    <StoryGatedPrivateModal
      reason="classification_unavailable"
      onAcknowledge={jest.fn()}
    />,
  );

  expect(view.getByText("Kept private for now")).toBeTruthy();
  const body =
    "Katha couldn't finish checking this story in time, so it's been kept private for now. It's saved in your library to read and continue, and you can publish it later.";
  expect(view.getByText(body)).toBeTruthy();

  // An explanation, not a warning, and not a claim about the story's content.
  expect(body.toLowerCase()).not.toMatch(/policy|violation/);
  expect(body.toLowerCase()).not.toMatch(/real person|someone from your own/);
  expect(body).toMatch(/publish it later/);
});

it("exposes a single acknowledgement control with a real accessible name", async () => {
  const view = await render(
    <StoryGatedPrivateModal reason="living_public_figure" onAcknowledge={jest.fn()} />,
  );
  const button = view.getByLabelText("Got it, close this explanation");
  expect(button.props.accessibilityRole).toBe("button");
});

it("keeps the backdrop out of the accessibility tree, so a screen reader has exactly one control to act on", async () => {
  const view = await render(
    <StoryGatedPrivateModal reason="private_individual" onAcknowledge={jest.fn()} />,
  );
  // The backdrop is a sighted-only convenience: findable with hidden elements
  // included, invisible to a screen reader's default traversal. The single
  // reachable control is the acknowledgement button asserted above.
  const backdrop = view.getByTestId("story-gated-private-backdrop", {
    includeHiddenElements: true,
  });
  expect(backdrop.props.accessibilityElementsHidden).toBe(true);
  fireEvent.press(backdrop);
});
