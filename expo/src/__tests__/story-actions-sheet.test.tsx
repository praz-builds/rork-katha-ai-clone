import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy({}, {
    get: () => () => ReactModule.createElement(ReactModule.Fragment),
  });
});

/* eslint-disable import/first */
import StoryActionsSheet from "@/components/moderation/StoryActionsSheet";
import { REPORT_REASONS } from "@/components/comments/types";
/* eslint-enable import/first */

it("uses the backend report reason id for sexual-content reports", () => {
  expect(
    REPORT_REASONS.find((reason) =>
      reason.label === "Sexual content involving minors"
    )?.id,
  ).toBe("sexual_content");
});

it("keeps the block confirmation open when the block write fails", async () => {
  const onClose = jest.fn();
  const onBlockAuthor = jest.fn().mockResolvedValue(false);
  const view = await render(
    <StoryActionsSheet
      visible
      storyTitle="The Lighthouse"
      authorName="Mira"
      onClose={onClose}
      onBlockAuthor={onBlockAuthor}
    />,
  );

  await fireEvent.press(view.getByLabelText("Block Mira"));
  await fireEvent.press(view.getByLabelText("Confirm block Mira"));

  await waitFor(() =>
    expect(
      view.getByText("That block did not save. Check your connection and try again."),
    ).toBeTruthy()
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(view.getByLabelText("Confirm block Mira")).toBeTruthy();
});
