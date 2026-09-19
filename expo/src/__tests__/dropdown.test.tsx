import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { Dropdown, DropdownGroup } from "@/components/create/Dropdown";

jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return new Proxy({}, { get: () => () => React.createElement(React.Fragment) });
});

/**
 * The test renderer never models native window layering, so a query that
 * merely finds an element in the tree cannot by itself prove a second
 * trigger is reachable on a real device -- a `Modal`-based menu would pass
 * that same query, because `Modal`'s children are still part of the React
 * tree even though the *native* Modal opens a separate window that covers
 * the whole screen and would swallow the tap before it ever reached the
 * other trigger. What the test renderer *can* prove structurally is that no
 * `Modal` is used at all, which rules that failure mode out regardless of
 * what the renderer does or does not simulate.
 */
function containsModal(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(containsModal);
  const { type, children } = node as { type?: unknown; children?: unknown };
  if (type === "Modal") return true;
  return containsModal(children);
}

const OPTIONS = [
  { value: "short", label: "Short" },
  { value: "standard", label: "Standard" },
  { value: "long", label: "Long" },
];

function SingleDropdown({ onChange }: { onChange: (value: string) => void }) {
  const [value, setValue] = React.useState("standard");
  return (
    <Dropdown
      id="length"
      label="Chapter length"
      value={value}
      options={OPTIONS}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      testID="length-dropdown"
    />
  );
}

function TwoDropdowns() {
  const [a, setA] = React.useState("short");
  const [b, setB] = React.useState("English");
  return (
    <DropdownGroup>
      <Dropdown
        id="a"
        label="Chapters"
        value={a}
        options={[
          { value: "short", label: "3" },
          { value: "long", label: "15" },
        ]}
        onChange={setA}
        testID="dropdown-a"
      />
      <Dropdown
        id="b"
        label="Language"
        value={b}
        options={[{ value: "English", label: "English" }]}
        onChange={setB}
        testID="dropdown-b"
      />
    </DropdownGroup>
  );
}

describe("Dropdown", () => {
  it("closes on outside tap and leaves the committed selection unchanged", async () => {
    const onChange = jest.fn();
    const view = await render(<SingleDropdown onChange={onChange} />);

    const trigger = view.getByRole("button", { name: "Chapter length" });
    expect(trigger.props.accessibilityValue).toEqual({ text: "Standard" });

    await fireEvent.press(trigger);
    expect(view.getByRole("button", { name: "Long" })).toBeTruthy();

    // Tapping the scrim (outside the menu) closes it without picking anything.
    // The scrim is deliberately hidden from the accessibility tree (see the
    // component), so it must be found with includeHiddenElements here.
    await fireEvent.press(
      view.getByTestId("length-dropdown-scrim", { includeHiddenElements: true }),
    );

    expect(view.queryByRole("button", { name: "Long" })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(
      view.getByRole("button", { name: "Chapter length" }).props.accessibilityValue,
    ).toEqual({ text: "Standard" });
  });

  it("commits the chosen option and closes", async () => {
    const onChange = jest.fn();
    const view = await render(<SingleDropdown onChange={onChange} />);

    await fireEvent.press(view.getByRole("button", { name: "Chapter length" }));
    await fireEvent.press(view.getByRole("button", { name: "Long" }));

    expect(onChange).toHaveBeenCalledWith("long");
    expect(view.queryByRole("button", { name: "Long" })).toBeNull();
    expect(
      view.getByRole("button", { name: "Chapter length" }).props.accessibilityValue,
    ).toEqual({ text: "Long" });
  });

  it("never renders a native Modal for the open menu", async () => {
    // A Modal opens a separate native window that covers the whole screen,
    // so while it is open the *other* dropdown's trigger sits underneath
    // that window and cannot receive a tap at all on a real device -- only
    // in this test renderer, which does not model window occlusion and
    // would happily let a query find (and "press") a trigger that a real
    // finger could never reach. Asserting the menu is never a Modal in the
    // first place is the one thing this renderer can prove that actually
    // rules that failure mode out.
    const view = await render(<TwoDropdowns />);
    await fireEvent.press(view.getByRole("button", { name: "Chapters" }));
    expect(containsModal(view.toJSON())).toBe(false);
  });

  it("opening a second dropdown in the same group closes the first, and its trigger is reachable while the first is open", async () => {
    const view = await render(<TwoDropdowns />);

    await fireEvent.press(view.getByRole("button", { name: "Chapters" }));
    expect(view.getByRole("button", { name: "15" })).toBeTruthy();

    // Language's trigger is scoped out of the *accessibility* tree while
    // Chapters' menu holds `accessibilityViewIsModal` (screen-reader focus
    // stays inside the open menu until it closes, same as any modal
    // popover) -- includeHiddenElements looks past that, the same way
    // sighted-user touch dispatch does, since accessibilityViewIsModal only
    // affects assistive-tech traversal, never raw touch delivery.
    await fireEvent.press(
      view.getByRole("button", { name: "Language", includeHiddenElements: true }),
    );

    // The Chapters menu's "15" option is gone -- opening Language closed it.
    expect(view.queryByRole("button", { name: "15" })).toBeNull();
    expect(view.getByRole("button", { name: "English" })).toBeTruthy();
  });
});

/**
 * Every option is reachable, wherever on the screen the trigger sits.
 *
 * The reported bug: the Genre dropdown showed "four to five" of its twelve
 * genres, Horror and Romance were simply not there, and a genre scrolled past
 * could not be selected again. The cause was not the option list -- that has
 * had all twelve in it throughout -- but where the menu was drawn. It opened
 * downward from the trigger with a flat 320px height and no knowledge of where
 * the screen ends, so for a trigger low on the page most of the menu hung off
 * the bottom edge. That part was not merely clipped, it was UNREACHABLE: a
 * ScrollView cannot be scrolled through a region that is not on screen.
 *
 * These assert the two properties that make the list usable: the menu never
 * extends past the viewport, and it never renders fewer rows than it was given.
 */
const TWELVE = [
  "adventure", "comedy", "educational", "fanfiction", "folktale", "historical",
  "scifi", "fantasy", "mystery", "horror", "sliceOfLife", "romance",
].map((value) => ({ value, label: value }));

/** The menu's own style, found by the maxHeight/top pair only it carries. */
function menuFrame(node: unknown): { top: number; maxHeight: number } | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = menuFrame(child);
      if (found) return found;
    }
    return null;
  }
  const { props, children } = node as { props?: Record<string, unknown>; children?: unknown };
  const style = props?.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
  if (flat && typeof flat === "object") {
    const candidate = flat as { top?: unknown; maxHeight?: unknown; position?: unknown };
    if (
      candidate.position === "absolute" &&
      typeof candidate.top === "number" &&
      typeof candidate.maxHeight === "number"
    ) {
      return { top: candidate.top, maxHeight: candidate.maxHeight };
    }
  }
  return menuFrame(children);
}

function GenreDropdown() {
  const [value, setValue] = React.useState("fantasy");
  return (
    <DropdownGroup>
      <Dropdown
        id="genre"
        label="Genre"
        value={value}
        options={TWELVE}
        onChange={setValue}
        testID="genre-dropdown"
      />
    </DropdownGroup>
  );
}

it("renders every option it was given, not the handful that fit", async () => {
  const view = await render(<GenreDropdown />);
  await fireEvent.press(view.getByTestId("genre-dropdown"));

  // Horror and Romance are the two the report named by name; they sit 10th
  // and 12th, which is precisely why they were the ones that went missing.
  for (const option of TWELVE) {
    expect(
      view.getAllByText(option.label, { includeHiddenElements: true }).length,
    ).toBeGreaterThan(0);
  }
});

it("keeps the menu inside the viewport instead of running off the bottom", async () => {
  // `measureInWindow` never resolves in the test host, so the trigger anchor
  // is the null fallback and the menu is positioned at the top of the root.
  // A short window reproduces the same arithmetic the real bug came from --
  // a menu taller than the space it has -- without needing a real layout
  // pass. Against the old code this fails: it asked for a flat 320 regardless.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Dimensions } = require("react-native");
  const real = Dimensions.get;
  Dimensions.get = (dim: string) =>
    dim === "window" ? { width: 390, height: 220, scale: 2, fontScale: 1 } : real(dim);
  try {
    const view = await render(<GenreDropdown />);
    await fireEvent.press(view.getByTestId("genre-dropdown"));

    const frame = menuFrame(view.toJSON());
    expect(frame).not.toBeNull();
    expect(frame!.top + frame!.maxHeight).toBeLessThanOrEqual(220);
    // Still a usable list, not a sliver: the clamp has a floor.
    expect(frame!.maxHeight).toBeGreaterThanOrEqual(160);
  } finally {
    Dimensions.get = real;
  }
});

it("never asks for more height than the room it has, even when no side is roomy", async () => {
  // Review finding: the flip threshold was also used as a floor on the
  // height, so when neither side had 160px -- a short window, or a keyboard
  // up -- the menu was drawn taller than the space and hung off the edge,
  // into the region a ScrollView cannot be scrolled through. That is the
  // original bug, re-created by its own fix. 120px of window leaves about
  // 102 once the gap and the screen margin are taken.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Dimensions } = require("react-native");
  const real = Dimensions.get;
  Dimensions.get = (dim: string) =>
    dim === "window" ? { width: 390, height: 120, scale: 2, fontScale: 1 } : real(dim);
  try {
    const view = await render(<GenreDropdown />);
    await fireEvent.press(view.getByTestId("genre-dropdown"));

    const frame = menuFrame(view.toJSON());
    expect(frame).not.toBeNull();
    expect(frame!.top + frame!.maxHeight).toBeLessThanOrEqual(120);
  } finally {
    Dimensions.get = real;
  }
});

it("re-selects a genre that was previously scrolled past", async () => {
  // The second half of the report: after switching away from Fantasy it could
  // not be found again. Fantasy is 8th of twelve.
  const view = await render(<GenreDropdown />);

  await fireEvent.press(view.getByTestId("genre-dropdown"));
  await fireEvent.press(
    view.getAllByLabelText("horror", { includeHiddenElements: true })[0],
  );

  await fireEvent.press(view.getByTestId("genre-dropdown"));
  const fantasy = view.getAllByLabelText("fantasy", { includeHiddenElements: true })[0];
  expect(fantasy).toBeTruthy();
  await fireEvent.press(fantasy);

  expect(
    view.getAllByText("fantasy", { includeHiddenElements: true }).length,
  ).toBeGreaterThan(0);
});
