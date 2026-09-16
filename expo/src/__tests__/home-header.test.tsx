/**
 * Home's header, after the owner's instruction: search leaves, and streak,
 * credits and notifications take the top-right corner.
 *
 * The assertion that matters most is the one about the streak, and it is a
 * NEGATIVE one: with no real value, nothing is drawn. `streaks` (migration
 * 00001) is written only by `touch_streak`, and a header that invents a day
 * count is a claim about the reader they have no way to check — and one they
 * would be shown every single morning. A missing streak is a gap; a wrong one
 * is a lie, and the app must prefer the gap.
 */
import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));
jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy({}, {
    get: () => () => ReactModule.createElement(ReactModule.Fragment),
  });
});

/* eslint-disable import/first */
import HomeScreen from "@/screens/HomeScreen";
import { stories } from "@/data/seed";
/* eslint-enable import/first */

const renderHome = async (props: Partial<React.ComponentProps<typeof HomeScreen>> = {}) =>
  await render(
    <HomeScreen
      credits={12}
      generatedStories={[]}
      stories={stories}
      onStory={jest.fn()}
      onProfile={jest.fn()}
      onCreate={jest.fn()}
      onSeeAll={jest.fn()}
      {...props}
    />,
  );

it("has no search field and no magnifier — search belongs to Explore", async () => {
  const view = await renderHome();
  expect(view.queryByLabelText("Search stories")).toBeNull();
  expect(view.queryByPlaceholderText(/Search/i)).toBeNull();
});

it("shows credits and notifications in the top-right corner", async () => {
  const view = await renderHome({ credits: 42 });
  expect(view.getByLabelText("42 credits")).toBeTruthy();
  expect(view.getByLabelText("Notifications")).toBeTruthy();
  expect(view.getByText("42")).toBeTruthy();
});

describe("the streak", () => {
  it("is absent entirely when there is no real value", async () => {
    // Null is what `fetchReadingStreak` returns for no session, no row, a
    // lapsed streak, and any failure. All four must render as nothing.
    const view = await renderHome({ streakDays: null });
    expect(view.queryByLabelText(/Reading streak/)).toBeNull();
  });

  it("is absent for a zero, rather than drawing a flame reading 0", async () => {
    const view = await renderHome({ streakDays: 0 });
    expect(view.queryByLabelText(/Reading streak/)).toBeNull();
  });

  it("is shown, with the day count, when the database has one", async () => {
    const view = await renderHome({ streakDays: 6 });
    expect(view.getByLabelText("Reading streak: 6 days")).toBeTruthy();
    expect(view.getByText("6")).toBeTruthy();
  });

  it("says day, not days, at one", async () => {
    const view = await renderHome({ streakDays: 1 });
    expect(view.getByLabelText("Reading streak: 1 day")).toBeTruthy();
  });
});

describe("the notification dot", () => {
  it("is silent when there is nothing unread", async () => {
    const view = await renderHome();
    expect(view.getByLabelText("Notifications")).toBeTruthy();
    expect(view.queryByLabelText(/unread/)).toBeNull();
  });

  it("announces the count once something feeds it", async () => {
    const view = await renderHome({ unreadNotifications: 3 });
    expect(view.getByLabelText("Notifications, 3 unread")).toBeTruthy();
  });
});

describe("where the header items go", () => {
  it("sends credits to the credits screen and the bell to notifications", async () => {
    const onCredits = jest.fn();
    const onNotifications = jest.fn();
    const view = await renderHome({ onCredits, onNotifications });

    await fireEvent.press(view.getByLabelText("12 credits"));
    expect(onCredits).toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText("Notifications"));
    expect(onNotifications).toHaveBeenCalled();
  });

  it("falls back to the profile when a destination is not wired", async () => {
    const onProfile = jest.fn();
    const view = await renderHome({ onProfile, streakDays: 4 });

    await fireEvent.press(view.getByLabelText("12 credits"));
    await fireEvent.press(view.getByLabelText("Notifications"));
    await fireEvent.press(view.getByLabelText("Reading streak: 4 days"));
    expect(onProfile).toHaveBeenCalledTimes(3);
  });
});

it("keeps every header item at a 44pt touch target", async () => {
  const view = await renderHome({ streakDays: 9 });
  for (
    const label of ["Reading streak: 9 days", "12 credits", "Notifications"]
  ) {
    const style = view.getByLabelText(label).props.style;
    const flat = (Array.isArray(style) ? style : [style])
      .filter(Boolean)
      .reduce((acc, entry) => ({ ...acc, ...entry }), {});
    expect(flat.height).toBeGreaterThanOrEqual(44);
    expect(flat.minWidth).toBeGreaterThanOrEqual(44);
  }
});

/*
  The greeting is two lines (D4): a phrase for the time of day on the first,
  the name and a wave on the second. They are separate Text elements, so the
  name never wraps mid-phrase under the pills, and a reader with no stored
  name simply gets the phrase as the heading.
*/
describe("the greeting", () => {
  it("puts the phrase and the name on two separate lines", async () => {
    const view = await renderHome({ displayName: "Asha Rao" });
    const phrase = view.getByTestId("home-greeting-phrase");
    const name = view.getByTestId("home-greeting-name");
    expect(name.props.children).toBe("Asha \u{1F44B}\u{1F3FC}");
    expect(String(phrase.props.children)).not.toContain("Asha");
    expect(String(phrase.props.children).length).toBeGreaterThan(0);
  });

  it("omits the name line when no name was ever given", async () => {
    const view = await renderHome({ displayName: null });
    expect(view.getByTestId("home-greeting-phrase")).toBeTruthy();
    expect(view.queryByTestId("home-greeting-name")).toBeNull();
    expect(view.queryByText(/\u{1F44B}/u)).toBeNull();
  });

  it("never renders the old single 'Good morning, Name' string", async () => {
    const view = await renderHome({ displayName: "Asha" });
    expect(view.queryByText(/^Good (morning|afternoon|evening), /)).toBeNull();
  });
});
