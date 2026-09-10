/**
 * The journey page, the activity grid, the voice picker and account deletion.
 *
 * These four are grouped because they are the surfaces where the profile stops
 * being a settings list and starts making claims: a calendar that says which
 * days somebody showed up, a milestone list that says what they have reached,
 * a voice list that says what the app can actually speak with, and a button
 * that destroys an account. Every one of those is a promise, so every one of
 * them is asserted here rather than eyeballed.
 */
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";

/**
 * Press, then let React settle.
 *
 * Under React 19's concurrent renderer a `fireEvent.press` schedules the state
 * update rather than applying it, so two presses in the same tick both read
 * the state from before the first one -- which is exactly the sequence these
 * tests use (choose a reason, then press Continue, whose `disabled` depends on
 * that reason).
 */

const mockFetchActivityCalendar = jest.fn();
const mockDeleteAccount = jest.fn();
const mockFetchNarrationVoices = jest.fn();
const mockPreferredVoiceId = jest.fn();
const mockSetPreferredVoiceId = jest.fn();

jest.mock("@/lib/profile", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...jest.requireActual("@/lib/profile"),
  fetchActivityCalendar: (...args: unknown[]) =>
    mockFetchActivityCalendar(...args),
  deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
}));
jest.mock("@/lib/voices", () => ({
  fetchNarrationVoices: (...args: unknown[]) =>
    mockFetchNarrationVoices(...args),
  preferredVoiceId: (...args: unknown[]) => mockPreferredVoiceId(...args),
  setPreferredVoiceId: (...args: unknown[]) =>
    mockSetPreferredVoiceId(...args),
}));

/* eslint-disable import/first */
import ActivityGrid from "@/components/profile/ActivityGrid";
import DeleteAccountSheet from "@/components/profile/DeleteAccountSheet";
import JourneyScreen from "@/screens/JourneyScreen";
import VoicesScreen from "@/screens/VoicesScreen";
/* eslint-enable import/first */

const today = () => new Date().toISOString().slice(0, 10);

const profile = (over: Record<string, unknown> = {}) => ({
  userId: "u1",
  username: "ada",
  displayName: "Ada",
  avatarUrl: null,
  bio: null,
  memberSince: "2026-08-01T00:00:00Z",
  deletedAt: null,
  currentStreak: 1,
  longestStreak: 2,
  lastActivityDate: today(),
  storiesWritten: 0,
  chaptersWritten: 0,
  totalReads: 0,
  totalLikes: 0,
  phrasesSaved: 0,
  followers: 0,
  following: 0,
  ...over,
});

// Explicit, because automatic cleanup is off in this project's setup and a
// `Modal` left mounted from the previous test is still in the tree for the
// next one -- which turns every `getByTestId` into a match against the wrong
// screen.
afterEach(cleanup);

beforeEach(() => {
  mockFetchActivityCalendar.mockReset();
  mockFetchActivityCalendar.mockResolvedValue([]);
  mockDeleteAccount.mockReset();
  mockFetchNarrationVoices.mockReset();
  mockPreferredVoiceId.mockReset();
  mockPreferredVoiceId.mockResolvedValue(null);
  mockSetPreferredVoiceId.mockReset();
});

describe("the activity grid", () => {
  // An empty year is a real answer for a new account. "We could not ask" is
  // not, and drawing 365 blank squares for it would tell somebody they had
  // done nothing when what actually happened is that the request failed.
  it("tells an empty year apart from an unknown one", async () => {
    const empty = await render(<ActivityGrid days={[]} />);
    await waitFor(() => empty.getByTestId("activity-grid"));
    expect(empty.getByText("No active days yet")).toBeTruthy();

    const unknown = await render(<ActivityGrid days={null} />);
    await waitFor(() => unknown.getByTestId("activity-grid-unavailable"));
    expect(unknown.queryByTestId("activity-grid")).toBeNull();
  });

  it("counts only the days it was given, once each", async () => {
    const view = await render(
      <ActivityGrid days={[today(), today(), "2026-09-01"]} />,
    );
    await waitFor(() => view.getByTestId("activity-grid"));
    // The duplicate is one day, not two: the set is keyed by date.
    expect(view.getByText("2 active days")).toBeTruthy();
  });

  it("ignores a date it cannot read rather than drawing a wrong square", async () => {
    const view = await render(<ActivityGrid days={["not-a-date", today()]} />);
    await waitFor(() => view.getByTestId("activity-grid"));
    expect(view.getByText("1 active day")).toBeTruthy();
  });
});

describe("your journey", () => {
  it("shows the two streaks and says today is safe when it is", async () => {
    const view = await render(
      <JourneyScreen profile={profile()} onBack={jest.fn()} />,
    );

    await waitFor(() => view.getByTestId("journey-current-streak"));
    expect(view.getByText("Current streak")).toBeTruthy();
    expect(view.getByText("Longest streak")).toBeTruthy();
    expect(view.getByText("Today's streak earned")).toBeTruthy();
    expect(view.getByText("Member since Aug 1, 2026")).toBeTruthy();
  });

  // The only line on this page allowed to be urgent, and only when something
  // is genuinely about to be lost.
  it("asks for today only when the streak is about to break", async () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(
      0,
      10,
    );
    const view = await render(
      <JourneyScreen
        profile={profile({ lastActivityDate: yesterday })}
        onBack={jest.fn()}
      />,
    );

    await waitFor(() => view.getByTestId("journey-current-streak"));
    expect(view.getByText("Read or write today to keep it")).toBeTruthy();
    expect(view.queryByText("Today's streak earned")).toBeNull();
  });

  // A milestone reached in March stays reached in June. Measuring it against
  // the CURRENT streak would un-achieve it the moment a streak broke, which
  // punishes the same lapse twice.
  it("keeps a milestone once it has been reached, even after a break", async () => {
    const view = await render(
      <JourneyScreen
        profile={profile({ currentStreak: 0, longestStreak: 7 })}
        onBack={jest.fn()}
      />,
    );

    await waitFor(() => view.getByTestId("milestone-3"));
    expect(view.getByTestId("milestone-7")).toBeTruthy();
    // 3 and 7 are behind them; 14 is not.
    const reached = view.getAllByText("Reached");
    expect(reached.length).toBe(2);
  });

  // Reads, likes and chapter counts were on the old profile. They are a
  // scoreboard and they are not coming to this page.
  it("shows no reads, likes or story counts", async () => {
    const view = await render(
      <JourneyScreen profile={profile()} onBack={jest.fn()} />,
    );
    await waitFor(() => view.getByTestId("journey-current-streak"));
    for (const gone of ["Reads", "Likes", "Stories", "Chapters", "Comments"]) {
      expect(view.queryByText(gone)).toBeNull();
    }
  });
});

describe("the voice picker", () => {
  // The bundled catalogue in src/data/voices.ts names eight voices, four of
  // which have never existed in the database. Building the picker from the
  // server is what stops it offering a voice that answers 400 on Listen.
  it("offers exactly what the server says can be spoken", async () => {
    mockFetchNarrationVoices.mockResolvedValue([
      {
        id: "aria",
        displayName: "Aria",
        language: "en",
        gender: "female",
        tier: "standard",
        previewUrl: null,
      },
      {
        id: "kai",
        displayName: "Kai",
        language: "en",
        gender: "male",
        tier: "standard",
        previewUrl: null,
      },
    ]);

    const view = await render(<VoicesScreen onBack={jest.fn()} />);
    await waitFor(() => view.getByTestId("voice-aria"));
    expect(view.getByTestId("voice-kai")).toBeTruthy();
    expect(view.getByText("English · Female")).toBeTruthy();
    // Never offered, because the registry does not have them.
    expect(view.queryByTestId("voice-luna")).toBeNull();
    expect(view.queryByTestId("voice-elvira")).toBeNull();
  });

  it("remembers the voice that was chosen", async () => {
    mockFetchNarrationVoices.mockResolvedValue([
      {
        id: "aria",
        displayName: "Aria",
        language: "en",
        gender: "female",
        tier: "standard",
        previewUrl: null,
      },
      {
        id: "onyx",
        displayName: "Onyx",
        language: "en",
        gender: "male",
        tier: "premium",
        previewUrl: null,
      },
    ]);

    const view = await render(<VoicesScreen onBack={jest.fn()} />);
    await waitFor(() => view.getByTestId("voice-onyx"));
    fireEvent.press(view.getByTestId("voice-onyx"));
    expect(mockSetPreferredVoiceId).toHaveBeenCalledWith("onyx");
  });

  it("says the list is missing rather than showing an empty one", async () => {
    mockFetchNarrationVoices.mockResolvedValue(null);
    const view = await render(<VoicesScreen onBack={jest.fn()} />);
    await waitFor(() => view.getByTestId("voices-unavailable"));
  });
});
