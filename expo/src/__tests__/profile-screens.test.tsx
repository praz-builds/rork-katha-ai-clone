/**
 * The two profile surfaces, tested where they can hurt somebody.
 *
 * A follow that looks like it worked and did not, a guest silently writing to
 * nothing, and a private story appearing under a public byline are all failures
 * that leave no error behind. The last one is the serious one: an author's
 * private story -- including one the entity gate kept private because the idea
 * named a real living person -- must never reach a stranger's screen.
 */

/* eslint-disable import/first */
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react-native";

const mockSetAuthorFollow = jest.fn();
const mockFetchPublicProfile = jest.fn();
const mockFetchOwnProfile = jest.fn();

jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn() }));
jest.mock("@/lib/api", () => {
  const actual = jest.requireActual("@/lib/api");
  return {
    ...actual,
    setAuthorFollow: (...args: unknown[]) => mockSetAuthorFollow(...args),
  };
});
jest.mock("@/lib/profile", () => {
  const actual = jest.requireActual("@/lib/profile");
  return {
    ...actual,
    fetchPublicProfile: (...args: unknown[]) => mockFetchPublicProfile(...args),
    fetchOwnProfile: (...args: unknown[]) => mockFetchOwnProfile(...args),
  };
});
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));

import AuthorScreen from "@/screens/AuthorScreen";
import ProfileScreen from "@/screens/ProfileScreen";
import FollowButton from "@/components/profile/FollowButton";

const AUTHOR = "11111111-1111-4111-8111-111111111111";

const publicProfile = {
  authorId: AUTHOR,
  username: "ada",
  avatarUrl: null,
  bio: "Writes at night.",
  memberSince: "2026-01-01T00:00:00Z",
  firstPublishedAt: "2026-02-01T00:00:00Z",
  storiesPublished: 1,
  totalReads: 100,
  totalLikes: 10,
  followers: 9,
  isFollowing: false,
};

const publicStory = {
  id: "story-public",
  title: "A Public Story",
  genre: ["romance"],
  primaryGenre: "romance",
  themes: [],
  coverImageUrl: null,
  readCount: 100,
  likeCount: 10,
  wordCount: 900,
  createdAt: "2026-02-01T00:00:00Z",
};

beforeEach(() => {
  mockSetAuthorFollow.mockReset();
  mockFetchPublicProfile.mockReset();
  mockFetchOwnProfile.mockReset();
  mockFetchOwnProfile.mockResolvedValue(null);
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Follow
// ---------------------------------------------------------------------------

describe("following an author", () => {
  it("flips immediately and keeps the server's own count on success", async () => {
    mockSetAuthorFollow.mockResolvedValue({ on: true, count: 11 });
    const onChange = jest.fn();

    const view = await render(
      <FollowButton
        authorId={AUTHOR}
        following={false}
        followers={9}
        canEngage
        onChange={onChange}
      />,
    );

    await act(async () => {
      fireEvent.press(view.getByTestId("follow-button"));
    });

    // Optimistic first (10), then the server's real number (11) -- another
    // reader followed while this request was in flight.
    expect(onChange).toHaveBeenNthCalledWith(1, {
      following: true,
      followers: 10,
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        following: true,
        followers: 11,
      })
    );
    expect(view.getByText("Following")).toBeTruthy();
  });

  it("rolls back to exactly the previous state when the write fails", async () => {
    mockSetAuthorFollow.mockRejectedValue(new Error("network"));
    const onChange = jest.fn();

    const view = await render(
      <FollowButton
        authorId={AUTHOR}
        following={false}
        followers={9}
        canEngage
        onChange={onChange}
      />,
    );

    await act(async () => {
      fireEvent.press(view.getByTestId("follow-button"));
    });

    // Restored, not decremented again: a second decrement against a server
    // that also rolled back is how a follower count drifts permanently.
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        following: false,
        followers: 9,
      })
    );
    expect(view.getByText("Follow")).toBeTruthy();
  });

  it("asks a guest to sign in before it changes anything", async () => {
    const onRequireSignIn = jest.fn();
    const onChange = jest.fn();

    const view = await render(
      <FollowButton
        authorId={AUTHOR}
        following={false}
        followers={9}
        canEngage={false}
        onRequireSignIn={onRequireSignIn}
        onChange={onChange}
      />,
    );

    await act(async () => {
      fireEvent.press(view.getByTestId("follow-button"));
    });

    expect(onRequireSignIn).toHaveBeenCalledTimes(1);
    // Not "flipped then reverted": never flipped. A button that turns
    // "Following" and springs back teaches the reader not to trust the screen.
    expect(onChange).not.toHaveBeenCalled();
    expect(mockSetAuthorFollow).not.toHaveBeenCalled();
    expect(view.getByText("Follow")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// The public byline
// ---------------------------------------------------------------------------

describe("somebody else's profile", () => {
  it("shows only what the server listed, never the local story array", async () => {
    mockFetchPublicProfile.mockResolvedValue({
      profile: publicProfile,
      stories: [publicStory],
    });

    // The client's own story array carries this author's private work -- a
    // draft and a story the entity gate kept private. It is passed in exactly
    // as `App.tsx` passes it, and none of it may be rendered here.
    const localStories = [
      {
        id: "story-private",
        title: "An Unpublished Draft",
        authorId: AUTHOR,
        genre: "romance" as const,
        synopsis: "",
        chapters: [],
        likes: 0,
        bookmarks: 0,
        views: 0,
        tags: [],
        publishedOffset: 0,
        isFeatured: false,
        language: "en",
      },
      {
        id: "story-gated",
        title: "Names A Real Person",
        authorId: AUTHOR,
        genre: "thriller" as const,
        synopsis: "",
        chapters: [],
        likes: 0,
        bookmarks: 0,
        views: 0,
        tags: [],
        publishedOffset: 0,
        isFeatured: false,
        language: "en",
      },
    ];

    const view = await render(
      <AuthorScreen
        authorId={AUTHOR}
        stories={localStories}
        canEngage
        onBack={jest.fn()}
        onStory={jest.fn()}
      />,
    );

    await waitFor(() => view.getByText("A Public Story"));
    expect(view.queryByText("An Unpublished Draft")).toBeNull();
    expect(view.queryByText("Names A Real Person")).toBeNull();

    // The four public numbers, and no private one.
    expect(view.getByText("@ada")).toBeTruthy();
    expect(view.getByText("Published")).toBeTruthy();
    expect(view.getByText("Followers")).toBeTruthy();
    expect(view.queryByText("Phrases")).toBeNull();
    expect(view.queryByText("Best streak")).toBeNull();
    expect(view.queryByText("Credits")).toBeNull();
  });

  it("says nothing published rather than falling back to local stories", async () => {
    mockFetchPublicProfile.mockResolvedValue({
      profile: { ...publicProfile, storiesPublished: 0 },
      stories: [],
    });

    const view = await render(
      <AuthorScreen
        authorId={AUTHOR}
        stories={[
          {
            id: "story-private",
            title: "An Unpublished Draft",
            authorId: AUTHOR,
            genre: "romance" as const,
            synopsis: "",
            chapters: [],
            likes: 0,
            bookmarks: 0,
            views: 0,
            tags: [],
            publishedOffset: 0,
            isFeatured: false,
            language: "en",
          },
        ]}
        onBack={jest.fn()}
        onStory={jest.fn()}
      />,
    );

    await waitFor(() => view.getByTestId("author-no-stories"));
    expect(view.queryByText("An Unpublished Draft")).toBeNull();
  });

  it("gates the follow button behind sign-in for a guest", async () => {
    mockFetchPublicProfile.mockResolvedValue({
      profile: publicProfile,
      stories: [publicStory],
    });
    const onRequireSignIn = jest.fn();

    const view = await render(
      <AuthorScreen
        authorId={AUTHOR}
        stories={[]}
        canEngage={false}
        onRequireSignIn={onRequireSignIn}
        onBack={jest.fn()}
        onStory={jest.fn()}
      />,
    );

    const button = await waitFor(() => view.getByTestId("follow-button"));
    await act(async () => {
      fireEvent.press(button);
    });
    expect(onRequireSignIn).toHaveBeenCalledTimes(1);
    expect(mockSetAuthorFollow).not.toHaveBeenCalled();
  });

  it("does not query the endpoint for a bundled sample author", async () => {
    await render(
      <AuthorScreen
        authorId="kathaai"
        stories={[]}
        onBack={jest.fn()}
        onStory={jest.fn()}
      />,
    );
    expect(mockFetchPublicProfile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The owner's profile
// ---------------------------------------------------------------------------

describe("the reader's own profile", () => {
  it("offers a guest sign-in instead of a page of zeros", async () => {
    const onSignIn = jest.fn();
    const view = await render(
      <ProfileScreen
        credits={5}
        isAnonymous
        onSignIn={onSignIn}
        onBack={jest.fn()}
        onCredits={jest.fn()}
        onPaywall={jest.fn()}
        onCustomerCenter={jest.fn()}
      />,
    );

    await waitFor(() => view.getByTestId("profile-guest"));
    fireEvent.press(view.getByTestId("profile-sign-in"));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    // No edit affordance for someone with nothing to edit.
    expect(view.queryByTestId("profile-edit")).toBeNull();
  });

  it("shows the streak and the counts once they load", async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockFetchOwnProfile.mockResolvedValue({
      userId: "u1",
      username: "ada",
      avatarUrl: null,
      bio: null,
      memberSince: "2026-01-01T00:00:00Z",
      currentStreak: 4,
      longestStreak: 9,
      lastActivityDate: today,
      storiesWritten: 2,
      chaptersWritten: 7,
      totalReads: 42,
      totalLikes: 8,
      phrasesSaved: 12,
      followers: 3,
      following: 1,
    });

    const view = await render(
      <ProfileScreen
        credits={5}
        onBack={jest.fn()}
        onCredits={jest.fn()}
        onPaywall={jest.fn()}
        onCustomerCenter={jest.fn()}
      />,
    );

    await waitFor(() => view.getByTestId("streak-card"));
    expect(view.getByText("4 days")).toBeTruthy();
    expect(view.getByText("@ada")).toBeTruthy();
    expect(view.getByTestId("stat-grid")).toBeTruthy();
    expect(view.getByText("Phrases")).toBeTruthy();
    // Parental controls are gone. The owner decided the product does not need
    // them, and a settings row for a feature nobody is building is a promise.
    expect(view.queryByText("Parental controls")).toBeNull();
  });

  it("says the numbers are missing rather than showing invented ones", async () => {
    mockFetchOwnProfile.mockResolvedValue(null);

    const view = await render(
      <ProfileScreen
        credits={5}
        onBack={jest.fn()}
        onCredits={jest.fn()}
        onPaywall={jest.fn()}
        onCustomerCenter={jest.fn()}
      />,
    );

    await waitFor(() => view.getByTestId("profile-stats-unavailable"));
    expect(view.queryByTestId("streak-card")).toBeNull();
    expect(view.queryByTestId("stat-grid")).toBeNull();
  });

  it("routes a reader who wants more credits to the paywall", async () => {
    const onPaywall = jest.fn();
    const view = await render(
      <ProfileScreen
        credits={5}
        onBack={jest.fn()}
        onCredits={jest.fn()}
        onPaywall={onPaywall}
        onCustomerCenter={jest.fn()}
      />,
    );

    await waitFor(() => view.getByTestId("profile-buy-credits"));
    fireEvent.press(view.getByTestId("profile-buy-credits"));
    expect(onPaywall).toHaveBeenCalledTimes(1);
  });
});
