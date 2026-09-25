/**
 * Profile's "Languages and home" sheet.
 *
 * Save replaces BOTH fields, so the failure worth guarding is a quiet erase:
 * a read that failed (or has not landed) leaves an empty stand-in, and a save
 * made from it would wipe the city and languages the reader already had.
 */

/* eslint-disable import/first */
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react-native";

const mockInvoke = jest.fn();
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));
jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn().mockResolvedValue({ userId: "u1" }) }));

import ReaderContextSheet from "@/components/profile/ReaderContextSheet";
import type { ReaderPreferences } from "@/lib/reader-preferences";

const EMPTY: ReaderPreferences = { spokenLanguages: [], homePlace: null };
const SAVED: ReaderPreferences = { spokenLanguages: ["hi", "en"], homePlace: "Pune" };

beforeEach(() => mockInvoke.mockReset());
afterEach(cleanup);

it("shows no form, and so cannot save, until the saved value is known", async () => {
  const onRetry = jest.fn();
  const view = await render(
    <ReaderContextSheet
      visible
      value={EMPTY}
      status="failed"
      onRetry={onRetry}
      onSaved={jest.fn()}
      onClose={jest.fn()}
    />,
  );
  expect(view.queryByTestId("reader-context-save")).toBeNull();
  expect(view.queryByTestId("reader-context-place")).toBeNull();
  await act(async () => {
    await fireEvent.press(view.getByTestId("reader-context-retry"));
  });
  expect(onRetry).toHaveBeenCalledTimes(1);
  expect(mockInvoke).not.toHaveBeenCalled();
});

it("a read that lands while the sheet is open does not overwrite what is being typed", async () => {
  const props = {
    visible: true,
    onRetry: jest.fn(),
    onSaved: jest.fn(),
    onClose: jest.fn(),
  };
  const view = await render(
    <ReaderContextSheet {...props} value={SAVED} status="ready" />,
  );
  expect(view.getByTestId("reader-context-place").props.value).toBe("Pune");
  await act(async () => {
    fireEvent.changeText(view.getByTestId("reader-context-place"), "Mumbai");
  });
  await view.rerender(
    <ReaderContextSheet
      {...props}
      value={{ spokenLanguages: ["ta"], homePlace: "Chennai" }}
      status="ready"
    />,
  );
  expect(view.getByTestId("reader-context-place").props.value).toBe("Mumbai");
});

it("a save that lands after a close-and-reopen does not close the new opening", async () => {
  let resolveSave: (value: unknown) => void = () => {};
  mockInvoke.mockReturnValueOnce(new Promise((r) => { resolveSave = r; }));
  const props = {
    value: SAVED,
    status: "ready" as const,
    onRetry: jest.fn(),
    onSaved: jest.fn(),
    onClose: jest.fn(),
  };
  const view = await render(<ReaderContextSheet {...props} visible />);
  await act(async () => {
    await fireEvent.press(view.getByTestId("reader-context-save"));
  });
  await view.rerender(<ReaderContextSheet {...props} visible={false} />);
  await view.rerender(<ReaderContextSheet {...props} visible />);
  await act(async () => {
    resolveSave({ data: { spokenLanguages: ["hi", "en"], homePlace: "Pune" }, error: null });
  });
  // The server's answer is still reported; the new opening stays open.
  expect(props.onSaved).toHaveBeenCalledWith({ spokenLanguages: ["hi", "en"], homePlace: "Pune" });
  expect(props.onClose).not.toHaveBeenCalled();
});
