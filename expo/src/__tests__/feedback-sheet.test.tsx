/**
 * Profile's "Send feedback" sheet.
 *
 * The failures worth guarding are the quiet ones: a "Thank you" for a message
 * that never arrived, a paragraph wiped by a failed send, a retry filed twice,
 * and "check your connection" said to somebody who was simply rate limited.
 */

/* eslint-disable import/first */
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";

const mockInvoke = jest.fn();
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));
jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn().mockResolvedValue({ userId: "u1" }) }));

import FeedbackSheet from "@/components/profile/FeedbackSheet";

type Body = {
  request_id: string;
  message: string;
  category: string;
  platform: string;
  app_version: string | null;
  screen: string | null;
};

function sentBody(call: number): Body {
  const [name, options] = mockInvoke.mock.calls[call];
  expect(name).toBe("app-feedback");
  return (options as { body: Body }).body;
}

/** The SDK's shape for a non-2xx function response. */
function httpError(status: number) {
  return { data: null, error: Object.assign(new Error("fn"), { context: { status } }) };
}

async function openSheet() {
  const onClose = jest.fn();
  const view = await render(<FeedbackSheet visible onClose={onClose} screen="profile" />);
  return { view, onClose };
}

async function type(view: Awaited<ReturnType<typeof render>>, text: string) {
  await act(async () => {
    fireEvent.changeText(view.getByTestId("feedback-message"), text);
  });
}

async function send(view: Awaited<ReturnType<typeof render>>) {
  await act(async () => {
    await fireEvent.press(view.getByTestId("feedback-send"));
  });
}

beforeEach(() => {
  mockInvoke.mockReset();
});

afterEach(cleanup);

it("cannot send an empty message", async () => {
  const { view } = await openSheet();
  await type(view, "    ");
  await send(view);
  expect(mockInvoke).not.toHaveBeenCalled();
});

it("sends the message with its category and context, then thanks them", async () => {
  mockInvoke.mockResolvedValue({ data: { sent: true, replayed: false }, error: null });
  const { view } = await openSheet();

  await act(async () => {
    await fireEvent.press(view.getByTestId("feedback-category-bug"));
  });
  await type(view, "  The reader skipped page 3.  ");
  await send(view);

  await waitFor(() => expect(view.getByTestId("feedback-sent")).toBeTruthy());
  const body = sentBody(0);
  expect(body).toMatchObject({
    message: "The reader skipped page 3.",
    category: "bug",
    screen: "profile",
    platform: expect.stringMatching(/^(ios|android|web)$/),
  });
  expect(body.request_id).toMatch(/^feedback-/);
  expect(view.getByText("Thank you")).toBeTruthy();
});

it("sends 'other' when no category is chosen", async () => {
  mockInvoke.mockResolvedValue({ data: { sent: true, replayed: false }, error: null });
  const { view } = await openSheet();
  await type(view, "Love it");
  await send(view);
  await waitFor(() => expect(view.getByTestId("feedback-sent")).toBeTruthy());
  expect(sentBody(0).category).toBe("other");
});

it("does not thank them for a 200 that did not say it was filed", async () => {
  mockInvoke.mockResolvedValue({ data: {}, error: null });
  const { view } = await openSheet();
  await type(view, "Hello");
  await send(view);
  await waitFor(() => expect(view.getByTestId("feedback-error")).toBeTruthy());
  expect(view.queryByTestId("feedback-sent")).toBeNull();
});

it("a failure keeps the text, and Try again reuses the same request id", async () => {
  mockInvoke
    .mockResolvedValueOnce(httpError(500))
    .mockResolvedValueOnce({ data: { sent: true, replayed: true }, error: null });
  const { view } = await openSheet();
  await type(view, "Music is too loud");
  await send(view);

  await waitFor(() => expect(view.getByTestId("feedback-error")).toBeTruthy());
  expect(view.getByText(/check your connection/)).toBeTruthy();
  expect(view.getByTestId("feedback-message").props.value).toBe("Music is too loud");
  expect(view.queryByTestId("feedback-sent")).toBeNull();

  await send(view);
  await waitFor(() => expect(view.getByTestId("feedback-sent")).toBeTruthy());
  expect(sentBody(1).request_id).toBe(sentBody(0).request_id);
});

it("an edited message after a failure is a new request", async () => {
  mockInvoke
    .mockResolvedValueOnce(httpError(500))
    .mockResolvedValueOnce({ data: { sent: true, replayed: false }, error: null });
  const { view } = await openSheet();
  await type(view, "First try");
  await send(view);
  await waitFor(() => expect(view.getByTestId("feedback-error")).toBeTruthy());

  await type(view, "First try, with more detail");
  await send(view);
  await waitFor(() => expect(view.getByTestId("feedback-sent")).toBeTruthy());
  expect(sentBody(1).request_id).not.toBe(sentBody(0).request_id);
});

it("a rate limit says so, not 'check your connection'", async () => {
  mockInvoke.mockResolvedValue(httpError(429));
  const { view } = await openSheet();
  await type(view, "Again");
  await send(view);

  await waitFor(() => expect(view.getByTestId("feedback-error")).toBeTruthy());
  expect(view.getByText(/sent a lot of feedback recently/)).toBeTruthy();
  expect(view.queryByText(/check your connection/)).toBeNull();
  expect(view.getByTestId("feedback-message").props.value).toBe("Again");
});

it("a thrown call is a failure, not a success", async () => {
  mockInvoke.mockRejectedValue(new Error("offline"));
  const { view } = await openSheet();
  await type(view, "Hello");
  await send(view);
  await waitFor(() => expect(view.getByTestId("feedback-error")).toBeTruthy());
});
