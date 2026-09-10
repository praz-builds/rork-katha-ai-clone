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
const mockFetchProfileComments = jest.fn();
const mockFetchActivityCalendar = jest.fn();

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
    fetchProfileComments: (...args: unknown[]) =>
      mockFetchProfileComments(...args),
    fetchActivityCalendar: (...args: unknown[]) =>
      mockFetchActivityCalendar(...args),
  };
});
jest.mock("expo-linear-gradient", () => ({ LinearGradient: "LinearGradient" }));

import AuthorScreen from "@/screens/AuthorScreen";
import ProfileScreen from "@/screens/ProfileScreen";
import FollowButton from "@/components/profile/FollowButton";

const AUTHOR = "11111111-1111-4111-8111-111111111111";

/** A signed-in reader with a name, a handle, a live streak and two follows. */
const ownProfileFixture = () => ({
  userId: "u1",
  username: "ada",
  displayName: "Ada Lovelace",
  avatarUrl: null,
  bio: null,
  memberSince: "2026-01-01T00:00:00Z",
  deletedAt: null,
  currentStreak: 4,
  longestStreak: 9,
  lastActivityDate: new Date().toISOString().slice(0, 10),
  storiesWritten: 2,
  chaptersWritten: 7,
  totalReads: 42,
  totalLikes: 8,
  phrasesSaved: 12,
  followers: 3,
  following: 1,
});

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
    mockFetchProfileComments.mockReset();
    mockFetchProfileComments.mockResolvedValue([]);
    mockFetchActivityCalendar.mockReset();
    mockFetchActivityCalendar.mockResolvedValue([]);
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

    // Two relationship counts, and nothing private.
    expect(view.getByText("@ada")).toBeTruthy();
    expect(view.getByText("Followers")).toBeTruthy();
    expect(view.getByText("Following")).toBeTruthy();
    expect(view.queryByText("Phrases")).toBeNull();
    expect(view.queryByText("Best streak")).toBeNull();
    expect(view.queryByText("Credits")).toBeNull();

    // The scoreboard is gone. Reads and likes measure a performance rather
    // than describing a person, and a profile that leads with them invites
    // the comparison instead of the reading.
    expect(view.queryByText("Reads")).toBeNull();
    expect(view.queryByText("Likes")).toBeNull();
    expect(view.queryByText("Published")).toBeNull();
  });

  it("shows what an author has said, under what they have written", async () => {
    mockFetchPublicProfile.mockResolvedValue({
      profile: publicProfile,
      stories: [],
    });
    mockFetchProfileComments.mockResolvedValue([
      {
        id: "c1",
        storyId: "s1",
        storyTitle: "The Night Cartographer",
        chapterNumber: 2,
        content: "The bit about the compass stayed with me.",
        score: 3,
        createdAt: "2026-09-01T00:00:00Z",
      },
    ]);

    const onStory = jest.fn();
    const view = await render(
      <AuthorScreen
        authorId={AUTHOR}
        stories={[]}
        canEngage
        onBack={jest.fn()}
        onStory={onStory}
      />,
    );

    await waitFor(() => view.getByTestId("author-comments"));
    expect(view.getByText("The bit about the compass stayed with me."))
      .toBeTruthy();
    // Each comment names the story it was left on: a remark with no context
    // reads as a status update, and these are replies.
    expect(view.getByText("The Night Cartographer · Chapter 2")).toBeTruthy();

    fireEvent.press(view.getByText("The bit about the compass stayed with me."));
    expect(onStory).toHaveBeenCalledWith("s1");
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

/**
 * The profile is a tab now, not a pushed screen, so there is no `onBack`. The
 * four new destinations it opens are stubs here; what each of them renders is
 * that screen's own business.
 */
const profileProps = () => ({
  credits: 5,
  onCredits: jest.fn(),
  onPaywall: jest.fn(),
  onCustomerCenter: jest.fn(),
  onJourney: jest.fn(),
  onPublicProfile: jest.fn(),
  onVoices: jest.fn(),
  onSignedOut: jest.fn(),
  onDeleted: jest.fn(),
});

describe("the reader's own profile", () => {
  it("offers a guest sign-in instead of a page of zeros", async () => {
    const onSignIn = jest.fn();
    const view = await render(
      <ProfileScreen {...profileProps()} isAnonymous onSignIn={onSignIn} />,
    );

    await waitFor(() => view.getByTestId("profile-guest"));
    fireEvent.press(view.getByTestId("profile-sign-in"));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    // No edit affordance for someone with nothing to edit.
    expect(view.queryByTestId("profile-edit")).toBeNull();
  });

  it("leads with who they are, then what the account can do", async () => {
    mockFetchOwnProfile.mockResolvedValue(ownProfileFixture());

    const view = await render(
      <ProfileScreen {...profileProps()} />,
    );

    await waitFor(() => view.getByTestId("profile-journey"));
    // The name leads, with the handle beneath it: a handle is an address, a
    // name is what the person is called.
    expect(view.getByText("Ada Lovelace")).toBeTruthy();
    expect(view.getByText("@ada")).toBeTruthy();
    // The streak is summarised behind the row and lives on its own page.
    expect(view.getByText("4 day streak, and the days behind it")).toBeTruthy();
    // Followers and following are the only public numbers left.
    expect(view.getByText("3 followers · 1 following")).toBeTruthy();
  });

  // Reads, likes, chapter and phrase counts were an eight-cell grid here. They
  // are a scoreboard, they belong to nobody but the writer, and the story
  // counts already exist in Library next to the stories they count.
  it("no longer shows reads, likes or story counts", async () => {
    mockFetchOwnProfile.mockResolvedValue(ownProfileFixture());

    const view = await render(<ProfileScreen {...profileProps()} />);

    await waitFor(() => view.getByTestId("profile-journey"));
    expect(view.queryByTestId("stat-grid")).toBeNull();
    for (const gone of ["Reads", "Likes", "Phrases", "Chapters", "Stories"]) {
      expect(view.queryByText(gone)).toBeNull();
    }
  });

  // No page title: the tab bar already said "You" in a word they just tapped.
  it("has no heading of its own", async () => {
    mockFetchOwnProfile.mockResolvedValue(ownProfileFixture());
    const view = await render(<ProfileScreen {...profileProps()} />);
    await waitFor(() => view.getByTestId("profile-journey"));
    expect(view.queryByText("Profile")).toBeNull();
  });

  it("opens the journey page with the profile it already loaded", async () => {
    const profile = ownProfileFixture();
    mockFetchOwnProfile.mockResolvedValue(profile);
    const props = profileProps();

    const view = await render(<ProfileScreen {...props} />);
    await waitFor(() => view.getByTestId("profile-journey"));
    fireEvent.press(view.getByTestId("profile-journey"));
    expect(props.onJourney).toHaveBeenCalledWith(profile);
  });

  // Sign out and Delete are only shown to somebody who has an account to lose.
  it("shows no danger zone to a guest", async () => {
    const view = await render(
      <ProfileScreen {...profileProps()} isAnonymous onSignIn={jest.fn()} />,
    );
    await waitFor(() => view.getByTestId("profile-guest"));
    expect(view.queryByTestId("profile-sign-out")).toBeNull();
    expect(view.queryByTestId("profile-delete")).toBeNull();
  });

  it("gives a signed-in reader both a way out and a way to delete", async () => {
    mockFetchOwnProfile.mockResolvedValue(ownProfileFixture());
    const view = await render(<ProfileScreen {...profileProps()} />);
    await waitFor(() => view.getByTestId("profile-journey"));
    expect(view.getByTestId("profile-sign-out")).toBeTruthy();
    expect(view.getByTestId("profile-delete")).toBeTruthy();
  });

  it("says the numbers are missing rather than showing invented ones", async () => {
    mockFetchOwnProfile.mockResolvedValue(null);

    const view = await render(
      <ProfileScreen {...profileProps()} />,
    );

    await waitFor(() => view.getByTestId("profile-unavailable"));
    expect(view.queryByTestId("profile-public")).toBeNull();
  });

  it("routes a reader who wants more credits to the paywall", async () => {
    const onPaywall = jest.fn();
    const view = await render(
      <ProfileScreen {...profileProps()} onPaywall={onPaywall} />,
    );

    await waitFor(() => view.getByTestId("profile-buy-credits"));
    fireEvent.press(view.getByTestId("profile-buy-credits"));
    expect(onPaywall).toHaveBeenCalledTimes(1);
  });
});
