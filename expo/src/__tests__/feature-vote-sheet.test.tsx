/**
 * Vote on what's next: a vote the server refuses is put back exactly, a vote
 * the server already had reloads the counts rather than counting twice, a
 * missing tally is "couldn't load" rather than zero, and a vote that resolves
 * after the sheet closed changes nothing.
 */
/* eslint-disable import/first */
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockInsert = jest.fn();
const mockDeleteEq = jest.fn();
const mockRpc = jest.fn();
const mockTopics = jest.fn();

jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: (table: string) => {
      if (table === "feedback_topics") {
        return { select: () => ({ order: () => mockTopics() }) };
      }
      return {
        insert: (row: unknown) => mockInsert(table, row),
        delete: () => ({ eq: (...args: unknown[]) => mockDeleteEq(table, ...args) }),
      };
    },
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import FeatureVoteSheet from "@/components/profile/FeatureVoteSheet";

const DARK = { id: "dark_mode_app", title: "Dark mode", detail: null, status: "open", sort_order: 10 };

beforeEach(() => {
  mockInsert.mockReset();
  mockDeleteEq.mockReset();
  mockRpc.mockReset();
  mockTopics.mockReset();
  mockTopics.mockResolvedValue({ data: [DARK], error: null });
});
afterEach(cleanup);

it("votes, and puts the vote back when the server refuses", async () => {
  mockTopics.mockResolvedValue({
    data: [
      DARK,
      { id: "more_voices", title: "More narration voices", detail: null, status: "shipped", sort_order: 50 },
    ],
    error: null,
  });
  mockRpc.mockResolvedValue({
    data: [{ topic_id: "dark_mode_app", votes: 4, voted: false }],
    error: null,
  });
  mockInsert.mockResolvedValue({ error: { code: "42501", message: "denied" } });

  const view = await render(<FeatureVoteSheet visible onClose={jest.fn()} />);
  const topic = await view.findByTestId("feature-vote-dark_mode_app");
  expect(topic.props.accessibilityLabel).toBe("Dark mode, 4 votes");
  // Shipped work is shown but cannot be voted on.
  expect(view.getByTestId("feature-vote-more_voices").props.accessibilityState.disabled).toBe(true);

  await fireEvent.press(topic);
  await waitFor(() => expect(view.getByTestId("feature-vote-notice")).toBeTruthy());
  expect(mockInsert).toHaveBeenCalledWith("feedback_votes", { topic_id: "dark_mode_app" });
  const restored = view.getByTestId("feature-vote-dark_mode_app");
  expect(restored.props.accessibilityLabel).toBe("Dark mode, 4 votes");
  expect(restored.props.accessibilityState.selected).toBe(false);
});

it("reloads the counts when the server already had the vote, rather than counting it twice", async () => {
  mockRpc
    .mockResolvedValueOnce({ data: [{ topic_id: "dark_mode_app", votes: 4, voted: false }], error: null })
    .mockResolvedValueOnce({ data: [{ topic_id: "dark_mode_app", votes: 4, voted: true }], error: null });
  mockInsert.mockResolvedValue({ error: { code: "23505", message: "duplicate key" } });

  const view = await render(<FeatureVoteSheet visible onClose={jest.fn()} />);
  await fireEvent.press(await view.findByTestId("feature-vote-dark_mode_app"));
  await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(view.getByTestId("feature-vote-dark_mode_app").props.accessibilityLabel)
      .toBe("Dark mode, 4 votes")
  );
  expect(view.getByTestId("feature-vote-dark_mode_app").props.accessibilityState.selected)
    .toBe(true);
});

it("shows the list as unavailable when the counts cannot load, rather than as zero", async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
  const view = await render(<FeatureVoteSheet visible onClose={jest.fn()} />);
  expect(await view.findByTestId("feature-votes-error")).toBeTruthy();
  expect(view.queryByTestId("feature-vote-dark_mode_app")).toBeNull();
});

it("ignores a vote that finishes after the sheet was closed", async () => {
  mockRpc.mockResolvedValue({
    data: [{ topic_id: "dark_mode_app", votes: 4, voted: false }],
    error: null,
  });
  let finish: (value: { error: unknown }) => void = () => {};
  mockInsert.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));

  const view = await render(<FeatureVoteSheet visible onClose={jest.fn()} />);
  await fireEvent.press(await view.findByTestId("feature-vote-dark_mode_app"));
  await view.rerender(<FeatureVoteSheet visible={false} onClose={jest.fn()} />);
  await view.rerender(<FeatureVoteSheet visible onClose={jest.fn()} />);
  await waitFor(() =>
    expect(view.getByTestId("feature-vote-dark_mode_app").props.accessibilityLabel)
      .toBe("Dark mode, 4 votes")
  );
  await act(async () => {
    finish({ error: { code: "42501", message: "denied" } });
  });
  // The old session's failure neither writes a notice nor subtracts a vote
  // from the counts the new session loaded.
  expect(view.queryByTestId("feature-vote-notice")).toBeNull();
  expect(view.getByTestId("feature-vote-dark_mode_app").props.accessibilityLabel)
    .toBe("Dark mode, 4 votes");
});
