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
const mockFetchOwnProfile = jest.fn();
const mockDeleteAccount = jest.fn();
const mockFetchNarrationVoices = jest.fn();
const mockPreferredVoiceId = jest.fn();
const mockSetPreferredVoiceId = jest.fn();

jest.mock("@/lib/profile", () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ...jest.requireActual("@/lib/profile"),
  fetchActivityCalendar: (...args: unknown[]) =>
    mockFetchActivityCalendar(...args),
  fetchOwnProfile: (...args: unknown[]) => mockFetchOwnProfile(...args),
  deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
}));
// VoicesScreen plays samples through expo-av, which has no native module in
// Jest. The samples themselves are covered in voice-preview.test.tsx.
jest.mock("expo-av", () => ({
  Audio: { Sound: { createAsync: jest.fn(() => new Promise(() => {})) } },
}));
jest.mock("@/lib/voices", () => ({
  fetchNarrationVoices: (...args: unknown[]) =>
    mockFetchNarrationVoices(...args),
  preferredVoiceId: (...args: unknown[]) => mockPreferredVoiceId(...args),
  setPreferredVoiceId: (...args: unknown[]) =>
    mockSetPreferredVoiceId(...args),
}));

/* eslint-disable import/first */
import ActivityGrid, {
  buildActivityGrid,
  sameGridProps,
} from "@/components/profile/ActivityGrid";
import { resetProfileStoreForTests } from "@/lib/profile-store";
import DeleteAccountSheet from "@/components/profile/DeleteAccountSheet";
import JourneyScreen from "@/screens/JourneyScreen";
import VoicesScreen from "@/screens/VoicesScreen";
import {
  ownProfile,
  reachedMilestone,
  todayIso,
} from "@/test-support/profileFixtures";
/* eslint-enable import/first */

const today = todayIso;

// The shared fixture, so a new field on `OwnProfile` costs one edit in
// src/test-support/profileFixtures.ts rather than one per literal here.
const profile = ownProfile;

// Explicit, because automatic cleanup is off in this project's setup and a
// `Modal` left mounted from the previous test is still in the tree for the
// next one -- which turns every `getByTestId` into a match against the wrong
// screen.
afterEach(cleanup);

beforeEach(() => {
  mockFetchActivityCalendar.mockReset();
  mockFetchActivityCalendar.mockResolvedValue([]);
  mockFetchOwnProfile.mockReset();
  mockFetchOwnProfile.mockResolvedValue(null);
  // The profile and calendar are held app-wide; each test is a cold boot.
  resetProfileStoreForTests();
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

  // Loading is not failing: "could not be loaded" during an ordinary load
  // told people their calendar was broken every time they opened it.
  it("draws a placeholder while loading, not the failure line", async () => {
    const view = await render(<ActivityGrid days={null} loading />);
    await waitFor(() => view.getByTestId("activity-grid-loading"));
    expect(view.queryByTestId("activity-grid-unavailable")).toBeNull();
    expect(view.queryByText(/could not be loaded/)).toBeNull();
  });

  // The memo used to key on a `new Date()` default, which is a new object on
  // every render, so it never hit and 371 dots were rebuilt each time.
  it("treats an equal list on the same day as the same grid", () => {
    const morning = new Date("2026-09-24T08:00:00Z");
    const evening = new Date("2026-09-24T20:00:00Z");
    const tomorrow = new Date("2026-09-25T08:00:00Z");
    const days = ["2026-09-01", "2026-09-24"];

    expect(sameGridProps({ days }, { days: [...days] })).toBe(true);
    expect(sameGridProps({ days, now: morning }, { days: [...days], now: evening }))
      .toBe(true);
    expect(sameGridProps({ days, now: morning }, { days, now: tomorrow })).toBe(false);
    expect(sameGridProps({ days }, { days: [...days, "2026-09-02"] })).toBe(false);
    expect(sameGridProps({ days: null }, { days: null, loading: true })).toBe(false);
  });

  it("does not redraw a single dot when the parent re-renders with the same days", async () => {
    const days = ["2026-09-01", "2026-09-24"];
    const view = await render(
      <ActivityGrid days={days} now={new Date("2026-09-24T08:00:00Z")} />,
    );
    await waitFor(() => view.getByTestId("activity-grid"));
    const before = view.getAllByTestId("activity-dot-active")[0].props;

    // A new array and a new Date, as every parent render produces them.
    await view.rerender(
      <ActivityGrid days={[...days]} now={new Date("2026-09-24T09:00:00Z")} />,
    );
    const after = view.getAllByTestId("activity-dot-active")[0].props;
    // The same props object: React bailed out rather than rendering it again.
    expect(after).toBe(before);
  });

  it("ends the grid on the week containing today", () => {
    const today = Math.floor(Date.UTC(2026, 8, 24) / 86_400_000); // a Thursday
    const grid = buildActivityGrid(["2026-09-24"], today);
    const lastWeek = grid.columns[grid.columns.length - 1];
    expect(lastWeek.find((cell) => cell.day === today)?.active).toBe(true);
    // Friday and Saturday have not happened yet.
    expect(lastWeek.filter((cell) => cell.future)).toHaveLength(2);
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

  // The ladder is D2: five rungs at 2/5/10/15/21 paying 2/4/6/8/10, each once,
  // and the page lists exactly those with what each pays.
  it("lists the five ladder rungs with their credits", async () => {
    const view = await render(
      <JourneyScreen profile={profile()} onBack={jest.fn()} />,
    );

    await waitFor(() => view.getByTestId("milestone-2"));
    for (const [milestone, credits] of [[2, 2], [5, 4], [10, 6], [15, 8], [21, 10]]) {
      expect(view.getByTestId(`milestone-${milestone}`)).toBeTruthy();
      expect(view.getByText(`${milestone} day streak`)).toBeTruthy();
      expect(view.getByText(`+${credits} credits`)).toBeTruthy();
    }
    // The old 3/7/14/30 rungs are gone with the constant that held them.
    expect(view.queryByTestId("milestone-3")).toBeNull();
    expect(view.queryByTestId("milestone-30")).toBeNull();
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

    await waitFor(() => view.getByTestId("milestone-2"));
    // 2 and 5 are behind them; 10 is not.
    const achieved = view.getAllByText("Achieved");
    expect(achieved.length).toBe(2);
  });

  // The date comes from the milestone row the grant was written against, not
  // from anything the client works out.
  it("dates an achieved rung from the server's own row", async () => {
    const view = await render(
      <JourneyScreen
        profile={profile({
          currentStreak: 6,
          longestStreak: 6,
          milestones: [reachedMilestone(2, 2), reachedMilestone(5, 4)],
        })}
        onBack={jest.fn()}
      />,
    );

    await waitFor(() => view.getByTestId("milestone-2"));
    expect(view.getAllByText("Achieved on Sep 8, 2026").length).toBe(2);
    // Unreached rungs still say how far away they are.
    expect(view.getByText("4 to go")).toBeTruthy();
  });

  // Regression: the server returns a row for EVERY rung, reached or not, with
  // `achievedAt` null until it is actually reached. Reading the row's presence
  // instead of its date lit up all five rungs on a brand-new account — which
  // is exactly what a signed-in reviewer saw on day zero.
  it("locks every rung when the server sent the ladder but no dates", async () => {
    const view = await render(
      <JourneyScreen
        profile={profile({
          currentStreak: 0,
          longestStreak: 0,
          milestones: [
            reachedMilestone(2, 2, null),
            reachedMilestone(5, 4, null),
            reachedMilestone(10, 6, null),
            reachedMilestone(15, 8, null),
            reachedMilestone(21, 10, null),
          ],
        })}
        onBack={jest.fn()}
      />,
    );

    await waitFor(() => view.getByTestId("milestone-2"));
    expect(view.queryAllByText("Achieved")).toHaveLength(0);
    expect(view.queryAllByText(/^Achieved on/)).toHaveLength(0);
    expect(view.getAllByText("Keep going")).toHaveLength(5);
  });

  // The server's `streak_ladder()` is the record; the client only falls back.
  it("draws the rungs the server sent rather than its own list", async () => {
    const view = await render(
      <JourneyScreen
        profile={profile({ ladder: [{ milestone: 4, credits: 3 }] })}
        onBack={jest.fn()}
      />,
    );

    await waitFor(() => view.getByTestId("milestone-4"));
    expect(view.getByText("+3 credits")).toBeTruthy();
    expect(view.queryByTestId("milestone-21")).toBeNull();
  });

  // A failed request is not a streak of zero. Rendering the page with `?? 0`
  // would tell somebody with a 40 day streak that they have none and lock
  // every milestone they had already reached, because the network blipped.
  it("says it cannot answer rather than showing a profile of zeros", async () => {
    const view = await render(
      <JourneyScreen profile={null} onBack={jest.fn()} />,
    );
    await waitFor(() => view.getByTestId("journey-unavailable"));
    expect(view.queryByTestId("journey-current-streak")).toBeNull();
    expect(view.queryByTestId("milestone-2")).toBeNull();
  });

  // Opened with no profile, the page used to show "could not be loaded" at
  // once, before any request had even been made, and offer no way out.
  it("loads the profile itself and shows no error while it does", async () => {
    let answer!: (value: unknown) => void;
    mockFetchOwnProfile.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const view = await render(
      <JourneyScreen profile={null} onBack={jest.fn()} />,
    );

    await waitFor(() => view.getByTestId("journey-loading"));
    expect(view.queryByTestId("journey-unavailable")).toBeNull();
    expect(view.queryByText(/could not be loaded/)).toBeNull();
    expect(mockFetchOwnProfile).toHaveBeenCalledTimes(1);

    answer(profile());
    await waitFor(() => view.getByTestId("journey-current-streak"));
    expect(view.queryByTestId("journey-loading")).toBeNull();
  });

  it("offers a retry when the profile really could not be read", async () => {
    mockFetchOwnProfile.mockResolvedValueOnce(null);
    const view = await render(
      <JourneyScreen profile={null} onBack={jest.fn()} />,
    );
    await waitFor(() => view.getByTestId("journey-retry"));

    mockFetchOwnProfile.mockResolvedValueOnce(profile());
    fireEvent.press(view.getByTestId("journey-retry"));
    await waitFor(() => view.getByTestId("journey-current-streak"));
    expect(mockFetchOwnProfile).toHaveBeenCalledTimes(2);
  });

  it("lets the calendar be retried on its own when only it failed", async () => {
    mockFetchActivityCalendar.mockResolvedValueOnce(null);
    const view = await render(
      <JourneyScreen profile={profile()} onBack={jest.fn()} />,
    );
    await waitFor(() => view.getByTestId("journey-calendar-retry"));
    expect(view.getByTestId("journey-current-streak")).toBeTruthy();

    mockFetchActivityCalendar.mockResolvedValueOnce([today()]);
    fireEvent.press(view.getByTestId("journey-calendar-retry"));
    await waitFor(() => view.getByTestId("activity-grid"));
    expect(view.queryByTestId("journey-calendar-retry")).toBeNull();
  });

  it("shows the calendar placeholder, not its failure line, while it loads", async () => {
    mockFetchActivityCalendar.mockReturnValue(new Promise(() => {}));
    const view = await render(
      <JourneyScreen profile={profile()} onBack={jest.fn()} />,
    );
    await waitFor(() => view.getByTestId("activity-grid-loading"));
    expect(view.queryByTestId("activity-grid-unavailable")).toBeNull();
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
