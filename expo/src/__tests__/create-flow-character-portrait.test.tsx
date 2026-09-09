/**
 * Product-owner feedback on the Craft character sheet and the Review screen.
 *
 * The headline bug: the portrait panel drew the first letter of the
 * character's NAME whenever the image was ready and never mounted an <Image>
 * at all, so a successful ~12s generation and a failure looked identical. It
 * was reported as "the character isn't getting generated" with a screenshot of
 * a big "P" -- the backend had been returning a real public URL the whole
 * time. Every assertion about the image below fails against that code, which
 * is the point of writing them: a test that would pass either way would have
 * shipped the same bug again.
 *
 * Also covered here: the busy state on the card (not only on the button), the
 * removal of the "Edit" button, Reimagine re-reading the CURRENT form fields
 * rather than a stale closure, the unsaved-changes friction dialog, "@" on the
 * moment composer's cast chips, Chapter plan leaving More options, and the
 * review screen's strength meter.
 */
import React, { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const mockGenerateCharacterImage = jest.fn();

jest.mock("@/lib/api", () => {
  // Keeps `effectiveChapterLength`, which the brief flow calls at render time.
  const actual = jest.requireActual("@/lib/api");
  return {
    ...actual,
    generateCharacterImage: (...args: unknown[]) => mockGenerateCharacterImage(...args),
    createGenerationRequestId: () => "portrait-test-request",
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, right: 0, bottom: 34, left: 0 }),
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock("@/components/KathaPrimitives", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require("react-native");
  return {
    CreditPill: ({ credits }: { credits: number }) =>
      React.createElement(Text, null, `${credits} credits`),
  };
});

jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return new Proxy({}, { get: () => () => React.createElement(React.Fragment) });
});

/* eslint-disable import/first */
import CreateBriefFlow from "@/components/create/CreateBriefFlow";
import type { StudioCreateDraft } from "@/components/create/CreateBriefFlow";
/* eslint-enable import/first */

const BASE_DRAFT: StudioCreateDraft = {
  primaryGenre: "fantasy",
  audienceMode: "adult",
  spiceLevel: "sweet",
  identityLenses: [],
  seed: "A lighthouse keeper starts receiving letters addressed to someone who died there.",
  language: "English",
  characters: [],
  isSeries: true,
  chapterLength: "standard",
  plannedChapterCount: 3,
  illustrateChapters: false,
  visibility: "private",
};

/**
 * The flow is a controlled component -- it owns no draft of its own -- so the
 * harness has to hold the state the parent screen normally holds. Without it
 * every `setDraft` would be discarded and a saved character would never appear
 * in the cast list.
 */
function Harness({ initial = BASE_DRAFT }: { initial?: StudioCreateDraft }) {
  const [draft, setDraft] = useState<StudioCreateDraft>(initial);
  return (
    <CreateBriefFlow
      credits={10}
      isAnonymous={false}
      draft={draft}
      setDraft={setDraft}
      onGenerate={() => undefined}
      onBack={() => undefined}
    />
  );
}

const PORTRAIT_URL = "https://cdn.example.test/covers/story/characters/naina.png";

async function openCharacterSheet() {
  // "Who's in it" has two tabs since the saved-character library landed, and
  // a writer who already has saved characters opens on Saved. Craft lives on
  // New, so select it before reaching for its row.
  await fireEvent.press(screen.getByLabelText("New character"));
  await fireEvent.press(screen.getByLabelText("Add a character"));
}

async function fillCharacter(name: string, description: string) {
  await fireEvent.changeText(screen.getByLabelText("Name"), name);
  await fireEvent.changeText(screen.getByLabelText("Description"), description);
}

beforeEach(() => {
  mockGenerateCharacterImage.mockReset();
});

describe("character portrait", () => {
  it("renders the generated portrait as an image, not the name's initial", async () => {
    mockGenerateCharacterImage.mockResolvedValue({ url: PORTRAIT_URL });
    await render(<Harness />);
    await openCharacterSheet();
    await fillCharacter("Priya", "A 29-year-old baker with a practical streak.");

    await act(async () => {
      await fireEvent.press(screen.getByText("Create image"));
    });

    const portrait = await screen.findByLabelText("Portrait of Priya");
    expect(portrait.type).toBe("Image");
    expect(portrait.props.source).toEqual({ uri: PORTRAIT_URL });
    expect(portrait.props.resizeMode).toBe("cover");

    // The letter was the whole bug. A ready portrait must not fall back to it,
    // and the empty-state hint must be gone too.
    expect(screen.queryByText("P")).toBeNull();
    expect(screen.queryByText("Character image will appear here.")).toBeNull();
  });

  it("shows a busy state on the card itself while the image generates", async () => {
    let settle: (value: { url: string }) => void = () => undefined;
    mockGenerateCharacterImage.mockImplementation(
      () => new Promise<{ url: string }>((resolve) => { settle = resolve; }),
    );
    await render(<Harness />);
    await openCharacterSheet();
    await fillCharacter("Priya", "A 29-year-old baker with a practical streak.");

    // Deliberately NOT awaited: RNTL's async `fireEvent` drains pending work,
    // and the point of this test is the window in which the request has not
    // resolved yet. Awaited at the end, once the promise is settled.
    const press = fireEvent.press(screen.getByText("Create image"));

    // Generation takes about twelve seconds. The button already said
    // "Creating..."; the card is what looked idle and got read as broken.
    await screen.findByText("Creating image…");

    await act(async () => {
      settle({ url: PORTRAIT_URL });
    });
    await press;
    await waitFor(() => expect(screen.queryByText("Creating image…")).toBeNull());
  });

  it("shows the portrait on the cast row once it is ready", async () => {
    await render(
      <Harness
        initial={{
          ...BASE_DRAFT,
          characters: [{
            name: "Priya",
            description: "A baker.",
            isHero: true,
            portraitUrl: PORTRAIT_URL,
            portraitStatus: "ready",
          }],
        }}
      />,
    );
    const rowPortrait = screen.getByLabelText("Portrait of Priya");
    expect(rowPortrait.type).toBe("Image");
    expect(rowPortrait.props.source).toEqual({ uri: PORTRAIT_URL });
  });

  it("offers Reimagine and no Edit button once an image exists", async () => {
    mockGenerateCharacterImage.mockResolvedValue({ url: PORTRAIT_URL });
    await render(<Harness />);
    await openCharacterSheet();
    await fillCharacter("Priya", "A 29-year-old baker with a practical streak.");

    await act(async () => {
      await fireEvent.press(screen.getByText("Create image"));
    });

    await screen.findByText("Reimagine");
    // "Edit" only ever deleted portraitUrl to get back to an empty card.
    expect(screen.queryByText("Edit")).toBeNull();
  });

  it("re-reads the current form fields on every Reimagine", async () => {
    mockGenerateCharacterImage.mockResolvedValue({ url: PORTRAIT_URL });
    await render(<Harness />);
    await openCharacterSheet();
    await fillCharacter("Priya", "A baker.");
    await fireEvent.changeText(screen.getByLabelText("Appearance"), "Flour on her sleeves.");

    await act(async () => {
      await fireEvent.press(screen.getByText("Create image"));
    });
    await screen.findByText("Reimagine");

    // Change every field the call sends, then Reimagine. A stale closure here
    // would resend the first description and look like the model ignoring the
    // user rather than like a client bug.
    await fireEvent.changeText(screen.getByLabelText("Name"), "Naina");
    await fireEvent.changeText(screen.getByLabelText("Description"), "A retired cartographer.");
    await fireEvent.changeText(screen.getByLabelText("Appearance"), "Ink-stained cuffs.");

    await act(async () => {
      await fireEvent.press(screen.getByText("Reimagine"));
    });

    expect(mockGenerateCharacterImage).toHaveBeenCalledTimes(2);
    expect(mockGenerateCharacterImage.mock.calls[1][0]).toMatchObject({
      name: "Naina",
      description: "A retired cartographer.",
      appearance: "Ink-stained cuffs.",
    });
  });
});

describe("unsaved character changes", () => {
  it("asks before discarding a sheet that was edited", async () => {
    await render(<Harness />);
    await openCharacterSheet();
    await fillCharacter("Priya", "A baker.");

    await fireEvent.press(screen.getByLabelText("Back to review and start"));

    await screen.findByText("Save this character?");
    // The destructive action must say what it destroys.
    expect(screen.getByLabelText("Discard changes to this character")).toBeTruthy();
    expect(screen.getByText("Save character")).toBeTruthy();
  });

  it("leaves an untouched sheet without any friction", async () => {
    await render(<Harness />);
    await openCharacterSheet();

    await fireEvent.press(screen.getByLabelText("Back to review and start"));

    expect(screen.queryByText("Save this character?")).toBeNull();
    expect(screen.queryByText("Craft character")).toBeNull();
  });

  it("saves from the dialog, keeping the typed character", async () => {
    await render(<Harness />);
    await openCharacterSheet();
    await fillCharacter("Priya", "A baker.");
    await fireEvent.press(screen.getByLabelText("Back to review and start"));
    await screen.findByText("Save this character?");

    await fireEvent.press(screen.getByText("Save character"));

    await waitFor(() => expect(screen.queryByText("Save this character?")).toBeNull());
    expect(screen.getByText("Priya · Lead")).toBeTruthy();
  });

  it("discards from the dialog, keeping nothing", async () => {
    await render(<Harness />);
    await openCharacterSheet();
    await fillCharacter("Priya", "A baker.");
    await fireEvent.press(screen.getByLabelText("Back to review and start"));
    await screen.findByText("Save this character?");

    await fireEvent.press(screen.getByLabelText("Discard changes to this character"));

    await waitFor(() => expect(screen.queryByText("Save this character?")).toBeNull());
    expect(screen.queryByText("Priya · Lead")).toBeNull();
  });

  it("offers Keep editing instead of an unusable Save when the name is empty", async () => {
    await render(<Harness />);
    await openCharacterSheet();
    // Description only: `saveCharacter` no-ops without a name, so a "Save"
    // button here would be a dead end rather than a way out.
    await fireEvent.changeText(screen.getByLabelText("Description"), "A baker.");

    await fireEvent.press(screen.getByLabelText("Back to review and start"));

    await screen.findByText("Save this character?");
    expect(screen.getByText("Keep editing")).toBeTruthy();
    expect(screen.queryByText("Save character")).toBeNull();
  });
});

describe("more options", () => {
  const draftWithCastAndBeats: StudioCreateDraft = {
    ...BASE_DRAFT,
    characters: [{ name: "Priya", description: "A baker.", isHero: true }],
    beats: ["The first letter arrives.", "The keeper writes back."],
  };

  it("tags cast chips with @ but inserts the bare name into the moment", async () => {
    await render(<Harness initial={draftWithCastAndBeats} />);
    await fireEvent.press(screen.getByLabelText("More options"));

    expect(screen.getByText("@Priya")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("Add Priya to this moment"));
    // The moment text reaches the prompt and is echoed on the review screen,
    // so the "@" stays in the chip's label and out of the value.
    expect(screen.getByPlaceholderText("Add a moment").props.value).toBe("Priya");
  });

  it("does not show the chapter plan", async () => {
    await render(<Harness initial={draftWithCastAndBeats} />);
    await fireEvent.press(screen.getByLabelText("More options"));

    expect(screen.queryByText("Chapter plan")).toBeNull();
    expect(screen.queryByText("The first letter arrives.")).toBeNull();
  });
});

describe("review screen", () => {
  it("shows brief strength as an accessible meter, not a card", async () => {
    // Idea + premise = 2 of the 4 scored slots, so "Good".
    await render(<Harness initial={{ ...BASE_DRAFT, whereAndWhen: "A tidal island, 1974" }} />);
    await fireEvent.press(screen.getByText("Create · 3 credits"));

    const meter = screen.getByRole("progressbar");
    // A coloured bar alone tells a screen reader nothing; the level and the
    // count have to be in the name.
    expect(meter.props.accessibilityLabel).toContain("Brief strength");
    expect(meter.props.accessibilityLabel).toContain("Good");
    expect(meter.props.accessibilityValue).toEqual({ min: 0, max: 4, now: 2 });
    expect(screen.getByText("2/4")).toBeTruthy();

    // The old card's own line is gone.
    expect(screen.queryByText("2 of 4 filled")).toBeNull();
  });
});
