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
import {
  clearReaderPreferencesCache,
  type ReaderPreferences,
} from "@/lib/reader-preferences";

const EMPTY: ReaderPreferences = { spokenLanguages: [], unrecognisedLanguages: [], homePlace: null };
const SAVED: ReaderPreferences = { spokenLanguages: ["hi", "en"], unrecognisedLanguages: [], homePlace: "Pune" };

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
      value={{ spokenLanguages: ["ta"], unrecognisedLanguages: [], homePlace: "Chennai" }}
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
  expect(props.onSaved).toHaveBeenCalledWith({ spokenLanguages: ["hi", "en"], unrecognisedLanguages: [], homePlace: "Pune" });
  expect(props.onClose).not.toHaveBeenCalled();
});

it("a pasted city that is too long is explained, not silently cut", async () => {
  const view = await render(
    <ReaderContextSheet
      visible
      value={SAVED}
      status="ready"
      onRetry={jest.fn()}
      onSaved={jest.fn()}
      onClose={jest.fn()}
    />,
  );
  const long = "Thiruvananthapuram Kazhakkoottam Technopark Phase Three Campus";
  await act(async () => {
    fireEvent.changeText(view.getByTestId("reader-context-place"), long);
  });
  const place = view.getByTestId("reader-context-place");
  // React Native's Jest host does not enforce `maxLength`, so asserting only
  // the value/message would pass even if the native input silently truncated
  // a pasted city. The prop is the regression: it must stay absent.
  expect(place.props.maxLength).toBeUndefined();
  expect(place.props.value).toBe(long);
  view.getByTestId("reader-context-place-error");
  await act(async () => {
    await fireEvent.press(view.getByTestId("reader-context-save"));
  });
  expect(mockInvoke).not.toHaveBeenCalled();
});

function refusal(status: number, body: Record<string, unknown>) {
  return {
    data: null,
    error: Object.assign(new Error("fn"), {
      context: { status, json: () => Promise.resolve(body) },
    }),
  };
}

async function openReady(onClose = jest.fn()) {
  const view = await render(
    <ReaderContextSheet
      visible
      value={SAVED}
      status="ready"
      onRetry={jest.fn()}
      onSaved={jest.fn()}
      onClose={onClose}
    />,
  );
  return view;
}

it("shows the reader copy for a refusal, and clears it when a chip is changed", async () => {
  mockInvoke.mockResolvedValueOnce(
    refusal(400, { error: "spokenLanguages has an unknown language", reason: "unknown_language" }),
  );
  const view = await openReady();
  await act(async () => {
    await fireEvent.press(view.getByTestId("reader-context-save"));
  });
  const error = view.getByTestId("reader-context-error");
  expect(error.props.children).toBe(
    "One of these languages is not available yet. Remove the one you added last and try again.",
  );
  // Doing what it asks takes it away.
  await act(async () => {
    await fireEvent.press(view.getByTestId("reader-context-language-en"));
  });
  expect(view.queryByTestId("reader-context-error")).toBeNull();
});

it("a refusal from a function older than the codes gets the generic line", async () => {
  mockInvoke.mockResolvedValueOnce(
    refusal(400, { error: "spokenLanguages has an unknown language" }),
  );
  const view = await openReady();
  await act(async () => {
    await fireEvent.press(view.getByTestId("reader-context-save"));
  });
  expect(view.getByTestId("reader-context-error").props.children).toBe(
    "That could not be saved. Check your choices and try again.",
  );
});

it("a save that lands after an account switch closes the sheet and reports nothing", async () => {
  let resolveSave: (value: unknown) => void = () => {};
  mockInvoke.mockReturnValueOnce(new Promise((r) => { resolveSave = r; }));
  const onClose = jest.fn();
  const onSaved = jest.fn();
  const view = await render(
    <ReaderContextSheet
      visible
      value={SAVED}
      status="ready"
      onRetry={jest.fn()}
      onSaved={onSaved}
      onClose={onClose}
    />,
  );
  await act(async () => {
    fireEvent.press(view.getByTestId("reader-context-save"));
  });
  clearReaderPreferencesCache();
  await act(async () => {
    resolveSave({ data: { spokenLanguages: ["hi", "en"], homePlace: "Pune" }, error: null });
  });
  expect(onSaved).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(view.queryByTestId("reader-context-error")).toBeNull();
});

it("counts a language it cannot show against the cap, and says so", async () => {
  // A reader who set a 31st language on a newer build. This build cannot name
  // it, but the server counts it against the three, so the chips must too --
  // and the reader has to be told, or a dead chip has no explanation.
  const withHidden: ReaderPreferences = {
    spokenLanguages: ["hi", "en"],
    unrecognisedLanguages: ["bho"],
    homePlace: "Pune",
  };
  const view = await render(
    <ReaderContextSheet
      visible
      value={withHidden}
      status="ready"
      onRetry={jest.fn()}
      onSaved={jest.fn()}
      onClose={jest.fn()}
    />,
  );

  expect(
    view.getByText(
      "Pick up to 3. One is taken by a language you set on a newer version of the app: it is kept on your account and saving will not remove it, but this version cannot show it.",
    ),
  ).toBeTruthy();

  // Two lit plus one hidden is the cap, so an unpicked chip is dead.
  const unpicked = view.getByTestId("reader-context-language-ta");
  expect(unpicked.props.accessibilityState.disabled).toBe(true);
  // A picked one stays pressable, so it can still be removed.
  const picked = view.getByTestId("reader-context-language-hi");
  expect(picked.props.accessibilityState.disabled).toBe(false);

  // And Save sends it back untouched rather than erasing it.
  mockInvoke.mockResolvedValueOnce({
    data: { spokenLanguages: ["hi", "en", "bho"], homePlace: "Pune" },
    error: null,
  });
  await act(async () => {
    await fireEvent.press(view.getByTestId("reader-context-save"));
  });
  expect(mockInvoke).toHaveBeenCalledWith("profile", {
    body: {
      action: "set_preferences",
      spokenLanguages: ["hi", "en", "bho"],
      homePlace: "Pune",
    },
  });
});
