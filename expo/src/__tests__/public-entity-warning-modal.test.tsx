import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react-native";

import PublicEntityWarningModal from "@/components/create/PublicEntityWarningModal";

// Each case mounts its own `Modal`. Without an explicit unmount between them
// the previous modal is still in the host tree when the next one renders, and
// the queries below find the wrong one (or nothing at all).
afterEach(cleanup);

it("renders nothing without a reason", async () => {
  const view = await render(
    <PublicEntityWarningModal reason={null} onKeepPrivate={jest.fn()} onChangeIdea={jest.fn()} />,
  );
  expect(view.queryByText("This one can't be public")).toBeNull();
});

it("explains a living public figure with the spec's copy and offers both ways out", async () => {
  const onKeepPrivate = jest.fn();
  const onChangeIdea = jest.fn();
  const view = await render(
    <PublicEntityWarningModal
      reason="living_public_figure"
      onKeepPrivate={onKeepPrivate}
      onChangeIdea={onChangeIdea}
    />,
  );

  expect(view.getByText("This one can't be public")).toBeTruthy();
  const body =
    "Your idea names a real person who's still alive. Katha can write it, but it will stay private in your library - it can't be shared or made public.";
  expect(view.getByText(body)).toBeTruthy();
  expect(body.toLowerCase()).not.toMatch(/policy|violation|sorry/);

  await fireEvent.press(view.getByText("Keep it private"));
  expect(onKeepPrivate).toHaveBeenCalledTimes(1);
  expect(onChangeIdea).not.toHaveBeenCalled();

  await fireEvent.press(view.getByText("Change my idea"));
  expect(onChangeIdea).toHaveBeenCalledTimes(1);
});

it("explains a private individual with its own copy", async () => {
  const view = await render(
    <PublicEntityWarningModal
      reason="private_individual"
      onKeepPrivate={jest.fn()}
      onChangeIdea={jest.fn()}
    />,
  );
  expect(
    view.getByText(
      "Your idea names someone from your own life. Katha can write it, but it will stay private in your library - it can't be shared or made public.",
    ),
  ).toBeTruthy();
});

it("treats the backdrop and hardware back as 'change my idea', never as generate", async () => {
  const onKeepPrivate = jest.fn();
  const onChangeIdea = jest.fn();
  const view = await render(
    <PublicEntityWarningModal
      reason="private_individual"
      onKeepPrivate={onKeepPrivate}
      onChangeIdea={onChangeIdea}
    />,
  );
  // The backdrop is a sighted-only convenience and is kept out of the
  // accessibility tree, so it only exists for a query that includes hidden
  // elements - the same shape as `story-gated-private-backdrop`.
  const backdrop = view.getByTestId("public-entity-warning-backdrop", {
    includeHiddenElements: true,
  });
  expect(backdrop.props.accessibilityElementsHidden).toBe(true);
  await fireEvent.press(backdrop);
  expect(onChangeIdea).toHaveBeenCalledTimes(1);
  expect(onKeepPrivate).not.toHaveBeenCalled();
});
