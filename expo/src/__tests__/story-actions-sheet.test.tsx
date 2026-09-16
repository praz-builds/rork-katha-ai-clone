/**
 * The story's "..." sheet: report the story, block its author.
 *
 * The report step is the D13 form -- four story reasons, optional details,
 * Cancel + Submit Report -- and it must file exactly what the reporter chose,
 * send no details when they wrote none, and never thank them for a report
 * that did not save.
 */
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
import {
  REPORT_REASONS,
  STORY_REPORT_REASONS,
} from "@/components/comments/types";
/* eslint-enable import/first */

const renderSheet = (
  props: Partial<React.ComponentProps<typeof StoryActionsSheet>> = {},
) =>
  render(
    <StoryActionsSheet
      visible
      storyTitle="The Lighthouse"
      authorName="Mira"
      onClose={jest.fn()}
      onBlockAuthor={jest.fn()}
      {...props}
    />,
  );

it("keeps the comment report reasons on their own list", () => {
  expect(
    REPORT_REASONS.find((reason) =>
      reason.label === "Sexual content involving minors"
    )?.id,
  ).toBe("sexual_content");
  expect(REPORT_REASONS.map((reason) => reason.id)).not.toContain("copyright");
});

it("names the four story reasons with the ids the server accepts", () => {
  expect(STORY_REPORT_REASONS).toEqual([
    { id: "copyright", label: "Copyright violation" },
    { id: "inappropriate_content", label: "Inappropriate story content" },
    { id: "inappropriate_cover", label: "Inappropriate cover image" },
    { id: "other", label: "Other" },
  ]);
});

describe("the report form", () => {
  it("shows the title, the four radio rows, an optional details field and the two footer actions", async () => {
    const view = await renderSheet();
    await fireEvent.press(view.getByLabelText("Report story"));

    expect(view.getByText("Report story")).toBeTruthy();
    for (const option of STORY_REPORT_REASONS) {
      const row = view.getByLabelText(option.label);
      expect(row.props.accessibilityRole).toBe("radio");
    }
    expect(view.getByText("Details (optional)")).toBeTruthy();
    expect(view.getByTestId("story-report-details-input")).toBeTruthy();
    expect(view.getByText("Submit Report")).toBeTruthy();
    expect(view.getByLabelText("Cancel")).toBeTruthy();
  });

  it("cannot be sent until a reason is chosen, and needs no details", async () => {
    const onSubmitReport = jest.fn().mockResolvedValue(undefined);
    const view = await renderSheet({ onSubmitReport });
    await fireEvent.press(view.getByLabelText("Report story"));

    const submit = view.getByLabelText("Submit report");
    expect(submit.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(submit);
    expect(onSubmitReport).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText("Inappropriate cover image"));
    expect(
      view.getByLabelText("Inappropriate cover image").props.accessibilityState
        .checked,
    ).toBe(true);
    expect(view.getByLabelText("Submit report").props.accessibilityState.disabled)
      .toBe(false);

    await fireEvent.press(view.getByLabelText("Submit report"));
    await waitFor(() =>
      expect(onSubmitReport).toHaveBeenCalledWith("inappropriate_cover", "")
    );
    expect(view.getByText("Story reported")).toBeTruthy();
  });

  it("passes the trimmed details along when the reporter wrote some", async () => {
    const onSubmitReport = jest.fn().mockResolvedValue(undefined);
    const view = await renderSheet({ onSubmitReport });
    await fireEvent.press(view.getByLabelText("Report story"));
    await fireEvent.press(view.getByLabelText("Copyright violation"));
    await fireEvent.changeText(
      view.getByTestId("story-report-details-input"),
      "  This is lifted from a published novel.  ",
    );
    await fireEvent.press(view.getByLabelText("Submit report"));

    await waitFor(() =>
      expect(onSubmitReport).toHaveBeenCalledWith(
        "copyright",
        "This is lifted from a published novel.",
      )
    );
  });

  it("selects one reason at a time", async () => {
    const view = await renderSheet();
    await fireEvent.press(view.getByLabelText("Report story"));
    await fireEvent.press(view.getByLabelText("Other"));
    await fireEvent.press(view.getByLabelText("Inappropriate story content"));

    expect(view.getByLabelText("Other").props.accessibilityState.checked).toBe(
      false,
    );
    expect(
      view.getByLabelText("Inappropriate story content").props
        .accessibilityState.checked,
    ).toBe(true);
  });

  it("stays on the form and says so when the report does not save", async () => {
    const onSubmitReport = jest.fn().mockRejectedValue(new Error("offline"));
    const view = await renderSheet({ onSubmitReport });
    await fireEvent.press(view.getByLabelText("Report story"));
    await fireEvent.press(view.getByLabelText("Other"));
    await fireEvent.press(view.getByLabelText("Submit report"));

    await waitFor(() =>
      expect(
        view.getByText(
          "That report did not save. Check your connection and try again.",
        ),
      ).toBeTruthy()
    );
    expect(view.queryByText("Story reported")).toBeNull();
    expect(view.getByTestId("story-report-details-input")).toBeTruthy();
  });

  it("closes from the footer Cancel", async () => {
    const onClose = jest.fn();
    const view = await renderSheet({ onClose });
    await fireEvent.press(view.getByLabelText("Report story"));
    await fireEvent.press(view.getByLabelText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

it("keeps the block confirmation open when the block write fails", async () => {
  const onClose = jest.fn();
  const onBlockAuthor = jest.fn().mockResolvedValue(false);
  const view = await renderSheet({ onClose, onBlockAuthor });

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
