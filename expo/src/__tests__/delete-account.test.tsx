/**
 * Deleting an account: three steps, and the middle one is the point.
 *
 * In its own file because `DeleteAccountSheet` renders inside a `Modal`, and a
 * modal left mounted by one test is still in the tree for the next -- which
 * made every assertion after the first one in a shared file match a stale
 * screen and time out. A separate suite gets a clean module registry and a
 * clean tree per test.
 */
import React from "react";
import {

  fireEvent,
  render,
  waitFor,
} from "@testing-library/react-native";

/**
 * `Modal` renders its children inline here.
 *
 * React Native's test mock keeps at most one modal in the tree, so the second
 * sheet rendered in a file comes back empty and every query against it fails
 * with "unable to find". Nothing in these tests is about modal presentation --
 * they are about the three steps inside it -- so the wrapper is flattened.
 */
jest.mock("react-native/Libraries/Modal/Modal", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  const Flattened = ({
    visible,
    children,
  }: {
    visible?: boolean;
    children?: React.ReactNode;
  }) => (visible === false ? null : React.createElement(React.Fragment, null, children));
  return { __esModule: true, default: Flattened };
});

const mockDeleteAccount = jest.fn();

jest.mock("@/lib/profile", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...jest.requireActual("@/lib/profile"),
  deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
}));

/* eslint-disable import/first */
import DeleteAccountSheet from "@/components/profile/DeleteAccountSheet";
/* eslint-enable import/first */




beforeEach(() => {
  mockDeleteAccount.mockReset();
});

describe("deleting an account", () => {
  // Three steps, and the middle one is the point: a reason, then the specific
  // truth about what happens, then a word typed by hand.
  it("will not go on until a reason is chosen", async () => {
    const view = await render(
      <DeleteAccountSheet
        visible
        onClose={jest.fn()}
        onDeleted={jest.fn()}
      />,
    );

    await waitFor(() => view.getByTestId("delete-continue"));
    fireEvent.press(view.getByTestId("delete-continue"));
    // Still on step one: no confirmation field has appeared.
    expect(view.queryByTestId("delete-confirm-input")).toBeNull();

    fireEvent.press(view.getByTestId("delete-reason-not_reading"));
    await waitFor(() => view.getByTestId("delete-continue"));
    fireEvent.press(view.getByTestId("delete-continue"));
    await waitFor(() => view.getByTestId("delete-confirm-input"));
  });

  // The part people do not expect, said before they act rather than
  // discovered afterwards.
  it("says plainly that published work survives without their name", async () => {
    const view = await render(
      <DeleteAccountSheet visible onClose={jest.fn()} onDeleted={jest.fn()} />,
    );

    await waitFor(() => view.getByTestId("delete-reason-privacy"));
    fireEvent.press(view.getByTestId("delete-reason-privacy"));
    await waitFor(() => view.getByTestId("delete-continue"));
    fireEvent.press(view.getByTestId("delete-continue"));

    await waitFor(() => view.getByText("What stays"));
    expect(view.getByText(/stay readable — but with your name removed/))
      .toBeTruthy();
    expect(view.getByText("What is deleted")).toBeTruthy();
  });

  it("does nothing until the word is typed exactly", async () => {
    const view = await render(
      <DeleteAccountSheet visible onClose={jest.fn()} onDeleted={jest.fn()} />,
    );

    await waitFor(() => view.getByTestId("delete-reason-other"));
    fireEvent.press(view.getByTestId("delete-reason-other"));
    await waitFor(() => view.getByTestId("delete-continue"));
    fireEvent.press(view.getByTestId("delete-continue"));
    await waitFor(() => view.getByTestId("delete-confirm-input"));

    fireEvent.press(view.getByTestId("delete-confirm"));
    expect(mockDeleteAccount).not.toHaveBeenCalled();

    fireEvent.changeText(view.getByTestId("delete-confirm-input"), "delet");
    fireEvent.press(view.getByTestId("delete-confirm"));
    expect(mockDeleteAccount).not.toHaveBeenCalled();
  });

  it("deletes once, and reports what survived", async () => {
    mockDeleteAccount.mockResolvedValue({ ok: true, storiesKept: 2 });
    const onDeleted = jest.fn();
    const view = await render(
      <DeleteAccountSheet visible onClose={jest.fn()} onDeleted={onDeleted} />,
    );

    await waitFor(() => view.getByTestId("delete-reason-too_expensive"));
    fireEvent.press(view.getByTestId("delete-reason-too_expensive"));
    await waitFor(() => view.getByTestId("delete-continue"));
    fireEvent.press(view.getByTestId("delete-continue"));
    await waitFor(() => view.getByTestId("delete-confirm-input"));

    // Case-insensitive on purpose: the friction is typing the word, not
    // fighting a keyboard's autocapitalisation.
    fireEvent.changeText(view.getByTestId("delete-confirm-input"), "delete");
    // Settle before pressing: the button's disabled state is derived from the
    // text, and a press in the same tick reads the value from before it.
    await waitFor(() =>
      expect(view.getByTestId("delete-confirm-input").props.value).toBe("delete")
    );
    fireEvent.press(view.getByTestId("delete-confirm"));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(2));
    expect(mockDeleteAccount).toHaveBeenCalledWith("too_expensive", "");
  });

  // A failed delete must say so and change nothing, because the alternative is
  // somebody believing their account is gone when it is not.
  it("keeps the account and says so when the delete fails", async () => {
    mockDeleteAccount.mockResolvedValue({ ok: false });
    const onDeleted = jest.fn();
    const view = await render(
      <DeleteAccountSheet visible onClose={jest.fn()} onDeleted={onDeleted} />,
    );

    await waitFor(() => view.getByTestId("delete-reason-other"));
    fireEvent.press(view.getByTestId("delete-reason-other"));
    await waitFor(() => view.getByTestId("delete-continue"));
    fireEvent.press(view.getByTestId("delete-continue"));
    await waitFor(() => view.getByTestId("delete-confirm-input"));
    fireEvent.changeText(view.getByTestId("delete-confirm-input"), "DELETE");
    // Settle before pressing: the button's disabled state is derived from the
    // text, and a press in the same tick reads the value from before it.
    await waitFor(() =>
      expect(view.getByTestId("delete-confirm-input").props.value).toBe("DELETE")
    );
    fireEvent.press(view.getByTestId("delete-confirm"));

    await waitFor(() => view.getByTestId("delete-error"));
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
