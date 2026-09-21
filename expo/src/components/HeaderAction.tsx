import React from "react";
import type { ComponentType } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, controls, fonts, radius, spacing } from "@/theme";

/**
 * One header action: a glyph, an optional value beside it, and nothing else.
 *
 * ## Containerless, and why
 *
 * The Create "+" in the tab bar is the reference — a glyph sitting on the
 * screen, no plate and no shadow — and this is the same kind of thing: a
 * control in the app's chrome rather than a card in its content. It used to
 * carry `colors.surface` and `shadows.card`, which made three small white
 * lozenges sit in the top-right corner of Home looking like three tiny cards
 * stacked on top of the page. A plate is how you say "this is a surface"; a
 * header action is not a surface, it is a place to put a thumb.
 *
 * The same credits concept had also been drawn three different ways — this
 * plate on Home, a peach `accentSoft` capsule in the Get credits header, and
 * `KathaPrimitives.CreditPill` in the Create flow — so a reader checking their
 * balance saw a different object on each of three consecutive screens. They
 * are one object now, and this file is it.
 *
 * ## What did NOT change
 *
 * **The 44 x 44 target.** 44 is the floor Apple's HIG and WCAG 2.2 both land
 * on, and it is a minimum on the TOUCH TARGET rather than on the ink: the
 * flame and the bell draw at 20pt inside a 44pt box. Removing the plate takes
 * the plate away, not the target — three of these sit shoulder to shoulder in
 * the top-right corner, which is exactly where a too-small target hurts most,
 * because the thumb arrives there at an angle at the edge of its reach.
 *
 * **The unread dot**, which is the one thing here that is allowed to be
 * decorative: a marker for something the reader has not seen.
 *
 * ## Colour
 *
 * `strong` for icons — never `ink`, never `muted` (DESIGN_SYSTEM.md section
 * 4). The exceptions are deliberate and are passed in: the streak flame is
 * `accent` and filled, the credit spark is `chromeStar` and filled, because
 * those two are numbers about the reader that they check every day and the
 * bell is a control. The bell earns attention with its dot when it has
 * something, and should not compete before then.
 *
 * The GLYPH carries the colour and the NUMBER stays `ink`. Tinting both made
 * the credit balance a gold number on a warm ground, which is the least
 * legible thing in the header and also the one thing there you actually read.
 *
 * ## Two modes, and why `onPress` is optional
 *
 * With an `onPress` this is a button. Without one it is a READOUT: a `View`
 * with `accessibilityRole="text"`, nothing to activate. The Get credits screen
 * is why. Its balance has always been a static number, and making `onPress`
 * required meant the call site handed it the nearest function to hand, which
 * was the back action: a screen reader then announced "7 credits, button" and
 * activating it left the screen. A component whose API forces a behaviour is
 * how a refactor ships a regression nobody chose.
 *
 * The readout is `accessible`, which is the half that was missing when the
 * role first came off. A bare labelled `View` is not guaranteed to be an
 * accessibility node at all on either platform — the glyph and the number stay
 * two separate leaves and the label on their parent may never be spoken, so
 * removing the wrong announcement left it possibly not announced. `accessible`
 * collapses the subtree into one node carrying one label, which is what a
 * readout is.
 *
 * ## The label is the call site's job, in BOTH modes
 *
 * Because the subtree is one node, nothing inside it is read on its own: not
 * the value `Text`, and not the dot, which is a bare styled `View` with no
 * text and has never been announced in either mode. The convention is that the
 * CALLER bakes the whole readout into `label` — `HomeScreen` passes
 * `Notifications, ${n} unread` rather than relying on the dot to say it. A
 * caller that draws a `value` or a `dot` and does not put it in `label` is
 * shipping a control whose state a screen reader cannot reach.
 *
 * The look is identical in both modes — same 44pt target, same dot, same
 * containerless plate-less ground — because the two are the same object and
 * only one of them is pressable.
 */
export function HeaderAction({
  icon: Icon,
  value,
  label,
  onPress,
  dot = false,
  tint,
  fill,
  iconSize = 20,
  testID,
}: {
  icon: ComponentType<{ size?: number; color?: string; fill?: string }>;
  /** Rendered only when there is one, so the same component draws a bare bell and a flame with a day count. */
  value?: string;
  /**
   * The whole announcement. The subtree is one accessibility node in both
   * modes, so `value` and `dot` are never read separately — say them here.
   */
  label: string;
  /** Omit it to draw a non-interactive readout. See "Two modes" above. */
  onPress?: () => void;
  /**
   * An unread marker. Drawn only for something the reader has not seen.
   * Purely visual: it carries no text, so the count or the "unread" belongs in
   * `label` at the call site. See "The label is the call site's job" above.
   */
  dot?: boolean;
  /** The glyph's colour, when it should be one. Defaults to `colors.strong`. */
  tint?: string;
  /** Fills the glyph, so the flame reads as lit rather than outlined. */
  fill?: string;
  /**
   * Glyph size. The default matches the bell, which is a plain outline; a
   * FILLED glyph at the same nominal size reads noticeably heavier, so the
   * credit spark is set smaller to sit level with the others rather than
   * looming over them.
   */
  iconSize?: number;
  testID?: string;
}) {
  const content = (
    <>
      <Icon size={iconSize} color={tint ?? colors.strong} fill={fill ?? "none"} />
      {value !== undefined && <Text style={styles.value}>{value}</Text>}
      {dot && <View style={styles.dot} />}
    </>
  );

  if (!onPress) {
    return (
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={label}
        testID={testID}
        style={[styles.action, value !== undefined && styles.actionWide]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => [
        styles.action,
        value !== undefined && styles.actionWide,
        pressed && styles.pressed,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /*
    No `backgroundColor` and no `boxShadow`. That absence is the design, so
    `header-chrome.test.tsx` asserts it rather than trusting this comment.

    `borderRadius` stays because the pressed state and the platform ripple
    need a shape to land in, and a rounded one on a 44pt square target is the
    only shape that does not look like a box appearing under a thumb.
  */
  action: {
    position: "relative",
    minWidth: controls.headerActionTarget,
    height: controls.headerActionTarget,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  /** A value beside the glyph needs the room the bare glyph does not. */
  actionWide: { paddingHorizontal: spacing.related },
  pressed: { opacity: 0.86, transform: [{ scale: 0.97 }] },
  value: {
    fontFamily: fonts.ui,
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800",
  },
  dot: {
    position: "absolute",
    top: 9,
    right: 10,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent,
    /*
      The ring is `colors.bg`, not `colors.surface`. It exists to part the dot
      from the bell's stroke, and with the plate gone what is behind it is the
      page, so a white ring would be a white speck on a warm ground.
    */
    borderWidth: 1.5,
    borderColor: colors.bg,
  },
});

export default HeaderAction;
