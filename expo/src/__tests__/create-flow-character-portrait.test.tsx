/**
 * Product-owner feedback on the Craft character sheet and the create flow.
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
 * removal of the "Edit" button, Regenerate re-reading the CURRENT form fields
 * rather than a stale closure, the unsaved-changes friction dialog, "@" on the
 * moment composer's cast chips, Chapter plan leaving More options, and the
 * direction step that replaced the review screen.
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

const mockLaunchImageLibrary = jest.fn();

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibrary(...args),
}));

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
import {
  setCharacterImageBalance,
  setCharacterImagesRemaining,
} from "@/lib/character-image-allowance";
import CreateBriefFlow, { referenceFileName } from "@/components/create/CreateBriefFlow";
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
function Harness({
  initial = BASE_DRAFT,
  onGenerate = () => undefined,
  credits = 10,
}: {
  initial?: StudioCreateDraft;
  onGenerate?: (choice?: { direction?: string; beats?: string[] }) => void;
  credits?: number;
}) {
  const [draft, setDraft] = useState<StudioCreateDraft>(initial);
  return (
    <CreateBriefFlow
      credits={credits}
      isAnonymous={false}
      draft={draft}
      setDraft={setDraft}
      onGenerate={onGenerate}
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

async function fillCharacter(name: string, appearance: string) {
  await fireEvent.changeText(screen.getByLabelText("Name"), name);
  await fireEvent.changeText(screen.getByLabelText("Appearance"), appearance);
}

beforeEach(() => {
  mockGenerateCharacterImage.mockReset();
  // Every test starts from "the server has not said", which is what a fresh
  // app launch looks like before `bootstrap-user` answers.
  setCharacterImagesRemaining(null);
  setCharacterImageBalance(null);
});

/**
 * What the price line says, and whether the button that spends it is offered.
 *
 * Three free character images per account, then 1 credit each (migration
 * 00096; six under 00088).
 * The panel used to quote from a prop nobody passed, so it always read "4
 * free" -- including for the account that had spent all four and was about to
 * be charged.
 */
describe("what the next character image costs", () => {
  it("counts down the free three from the server's own number", async () => {
    setCharacterImagesRemaining(3);
    await render(<Harness />);
    await openCharacterSheet();
    await fillCharacter("Priya", "A baker.");

    expect(screen.getByText("3 free")).toBeTruthy();
  });

  it("quotes a credit once the three are spent", async () => {
    setCharacterImagesRemaining(0);
    setCharacterImageBalance(4);
    await render(<Harness credits={4} />);
    await openCharacterSheet();
    await fillCharacter("Priya", "A baker.");

    expect(screen.getByText("1 credit")).toBeTruthy();
    // Priced, affordable, and therefore still offered.
    expect(screen.getByText("Create image").parent?.props.accessibilityState)
      .toMatchObject({ disabled: false });
  });

  it("quotes nothing at all until the server has said", async () => {
    // A guess here is an affordance that lies: "3 free" shown to an account
    // with none left is a button that takes a credit without warning.
    await render(<Harness />);
    await openCharacterSheet();
    await fillCharacter("Priya", "A baker.");

    expect(screen.queryByText("3 free")).toBeNull();
    expect(screen.queryByText("1 credit")).toBeNull();
  });

  it("does not offer a priced image the balance cannot buy", async () => {
    setCharacterImagesRemaining(0);
    await render(<Harness credits={0} />);
    await openCharacterSheet();
    await fillCharacter("Priya", "A baker.");

    expect(screen.getByText("1 credit — you have none")).toBeTruthy();
    expect(screen.getByText("Create image").parent?.props.accessibilityState)
      .toMatchObject({ disabled: true });

    await act(async () => {
      await fireEvent.press(screen.getByText("Create image"));
    });
    // The tap reached nothing. Letting them press it would spend twelve
    // seconds arriving at a refusal we could see coming.
    expect(mockGenerateCharacterImage).not.toHaveBeenCalled();
  });

  it("shows the server's refusal instead of an empty card", async () => {
    setCharacterImagesRemaining(1);
    mockGenerateCharacterImage.mockRejectedValue(
      new Error("You're out of credits. Top up to make more characters."),
    );
    await render(<Harness />);
    await openCharacterSheet();
    await fillCharacter("Priya", "A baker.");

    await act(async () => {
      await fireEvent.press(screen.getByText("Create image"));
    });

    // Before this, a refusal and a provider failure were the same silent
    // empty card, and only the server knows which of the two it was.
    expect(
      await screen.findByText("You're out of credits. Top up to make more characters."),
    ).toBeTruthy();
  });
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
    // "Creating…"; the card is what looked idle and got read as broken.
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
            appearance: "A baker.",
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

  it("offers Regenerate and no Edit button once an image exists", async () => {
    mockGenerateCharacterImage.mockResolvedValue({ url: PORTRAIT_URL });
    await render(<Harness />);
    await openCharacterSheet();
    await fillCharacter("Priya", "A 29-year-old baker with a practical streak.");

    await act(async () => {
      await fireEvent.press(screen.getByText("Create image"));
    });

    await screen.findByText("Regenerate");
    // Reimagine is the reader's word for rewriting a chapter; here the button
    // draws the picture again, and says so.
    expect(screen.queryByText("Reimagine")).toBeNull();
    // "Edit" only ever deleted portraitUrl to get back to an empty card.
    expect(screen.queryByText("Edit")).toBeNull();
  });

  it("re-reads the current form fields on every Regenerate", async () => {
    mockGenerateCharacterImage.mockResolvedValue({ url: PORTRAIT_URL });
    await render(<Harness />);
    await openCharacterSheet();
    await fillCharacter("Priya", "A baker.");
    await fireEvent.changeText(screen.getByLabelText("Appearance"), "Flour on her sleeves.");

    await act(async () => {
      await fireEvent.press(screen.getByText("Create image"));
    });
    await screen.findByText("Regenerate");

    // Change every field the call sends, then Regenerate. A stale closure here
    // would resend the first appearance and look like the model ignoring the
    // user rather than like a client bug.
    await fireEvent.changeText(screen.getByLabelText("Name"), "Naina");
    await fireEvent.changeText(screen.getByLabelText("Appearance"), "Ink-stained cuffs.");

    await act(async () => {
      await fireEvent.press(screen.getByText("Regenerate"));
    });

    expect(mockGenerateCharacterImage).toHaveBeenCalledTimes(2);
    expect(mockGenerateCharacterImage.mock.calls[1][0]).toMatchObject({
      name: "Naina",
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
    // Appearance only: `saveCharacter` no-ops without a name, so a "Save"
    // button here would be a dead end rather than a way out.
    await fireEvent.changeText(screen.getByLabelText("Appearance"), "A baker.");

    await fireEvent.press(screen.getByLabelText("Back to review and start"));

    await screen.findByText("Save this character?");
    expect(screen.getByText("Keep editing")).toBeTruthy();
    expect(screen.queryByText("Save character")).toBeNull();
  });
});

describe("more options", () => {
  const draftWithCastAndBeats: StudioCreateDraft = {
    ...BASE_DRAFT,
    characters: [{ name: "Priya", appearance: "A baker.", isHero: true }],
    beats: ["The first letter arrives.", "The keeper writes back."],
  };

  it("tags cast chips with @ but inserts the bare name into the moment", async () => {
    await render(<Harness initial={draftWithCastAndBeats} />);
    await fireEvent.press(screen.getByLabelText("More options"));

    expect(screen.getByText("@Priya")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("Add Priya to this moment"));
    // The moment text reaches the prompt verbatim, so the "@" stays in the
    // chip's label and out of the value.
    expect(
      screen.getByPlaceholderText(
        "Moments to include in general or between characters",
      ).props.value,
    ).toBe("Priya");
  });

  it("does not show the chapter plan", async () => {
    await render(<Harness initial={draftWithCastAndBeats} />);
    await fireEvent.press(screen.getByLabelText("More options"));

    expect(screen.queryByText("Chapter plan")).toBeNull();
    expect(screen.queryByText("The first letter arrives.")).toBeNull();
  });
});

describe("the direction step, in place of review", () => {
  it("replaces the review screen with the reader's own direction chips", async () => {
    const onGenerate = jest.fn();
    await render(<Harness onGenerate={onGenerate} />);
    // The button no longer states a price: the number moves with chapter art,
    // cover mode and chapter count, so putting it on the button meant two
    // places to be wrong about the same thing.
    await fireEvent.press(screen.getByText("Create story"));

    // The question the reader gets between chapters, asked before chapter one
    // exists -- not a restatement of the brief the writer just filled in.
    expect(await screen.findByText("Where does it begin?")).toBeTruthy();
    expect(screen.queryByText("Here is what Katha will write")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    // Nothing is spent by arriving here.
    expect(onGenerate).not.toHaveBeenCalled();

    // Shaping is unconfigured in this suite, so no opening can be derived and
    // the step degrades to the writer's own words -- honestly, and with the
    // way on already open rather than behind one more tap.
    const submit = await screen.findByTestId("create-direction-composer-submit");
    await fireEvent.changeText(
      screen.getByTestId("create-direction-composer-input"),
      "Open on the night the lamp fails.",
    );
    await fireEvent.press(submit);

    // The writer's sentence travels as chapter one's beat, unaltered.
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate.mock.calls[0][0]).toMatchObject({
      direction: "Open on the night the lamp fails.",
    });
  });

  it("starts with no direction at all when the writer asks for a surprise", async () => {
    const onGenerate = jest.fn();
    await render(<Harness onGenerate={onGenerate} />);
    await fireEvent.press(screen.getByText("Create story"));

    await fireEvent.press(
      await screen.findByTestId("create-direction-let-katha-decide"),
    );

    // `undefined`, never an invented opening: a generic instruction would fit
    // every story in the app and tell the model something this one never said.
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate.mock.calls[0][0].direction).toBeUndefined();
  });

  it("fires one generation on a double tap, not two", async () => {
    const onGenerate = jest.fn();
    await render(<Harness onGenerate={onGenerate} />);
    await fireEvent.press(screen.getByText("Create story"));

    const submit = await screen.findByTestId("create-direction-composer-submit");
    // Two presses as two separate events, which is what a real double tap
    // produces. Each one would reserve credits and write a story.
    await act(async () => {
      fireEvent.press(submit);
    });
    await act(async () => {
      fireEvent.press(submit);
    });

    expect(onGenerate).toHaveBeenCalledTimes(1);
  });
});

/**
 * The Craft sheet is where the writer sees a portrait and the cover style pick
 * on the same screen. `generate-character-image` accepted no style at all, so
 * a writer who chose Watercolour got a house-style cast next to a watercolour
 * cover and read the picker as doing nothing.
 */
describe("character portrait style", () => {
  it("draws the draft portrait in the style the brief is set to", async () => {
    mockGenerateCharacterImage.mockResolvedValue({ url: PORTRAIT_URL });
    await render(<Harness initial={{ ...BASE_DRAFT, imageStyle: "watercolor" }} />);
    await openCharacterSheet();
    await fillCharacter("Priya", "A baker with flour on her sleeves.");

    await act(async () => {
      await fireEvent.press(screen.getByText("Create image"));
    });

    expect(mockGenerateCharacterImage.mock.calls[0][0]).toMatchObject({
      name: "Priya",
      appearance: "A baker with flour on her sleeves.",
      imageStyle: "watercolor",
    });
  });
});

/**
 * Founder feedback, 2026-09-24: after attaching a reference photo nothing on
 * the sheet said WHICH photo was attached. The file name now stands in for the
 * attach button, on one line with its own Remove.
 */
describe("the reference photo", () => {
  beforeEach(() => mockLaunchImageLibrary.mockReset());

  it("shows the attached photo's file name, and Remove clears it", async () => {
    mockLaunchImageLibrary.mockResolvedValue({
      canceled: false,
      assets: [{
        base64: "AAAA",
        mimeType: "image/jpeg",
        fileName: "IMG_2231.jpg",
        uri: "file:///tmp/IMG_2231.jpg",
      }],
    });
    await render(<Harness />);
    await openCharacterSheet();

    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Attach a reference photo"));
    });

    expect(await screen.findByText("IMG_2231.jpg")).toBeTruthy();
    expect(screen.queryByLabelText("Attach a reference photo")).toBeNull();

    await fireEvent.press(screen.getByLabelText("Remove the reference photo"));
    expect(screen.queryByText("IMG_2231.jpg")).toBeNull();
    expect(screen.getByLabelText("Attach a reference photo")).toBeTruthy();
  });

  it("asks before discarding a sheet whose only change is the photo", async () => {
    mockLaunchImageLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ base64: "AAAA", mimeType: "image/jpeg", fileName: "IMG_2231.jpg" }],
    });
    await render(<Harness />);
    await openCharacterSheet();
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Attach a reference photo"));
    });
    await screen.findByText("IMG_2231.jpg");

    await fireEvent.press(screen.getByLabelText("Back to review and start"));

    expect(await screen.findByText("Save this character?")).toBeTruthy();
  });

  it("sends the photo to the image call but never its name", async () => {
    mockLaunchImageLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ base64: "AAAA", mimeType: "image/png", fileName: "me.png" }],
    });
    mockGenerateCharacterImage.mockResolvedValue({ url: PORTRAIT_URL });
    await render(<Harness />);
    await openCharacterSheet();
    await fillCharacter("Priya", "A baker.");
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Attach a reference photo"));
    });
    await screen.findByText("me.png");

    await act(async () => {
      await fireEvent.press(screen.getByText("Create image"));
    });

    const call = mockGenerateCharacterImage.mock.calls[0][0];
    expect(call.referenceImage).toBe("data:image/png;base64,AAAA");
    expect(JSON.stringify(call)).not.toContain("me.png");
  });
});

describe("referenceFileName", () => {
  it("prefers the name the picker gives", () => {
    expect(referenceFileName({ fileName: "IMG_2231.HEIC.jpg" }, "image/jpeg"))
      .toBe("IMG_2231.HEIC.jpg");
  });

  it("falls back to the last path segment of a file uri", () => {
    expect(referenceFileName({ uri: "file:///a/b/My%20Photo.png?x=1" }, "image/png"))
      .toBe("My Photo.png");
  });

  it("names a web blob or data url plainly from its type", () => {
    expect(referenceFileName({ uri: "blob:http://localhost/1234" }, "image/webp"))
      .toBe("photo.webp");
    expect(referenceFileName({ uri: "data:image/jpeg;base64,AAAA" }, "image/jpeg"))
      .toBe("photo.jpg");
    expect(referenceFileName({}, "image/png")).toBe("photo.png");
  });
});
