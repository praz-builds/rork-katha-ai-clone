/**
 * Two phrases removed at once, and only one of them fails.
 *
 * Removal is optimistic: the row leaves the list immediately and the write
 * happens behind it, because a spinner on a delete is a spinner nobody
 * needed. The rollback is the part that has to be careful.
 *
 * It used to snapshot the WHOLE list before removing, and restore that
 * snapshot if the write failed. Two removals in quick succession both read
 * the same snapshot — the list as it stood before either of them — so if the
 * second failed, its rollback reinstated the first as well. That first
 * phrase was already gone from storage, so the list then showed a phrase
 * that no longer existed, and the next launch removed it again with no
 * explanation. The reader deleted one thing and watched a different one come
 * back from the dead.
 */
import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy({}, {
    get: () => () => ReactModule.createElement(ReactModule.Fragment),
  });
});
jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
  isSupabaseConfigured: false,
}));

/**
 * Real phrase storage, with only `unsavePhrase` under the test's control —
 * the point is which removals resolve, and in what order.
 */
const mockUnsave = jest.fn<Promise<boolean>, [string]>();
jest.mock("@/lib/phrases", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...jest.requireActual("@/lib/phrases"),
  unsavePhrase: (id: string) => mockUnsave(id),
}));

/* eslint-disable import/first */
import NotesTab from "@/components/library/NotesTab";
import { saveManualPhrases } from "@/lib/phrases";
/* eslint-enable import/first */

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

beforeEach(async () => {
  await storage.clear();
  mockUnsave.mockReset();
});

it("a failed removal restores only itself, not a phrase already deleted", async () => {
  const [first, second] = await saveManualPhrases(
    ["cold feet", "spill the beans"],
    "English",
  );

  // The first removal succeeds. The second fails. Neither has resolved when
  // the other is tapped, which is what makes them concurrent.
  let resolveFirst: (ok: boolean) => void = () => {};
  let resolveSecond: (ok: boolean) => void = () => {};
  mockUnsave.mockImplementation((id) =>
    new Promise<boolean>((resolve) => {
      if (id === first.id) resolveFirst = resolve;
      else resolveSecond = resolve;
    })
  );

  const view = await render(<NotesTab />);
  await waitFor(() => expect(view.getByText("cold feet")).toBeTruthy());

  await fireEvent.press(view.getByTestId(`notes-remove-${first.id}`));
  await fireEvent.press(view.getByTestId(`notes-remove-${second.id}`));

  // Both are optimistically gone from the list.
  await waitFor(() => expect(view.queryByText("cold feet")).toBeNull());
  expect(view.queryByText("spill the beans")).toBeNull();

  await act(async () => {
    resolveFirst(true);
    resolveSecond(false);
  });

  // The one that failed comes back, with the explanation.
  await waitFor(() =>
    expect(view.getByText("spill the beans")).toBeTruthy()
  );
  expect(view.getByTestId("notes-remove-error")).toBeTruthy();

  // The one that SUCCEEDED stays gone. This is the assertion the old
  // snapshot rollback failed.
  expect(view.queryByText("cold feet")).toBeNull();
});

it("puts a failed removal back where it was, not at the top", async () => {
  const saved = await saveManualPhrases(
    ["cold feet", "spill the beans", "under the weather"],
    "English",
  );
  mockUnsave.mockResolvedValue(false);

  const view = await render(<NotesTab />);
  await waitFor(() => expect(view.getByText("cold feet")).toBeTruthy());

  const order = () =>
    view.getAllByLabelText(/^Remove /).map((node) =>
      String(node.props.accessibilityLabel).replace(/^Remove /, "")
    );
  const before = order();
  const middle = saved.find((entry) => entry.phrase === before[1])!;

  // The MIDDLE one, so a rollback that simply prepends is distinguishable
  // from one that puts the phrase back where the reader last saw it.
  await fireEvent.press(view.getByTestId(`notes-remove-${middle.id}`));
  await waitFor(() =>
    expect(view.getByTestId("notes-remove-error")).toBeTruthy()
  );

  expect(order()).toEqual(before);
});
