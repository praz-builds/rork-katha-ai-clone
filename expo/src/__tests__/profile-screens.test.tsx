/**
 * The two profile surfaces, tested where they can hurt somebody.
 *
 * A follow that looks like it worked and did not, a guest silently writing to
 * nothing, and a private story appearing under a public byline are all failures
 * that leave no error behind. The last one is the serious one: a story its
 * author kept private must never reach a stranger's screen.
 */

/* eslint-disable import/first */
import React from "react";
import { Linking, Text } from "react-native";
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
import ProfileScreen, { PRIVACY_URL, TERMS_URL } from "@/screens/ProfileScreen";
import FollowButton from "@/components/profile/FollowButton";
import { ownProfile } from "@/test-support/profileFixtures";
import { resetProfileStoreForTests } from "@/lib/profile-store";
import {
  clearBlockedAuthors,
  getBlockedAuthorIds,
  rememberBlocked,
} from "@/lib/blocks";

const AUTHOR = "11111111-1111-4111-8111-111111111111";

/** A signed-in reader with a name, a handle, a live streak and two follows. */
const ownProfileFixture = () =>
  ownProfile({
    displayName: "Ada Lovelace",
    memberSince: "2026-01-01T00:00:00Z",
    currentStreak: 4,
    longestStreak: 9,
    storiesWritten: 2,
    chaptersWritten: 7,
    totalReads: 42,
    totalLikes: 8,
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
  // The profile is held app-wide now; each test starts from a cold boot.
  resetProfileStoreForTests();
  clearBlockedAuthors();
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
    // draft and a finished story they kept private. It is passed in exactly
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
        id: "story-kept-private",
        title: "Finished But Private",
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
    expect(view.queryByText("Finished But Private")).toBeNull();

    // Two relationship counts, and nothing private.
    expect(view.getByText("@ada")).toBeTruthy();
    expect(view.getByText("Followers")).toBeTruthy();
    expect(view.getByText("Following")).toBeTruthy();
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
  onJourney: jest.fn(),
  onPublicProfile: jest.fn(),
  onVoices: jest.fn(),
  onSignedOut: jest.fn(),
  onDeleted: jest.fn(),
});

describe("an author the reader has blocked", () => {
  it("shows none of their work, says why, and offers Unblock", async () => {
    mockFetchPublicProfile.mockResolvedValue({
      profile: publicProfile,
      stories: [publicStory],
    });
    mockFetchProfileComments.mockResolvedValue([
      {
        id: "c1",
        storyId: "s1",
        storyTitle: "The Night Cartographer",
        chapterNumber: 2,
        content: "A comment by the blocked writer.",
        score: 0,
        createdAt: "2026-09-01T00:00:00Z",
      },
    ]);
    rememberBlocked(AUTHOR);

    const view = await render(
      <AuthorScreen
        authorId={AUTHOR}
        stories={[]}
        canEngage
        onBack={jest.fn()}
        onStory={jest.fn()}
      />,
    );

    await waitFor(() => view.getByTestId("author-blocked"));
    expect(view.getByText("You blocked this writer")).toBeTruthy();
    expect(view.queryByText("A Public Story")).toBeNull();
    expect(view.queryByText("A comment by the blocked writer.")).toBeNull();
    expect(view.queryByText("Followers")).toBeNull();

    // Unblocking puts the page back without leaving it.
    await act(async () => {
      fireEvent.press(view.getByTestId("author-unblock"));
    });
    await waitFor(() => view.getByText("A Public Story"));
    expect(view.queryByTestId("author-blocked")).toBeNull();
    expect(getBlockedAuthorIds().has(AUTHOR)).toBe(false);
  });
});

describe("the reader's own profile", () => {
  it("lists blocked accounts behind their own row", async () => {
    mockFetchOwnProfile.mockResolvedValue(ownProfileFixture());
    const view = await render(<ProfileScreen {...profileProps()} />);

    await waitFor(() => view.getByTestId("profile-blocked"));
    fireEvent.press(view.getByTestId("profile-blocked"));
    await waitFor(() => view.getByTestId("blocked-accounts-sheet"));
    // No backend in this suite, so the list is honestly empty.
    await waitFor(() => view.getByTestId("blocked-accounts-empty"));
    expect(view.getByText("You haven't blocked anyone.")).toBeTruthy();
  });

  // D1: onboarding forces email before Home, so there is nobody anonymous to
  // show a "sign in to keep this" card to. The card, its button and the
  // `isAnonymous`/`onSignIn` props that drove it are all gone.
  it("has no guest card, because the product has no guests", async () => {
    mockFetchOwnProfile.mockResolvedValue(ownProfileFixture());
    const view = await render(<ProfileScreen {...profileProps()} />);

    await waitFor(() => view.getByTestId("profile-journey"));
    expect(view.queryByTestId("profile-guest")).toBeNull();
    expect(view.queryByTestId("profile-sign-in")).toBeNull();
    expect(view.queryByText("Sign in to keep all of this")).toBeNull();
  });

  // D5: avatar and handle on one row, and the pencil is the only edit door.
  it("puts the pencil on the identity row and opens the editor with it", async () => {
    mockFetchOwnProfile.mockResolvedValue(ownProfileFixture());
    const view = await render(<ProfileScreen {...profileProps()} />);

    await waitFor(() => view.getByTestId("profile-header"));
    expect(view.getByTestId("profile-avatar")).toBeTruthy();
    fireEvent.press(view.getByTestId("profile-edit"));
    await waitFor(() => expect(view.getByText("Your profile")).toBeTruthy());
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

  // Reads, likes and chapter counts were an eight-cell grid here. They
  // are a scoreboard, they belong to nobody but the writer, and the story
  // counts already exist in Library next to the stories they count.
  it("no longer shows reads, likes or story counts", async () => {
    mockFetchOwnProfile.mockResolvedValue(ownProfileFixture());

    const view = await render(<ProfileScreen {...profileProps()} />);

    await waitFor(() => view.getByTestId("profile-journey"));
    expect(view.queryByTestId("stat-grid")).toBeNull();
    for (const gone of ["Reads", "Likes", "Chapters", "Stories"]) {
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

  // Journey reads the app-wide copy this screen just filled, so the row only
  // has to navigate.
  it("opens the journey page", async () => {
    mockFetchOwnProfile.mockResolvedValue(ownProfileFixture());
    const props = profileProps();

    const view = await render(<ProfileScreen {...props} />);
    await waitFor(() => view.getByText("Ada Lovelace"));
    fireEvent.press(view.getByTestId("profile-journey"));
    expect(props.onJourney).toHaveBeenCalled();
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

  // While the name is on its way, the row holds its shape: no "Your profile"
  // that then renames itself, no public-profile row that pushes the rest
  // down when it arrives, and no failure line for a request still running.
  it("holds the layout still while the profile loads", async () => {
    let answer!: (value: unknown) => void;
    mockFetchOwnProfile.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const view = await render(<ProfileScreen {...profileProps()} />);

    await waitFor(() => view.getByTestId("profile-name-skeleton"));
    expect(view.getByTestId("profile-public-placeholder")).toBeTruthy();
    expect(view.queryByText("Your profile")).toBeNull();
    expect(view.queryByTestId("profile-unavailable")).toBeNull();
    // The static rows are drawn from the first frame.
    expect(view.getByTestId("profile-voices")).toBeTruthy();

    await act(async () => {
      answer(ownProfileFixture());
    });
    await waitFor(() => view.getByText("Ada Lovelace"));
    expect(view.queryByTestId("profile-name-skeleton")).toBeNull();
    expect(view.getByTestId("profile-public")).toBeTruthy();
  });

  // The tab unmounts on every switch. Coming back used to fetch from scratch
  // and flash the skeleton; now it draws what it had at once.
  it("comes back to the tab with the profile already drawn", async () => {
    mockFetchOwnProfile.mockResolvedValue(ownProfileFixture());
    const view = await render(<ProfileScreen {...profileProps()} />);
    await waitFor(() => view.getByText("Ada Lovelace"));
    // The tab switch: the screen leaves the tree entirely, then comes back.
    await view.rerender(<Text>Home</Text>);
    expect(view.queryByText("Ada Lovelace")).toBeNull();

    await view.rerender(<ProfileScreen {...profileProps()} />);
    expect(view.getByText("Ada Lovelace")).toBeTruthy();
    expect(view.queryByTestId("profile-name-skeleton")).toBeNull();
    // Fresh enough that the revisit did not ask again.
    expect(mockFetchOwnProfile).toHaveBeenCalledTimes(1);
  });

  // "Get more" opens Credits, not the paywall: D8 put every way of getting
  // credits — packs, Plus, streak, feedback, invites — on that one screen, and
  // sending this button straight to the subscription would hide the four free
  // ones behind a price.
  it("routes a reader who wants more credits to the credits screen", async () => {
    const props = profileProps();
    const view = await render(<ProfileScreen {...props} />);

    // The "Get more" pill is a View, not a button — the whole row is the
    // target, because a button inside a button is invalid HTML and breaks the
    // web build. So the pill must be on screen and the ROW must be what fires.
    await waitFor(() => view.getByTestId("profile-buy-credits"));
    fireEvent.press(view.getByTestId("profile-credits"));
    expect(props.onCredits).toHaveBeenCalled();
    expect(props.onPaywall).not.toHaveBeenCalled();
  });

  // D7: the Katha Plus row never sends a paying customer to a screen asking
  // them to pay.
  it("sends a free account to the paywall from the Katha Plus row", async () => {
    mockFetchOwnProfile.mockResolvedValue(ownProfileFixture());
    const props = profileProps();
    const view = await render(<ProfileScreen {...props} />);

    await waitFor(() => view.getByTestId("profile-premium"));
    expect(view.getByText("Subscription, voices, ad-free")).toBeTruthy();
    fireEvent.press(view.getByTestId("profile-premium"));
    expect(props.onPaywall).toHaveBeenCalledTimes(1);
  });

  // D12: the legal pages are the hosted ones, opened in the system browser.
  it("opens the hosted privacy and terms pages", async () => {
    mockFetchOwnProfile.mockResolvedValue(ownProfileFixture());
    const openURL = jest
      .spyOn(Linking, "openURL")
      .mockResolvedValue(true as unknown as void);
    try {
      const view = await render(<ProfileScreen {...profileProps()} />);
      await waitFor(() => view.getByTestId("profile-privacy"));
      fireEvent.press(view.getByTestId("profile-privacy"));
      expect(openURL).toHaveBeenCalledWith(PRIVACY_URL);
      fireEvent.press(view.getByTestId("profile-terms"));
      expect(openURL).toHaveBeenCalledWith(TERMS_URL);
      expect(PRIVACY_URL).toBe("https://katha.thetractionlabs.com/privacy");
      expect(TERMS_URL).toBe("https://katha.thetractionlabs.com/terms");
    } finally {
      openURL.mockRestore();
    }
  });
});
