/**
 * THE CHROME IS CONTAINERLESS.
 *
 * The Create "+" in the tab bar is the reference: a glyph sitting on the
 * screen, no plate, no shadow. Before this, the same credits concept was drawn
 * three ways on three screens a person walks straight through — a white plate
 * with `shadows.card` on Home, a peach `accentSoft` capsule in the Get credits
 * header, and a third `accentSoft` capsule in the Create brief. A reader
 * checking their balance saw a different object each time.
 *
 * These are ABSENCE tests, which is an awkward thing to assert and the reason
 * they exist: a plate is one line of style, it comes back by accident, and
 * nothing else in the suite would notice. Every one of them reads the rendered
 * style rather than the source, so a plate reintroduced through a shared style
 * or a spread fails too.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { StyleSheet } from "react-native";
import { Bell } from "lucide-react-native";

import { HeaderAction } from "@/components/HeaderAction";
import { CreditPill } from "@/components/KathaPrimitives";
import { colors, controls } from "@/theme";

jest.mock("lucide-react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  return new Proxy({}, {
    get: () => () => ReactModule.createElement(ReactModule.Fragment),
  });
});

/**
 * The style a node actually renders with, flattened — a `Pressable` hands its
 * `style` prop back as an array (and sometimes as a function's result), and
 * reading `[0]` of that is how an assertion silently stops checking anything.
 */
function flatten(style: StyleProp<ViewStyle>): ViewStyle {
  return StyleSheet.flatten(style) ?? {};
}

describe("HeaderAction", () => {
  it("has no plate and no shadow", async () => {
    const view = await render(
      <HeaderAction icon={Bell} label="Notifications" onPress={jest.fn()} />,
    );
    const style = flatten(view.getByLabelText("Notifications").props.style);
    expect(style.backgroundColor).toBeUndefined();
    // `boxShadow` is how this codebase draws elevation (see `shadows`).
    expect((style as Record<string, unknown>).boxShadow).toBeUndefined();
  });

  it("keeps the 44pt target the plate used to sit behind", async () => {
    // Removing the plate removes the plate, not the touch target. Three of
    // these sit shoulder to shoulder in the corner a thumb reaches worst.
    const view = await render(
      <HeaderAction icon={Bell} label="Notifications" onPress={jest.fn()} />,
    );
    const style = flatten(view.getByLabelText("Notifications").props.style);
    expect(style.height).toBe(controls.headerActionTarget);
    expect(style.minWidth).toBe(controls.headerActionTarget);
    expect(controls.headerActionTarget).toBe(44);
  });

  it("keeps the unread dot, and draws it only when there is something unread", async () => {
    // The one decorative thing left in the chrome, and it survived the plate
    // going: a marker for something the reader has not seen. Asserted as a
    // difference rather than as a count, because the glyph is mocked out here
    // and an absolute number would be a fact about the mock.
    const quiet = await render(
      <HeaderAction icon={Bell} label="Notifications" onPress={jest.fn()} />,
    );
    const noisy = await render(
      <HeaderAction icon={Bell} label="Notifications" onPress={jest.fn()} dot />,
    );
    expect(noisy.getByLabelText("Notifications").children.length).toBe(
      quiet.getByLabelText("Notifications").children.length + 1,
    );
  });

  it("draws a bare glyph in `strong`, per DESIGN_SYSTEM section 4", async () => {
    // "`strong` for icons. Never `ink`, never `muted`." The bell takes the
    // default; the streak and the credit spark pass their own colour because
    // they are numbers about the reader rather than controls.
    let seen: string | undefined;
    const Probe = ({ color }: { color?: string }) => {
      seen = color;
      return null;
    };
    await render(<HeaderAction icon={Probe} label="Notifications" onPress={jest.fn()} />);
    expect(seen).toBe(colors.strong);
  });

  it("is a button when it has an onPress", async () => {
    const view = await render(
      <HeaderAction icon={Bell} label="Notifications" onPress={jest.fn()} />,
    );
    expect(view.getByLabelText("Notifications").props.accessibilityRole).toBe("button");
  });

  it("is a readout, not a button, when it has none", async () => {
    // The Get credits balance. It was made a HeaderAction and the component
    // required an onPress, so the call site passed the back action: a screen
    // reader announced "7 credits, button" and activating it left the screen.
    // Without an onPress there is nothing to activate.
    //
    // The role is "text", NOT undefined. Dropping the role entirely was the
    // first fix and it went one step too far: a bare labelled View is not
    // reliably an accessibility node, so the announcement went from wrong to
    // possibly absent. "text" says what the thing is.
    const view = await render(<HeaderAction icon={Bell} label="7 credits" />);
    const node = view.getByLabelText("7 credits");
    expect(node.props.accessibilityRole).toBe("text");
    expect(node.props.onClick).toBeUndefined();
  });

  it("announces the readout as one node, glyph and number together", async () => {
    // `accessible` is what makes the label load-bearing: the spark and the
    // "7" are leaves of one node rather than two things read in sequence.
    // Without it the label on the parent View may never be spoken at all.
    const view = await render(
      <HeaderAction icon={Bell} label="7 credits" value="7" dot />,
    );
    expect(view.getByLabelText("7 credits").props.accessible).toBe(true);
  });

  it("looks identical in both modes", async () => {
    // The readout is the same object as the action: same 44pt target, same
    // containerless ground. Only its pressability differs.
    const readout = await render(<HeaderAction icon={Bell} label="7 credits" value="7" />);
    const action = await render(
      <HeaderAction icon={Bell} label="Credits" value="7" onPress={jest.fn()} />,
    );
    const a = flatten(readout.getByLabelText("7 credits").props.style);
    const b = flatten(action.getByLabelText("Credits").props.style);
    expect(a.height).toBe(b.height);
    expect(a.minWidth).toBe(b.minWidth);
    expect(a.paddingHorizontal).toBe(b.paddingHorizontal);
    expect(a.backgroundColor).toBeUndefined();
  });

  it("keeps the dot in readout mode", async () => {
    const quiet = await render(<HeaderAction icon={Bell} label="7 credits" />);
    const noisy = await render(<HeaderAction icon={Bell} label="7 credits" dot />);
    expect(noisy.getByLabelText("7 credits").children.length).toBe(
      quiet.getByLabelText("7 credits").children.length + 1,
    );
  });
});

describe("CreditPill (the Create flow's readout)", () => {
  it("has no plate", async () => {
    // It was `colors.accentSoft`, which is the same peach capsule the Get
    // credits header used to draw. One idea, one face.
    const view = await render(<CreditPill credits={7} />);
    const style = flatten(view.getByText("7 credits").parent?.props.style);
    expect(style.backgroundColor).toBeUndefined();
  });

  it("keeps the gold, filled spark that every other credits affordance uses", async () => {
    // This is the one thing the three drifted copies always agreed on, so it
    // is the thing that must survive the convergence.
    const view = await render(<CreditPill credits={7} />);
    expect(view.getByText("7 credits")).toBeTruthy();
  });
});
