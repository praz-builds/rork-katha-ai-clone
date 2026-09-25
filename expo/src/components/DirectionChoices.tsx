import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { Check, Circle, PenLine, Shuffle, Signpost, X } from "lucide-react-native";
import { MAX_NEXT_INSTRUCTION_CHARS } from "@/lib/pricing-limits";
import { Button } from "@/components/Button";
import { colors, fonts, radius, spacing, type } from "@/theme";
import type { ReaderTheme } from "@/lib/reading-themes";

/**
 * The one direction-chip surface in the app.
 *
 * It was the bottom half of `components/reader/ChapterEnd.tsx` and nothing
 * else, because branching a story only ever happened at a chapter end. The
 * create flow now asks the same question before chapter one exists -- the
 * writer picks the direction their story opens in instead of confirming a
 * review screen -- and a SECOND set of cards would be the same decision
 * rendered twice, free to drift in wording, weight and behaviour. So the
 * cards, the write-your-own composer and the surprise-me path live here once
 * and both callers render this.
 *
 * What stays with each caller: where the options come from, what a choice
 * costs, and what a choice does. This component knows only that it is showing
 * a list of directions and handing one back.
 */

/**
 * One concrete direction a story can be sent in.
 *
 * `prompt` is specific prose AND AN INSTRUCTION -- "Ask Aaji to open the stuck
 * page and share the old fort song", never a question ("Who left the page
 * stuck?") and never a generic label ("Continue the plot"). It travels to the
 * model unchanged, so what the reader reads on the card is exactly what the
 * model is told.
 */
export type ContinuationOption = {
  id: string;
  prompt: string;
};

export type DirectionStatus = "loading" | "ready" | "unavailable";

/**
 * The character counter appears only when the limit is close enough to matter.
 * A counter on an empty field is a word budget nobody asked for.
 */
/**
 * The counter appears only when the limit is close enough to matter.
 *
 * Derived from whatever limit this instance is actually held to, because the
 * two surfaces have different ones and a counter that counts to the wrong
 * number is worse than none.
 */
function counterVisibleAt(limit: number): number {
  return Math.round(limit * 0.8);
}

function nonEmpty(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The same cards, after the fact: the paths a chapter was offered and the one
 * it took, with nothing left to press.
 *
 * A second component would have been easier and wrong. The whole claim this
 * surface makes -- "these were the options" -- only holds if the frozen chips
 * are the live chips, and two implementations of a card are two chances for
 * the record to stop looking like the decision it records.
 */
export type ReadOnlyDirectionChoicesProps = {
  readOnly: true;
  /** What this block is, e.g. "The paths from here". */
  heading: string;
  /** Every direction that was offered, in offer order. */
  options: ContinuationOption[];
  /**
   * The prompt of the direction the story actually took, matched by prose.
   *
   * Undefined marks nothing, which is the honest rendering of a chapter that
   * was written with no direction at all.
   */
  chosen?: string;
  /**
   * One short line saying who decided, shown under the taken card.
   *
   * Undefined says nothing. `direction_chosen_by` is null for rows where
   * nobody recorded a chooser, and a reader must never be told they picked a
   * path the model picked -- so the caller passes a sentence only when the
   * column supports one.
   */
  attribution?: string;
  testIDPrefix: string;
  /**
   * Chapter-end choices live on a reader page rather than an app card.  The
   * reader supplies its selected palette so this shared component stays
   * legible in Night mode; Create intentionally leaves it unset.
   */
  readerTheme?: ReaderTheme;
};

export type InteractiveDirectionChoicesProps = {
  /** Live surface: the reader is being asked, and a tap spends a credit. */
  readOnly?: false;
  /** The question this surface is asking, e.g. "What's next?". */
  heading: string;
  /**
   * How loud the heading is. `section` (the default) is a heading inside a
   * page, as at a chapter end. `step` is the page's own heading, as on
   * Create's "Where does it begin?", and takes `type.createTitle` so it
   * matches every other create step.
   */
  headingSize?: "section" | "step";
  /** What choosing costs. Every path out of here costs the same, so it sits above them all. */
  priceNote: string;
  status: DirectionStatus;
  options: ContinuationOption[];
  /** Shown in place of the cards when `status` is "unavailable". */
  unavailableReason: string;
  /** Accessible name for the spinner row, e.g. "Loading suggested directions". */
  loadingLabel: string;
  /** Said while the spinner is up, e.g. "Finding directions for this story...". */
  loadingMessage: string;
  /** Accessible hint on every card, e.g. "Writes chapter 4 in this direction". */
  chooseHint: string;
  /** The composer's submit label, e.g. "Continue · 1 credit". */
  submitLabel: string;
  /** The collapsed third card's label. */
  writeOwnLabel: string;
  /** Placeholder inside the composer. */
  composerPlaceholder: string;
  /**
   * Prefix for every `testID` here. The reader's surface keeps the ids its
   * tests already assert (`chapter-end-*`); the create flow gets its own.
   */
  testIDPrefix: string;
  /**
   * How long the reader's own words may be, in characters.
   *
   * Parameterised because the two surfaces feed DIFFERENT server fields with
   * different bounds, and the composer used to hard-code the larger one. At a
   * chapter end the text becomes `next_instruction` (300); in the create flow
   * it becomes `beats[0]`, which `validation.ts` bounds to 200 -- so a reader
   * who typed 250 characters of opening direction had the tail silently cut on
   * the server, with the app having shown them a field that accepted it and a
   * counter that said they had room. Defaults to the chapter-end limit, which
   * is the caller that existed first.
   */
  charLimit?: number;
  /** A direction, or `undefined` for "surprise me" -- let Katha decide. */
  onChoose: (direction?: string) => void;
  /** See {@link ReadOnlyDirectionChoicesProps.readerTheme}. */
  readerTheme?: ReaderTheme;
};

export type DirectionChoicesProps =
  | InteractiveDirectionChoicesProps
  | ReadOnlyDirectionChoicesProps;

export default function DirectionChoices(props: DirectionChoicesProps) {
  const reduceMotion = useReducedMotion();
  const readerTheme = props.readerTheme;
  const readerText = readerTheme ? { color: readerTheme.social.text } : undefined;
  const readerMuted = readerTheme ? { color: readerTheme.social.muted } : undefined;
  const readerCard = readerTheme
    ? { backgroundColor: readerTheme.social.surface, borderColor: readerTheme.divider }
    : undefined;
  const readerField = readerTheme
    ? { backgroundColor: readerTheme.social.field, color: readerTheme.social.text }
    : undefined;
  // The composer starts closed on purpose. Suggested directions are the
  // primary surface; typing your own is the escape hatch, and an escape hatch
  // that is open by default reads as the main path.
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerText, setComposerText] = useState("");

  // A frozen record is never loading and never unavailable: it is a list of
  // things that already happened. Derived rather than branched around so the
  // hook below keeps running in both modes.
  const status = props.readOnly === true ? "ready" : props.status;

  // With nothing derived, the writer's own words are the only way on, so the
  // composer opens rather than hiding behind one more tap. Only ever opens it:
  // a later status change must not close a composer somebody is typing into.
  useEffect(() => {
    if (status === "unavailable") setComposerOpen(true);
  }, [status]);

  if (props.readOnly === true) {
    const { heading, options, chosen, attribution, testIDPrefix } = props;
    // Nothing recorded, nothing rendered -- not a heading, not an empty state.
    // A chapter written before the columns existed has an unknown answer, and
    // an empty block in its place would read as a known one.
    if (options.length === 0) return null;
    return (
      <View style={styles.wrap} testID={`${testIDPrefix}-paths`}>
        <Text style={[styles.heading, readerText]}>{heading}</Text>
        {options.map((option, index) => {
          // Matched on the prose, because that is what was sent to the model
          // and what is stored in `direction_chosen` -- the ids are generated
          // per offer and do not survive the round trip.
          const taken = chosen !== undefined && option.prompt === chosen;
          return (
            <View
              key={option.id}
              /* One accessible node per path, spoken as a fact rather than as
                 something to activate. No `button` role, no `onPress`, no
                 hint: there is nothing here to do, and announcing a control
                 that cannot be operated is worse than announcing nothing. */
              accessible
              accessibilityRole="text"
              accessibilityLabel={taken
                ? `Taken: ${option.prompt}${attribution ? `. ${attribution}` : ""}`
                : `Not taken: ${option.prompt}`}
              style={[
                styles.optionCard,
                readerCard,
                styles.pathCard,
                taken && (readerTheme
                  ? { borderColor: colors.accent, backgroundColor: readerTheme.social.field }
                  : styles.pathCardTaken),
              ]}
              testID={`${testIDPrefix}-path-${index}`}
            >
              {taken
                ? <Check size={16} color={colors.accent} />
                : <Circle size={16} color={readerTheme?.social.muted ?? colors.tertiary} />}
              <View style={styles.pathBody}>
                <Text
                  style={[
                    styles.optionText,
                    readerText,
                    !taken && [styles.pathTextUntaken, readerMuted],
                  ]}
                >
                  {option.prompt}
                </Text>
                {taken && attribution
                  ? (
                    <Text style={[styles.pathAttribution, readerMuted]}>
                      {attribution}
                    </Text>
                  )
                  : null}
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  const {
    heading,
    headingSize = "section",
    priceNote,
    options,
    unavailableReason,
    loadingLabel,
    loadingMessage,
    chooseHint,
    submitLabel,
    writeOwnLabel,
    composerPlaceholder,
    testIDPrefix,
    onChoose,
    charLimit = MAX_NEXT_INSTRUCTION_CHARS,
  } = props;

  return (
    <View style={styles.wrap}>
      <Text
        style={[
          headingSize === "step" ? styles.stepHeading : styles.heading,
          readerText,
        ]}
        accessibilityRole={headingSize === "step" ? "header" : undefined}
      >
        {heading}
      </Text>
      {/* The price rides with the surface, not with one button, because every
        * path out of here - a suggested direction, a typed one, or letting
        * Katha decide - does the same work and costs the same. Putting it only
        * on the composer's submit button hid it from the cards, which are the
        * path most people take. */}
      <Text style={[styles.priceNote, readerMuted]}>{priceNote}</Text>
      {status === "loading" ? (
        <View style={styles.loadingRow} accessibilityLabel={loadingLabel}>
          <ActivityIndicator color={readerTheme?.social.muted ?? colors.muted} />
          <Text style={[styles.mutedBody, readerMuted]}>{loadingMessage}</Text>
        </View>
      ) : null}
      {status === "unavailable" ? (
        <Text style={[styles.mutedBody, readerMuted]}>{unavailableReason}</Text>
      ) : null}
      {/* The suggested directions ARE the surface. They were previously one
        * card among equals next to a full-width free-text box, and anyone
        * whose story yielded fewer than two suggestions saw the box alone -
        * which reads as "tell us what to write", the opposite of what this
        * feature is for. Each card is the whole tap target and fires
        * immediately; the prose on it is the exact instruction that is sent,
        * so what is read is what the model is told. */}
      {status === "ready"
        ? options.map((option, index) => (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityLabel={`Continue: ${option.prompt}`}
            accessibilityHint={chooseHint}
            style={({ pressed }) => [
              styles.optionCard,
              readerCard,
              pressed && !reduceMotion && (readerTheme
                ? { borderColor: colors.accent, backgroundColor: readerTheme.social.field }
                : styles.optionCardPressed),
            ]}
            onPress={() => onChoose(option.prompt)}
            testID={`${testIDPrefix}-option-${index}`}
          >
            {/* A signpost: this card is a way the story could go. Not
              * Sparkles, which in this app means credits and nothing else. */}
            <Signpost size={16} color={colors.accent} />
            <Text style={[styles.optionText, readerText]}>{option.prompt}</Text>
          </Pressable>
        ))
        : null}
      {/*
        THE THIRD CARD.

        "Write your own" used to be a small muted text link, next to a second
        one called "Let Katha decide" -- two lightweight controls competing for
        the same decision, both of them visually arguing that they were
        afterthoughts. It is one card now, the same weight and the same width
        as the directions above it, because it is the same kind of choice.

        "or a surprise" is the second control folded in rather than dropped.
        Katha deciding means sending NO instruction at all, so it belongs with
        the box where the words would otherwise be typed, not in a row of its
        own.
      */}
      {composerOpen ? (
        <View style={[styles.composerCard, readerCard]} testID={`${testIDPrefix}-composer`}>
          <View style={styles.composerHeader}>
            <PenLine size={16} color={colors.accent} />
            <Text style={[styles.composerTitle, readerText]}>Write your own</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close your own direction"
              hitSlop={8}
              style={styles.composerClose}
              onPress={() => setComposerOpen(false)}
              testID={`${testIDPrefix}-composer-close`}
            >
              <X size={18} color={readerTheme?.social.muted ?? colors.muted} />
            </Pressable>
          </View>
          {/* The register is taught once, with an example, rather than left to
            * be discovered by writing a question and getting a chapter that
            * answers one. */}
          <Text style={[styles.composerHint, readerMuted]}>
            An instruction, not a question — &ldquo;Take Meera to the fort path.&rdquo;
          </Text>
          <TextInput
            multiline
            autoFocus
            value={composerText}
            onChangeText={setComposerText}
            maxLength={charLimit}
            placeholder={composerPlaceholder}
            placeholderTextColor={readerTheme?.social.muted ?? colors.tertiary}
            style={[styles.composerInput, readerField]}
            accessibilityLabel="Write your own direction"
            accessibilityHint="Optional. Leave it blank and Katha decides."
            testID={`${testIDPrefix}-composer-input`}
          />
          {composerText.length >= counterVisibleAt(charLimit) ? (
            <Text style={[styles.composerCount, readerMuted]} testID={`${testIDPrefix}-composer-count`}>
              {composerText.length} / {charLimit}
            </Text>
          ) : null}
          <View style={styles.composerFooter}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Surprise me, let Katha decide"
              style={({ pressed }) => [
                styles.textCta,
                pressed && !reduceMotion && styles.textCtaPressed,
              ]}
              onPress={() => onChoose(undefined)}
              testID={`${testIDPrefix}-let-katha-decide`}
            >
              <Shuffle size={16} color={readerTheme?.social.muted ?? colors.muted} />
              <Text style={[styles.textCtaLabel, readerMuted]}>Surprise me</Text>
            </Pressable>
            <Button
              label={submitLabel}
              accessibilityLabel={
                composerText.trim()
                  ? "Continue with your direction"
                  : "Continue and let Katha decide"
              }
              onPress={() => onChoose(nonEmpty(composerText))}
              testID={`${testIDPrefix}-composer-submit`}
              style={styles.primaryButton}
            />
          </View>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Write your own direction, or let Katha surprise you"
          accessibilityHint={chooseHint}
          accessibilityState={{ expanded: false }}
          style={({ pressed }) => [
              styles.optionCard,
              readerCard,
            styles.writeOwnCard,
            pressed && !reduceMotion && (readerTheme
              ? { borderColor: colors.accent, backgroundColor: readerTheme.social.field }
              : styles.optionCardPressed),
          ]}
          onPress={() => setComposerOpen(true)}
          testID={`${testIDPrefix}-write-own`}
        >
          <PenLine size={16} color={colors.accent} />
          <Text style={[styles.optionText, styles.writeOwnText, readerText]}>{writeOwnLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.md,
  },
  heading: {
    ...type.headline,
    color: colors.ink,
  },
  stepHeading: {
    ...type.createTitle,
    color: colors.ink,
  },
  mutedBody: {
    ...type.subhead,
    color: colors.muted,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionCardPressed: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  priceNote: {
    ...type.caption,
    color: colors.muted,
    marginTop: -spacing.related,
  },
  // A path that was on the table, read back later. Same card as the live one,
  // with its interactive weight taken off: no fill and no pressed state,
  // because nothing here moves when it is touched.
  pathCard: {
    alignItems: "flex-start",
    backgroundColor: "transparent",
  },
  // The one the story took. The accent edge is the only marking, and it is the
  // same accent a chosen card takes while it is being pressed, so the record
  // looks like the decision it records.
  pathCardTaken: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  pathBody: {
    flex: 1,
    gap: spacing.xs,
  },
  // The roads not taken stay legible but stop competing with the one that was.
  pathTextUntaken: {
    color: colors.muted,
  },
  pathAttribution: {
    ...type.caption,
    color: colors.muted,
  },
  // The third card. Same shape as a derived direction so the row reads as
  // three peers, with a dashed edge as the one signal that this one is the
  // writer's to fill in.
  writeOwnCard: {
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    backgroundColor: "transparent",
  },
  // The label is an action, not a suggestion, so it takes the button label's
  // weight in the UI face. Never the display face: CTAs are Hanken.
  writeOwnText: {
    fontFamily: type.button.fontFamily,
    fontWeight: type.button.fontWeight,
  },
  composerCard: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  composerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  composerTitle: {
    ...type.headline,
    flex: 1,
    color: colors.ink,
  },
  composerClose: {
    width: 44,
    height: 44,
    marginRight: -spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  composerHint: {
    ...type.caption,
    color: colors.muted,
  },
  composerCount: {
    ...type.caption,
    textAlign: "right",
    color: colors.muted,
  },
  composerFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  // Deliberately not a card: no border, no fill, muted icon and label. The
  // weight difference between this and `optionCard` is the whole point of the
  // rebuild, so it must stay visible at a glance.
  textCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 44,
    paddingRight: spacing.xs,
  },
  textCtaPressed: {
    opacity: 0.6,
  },
  textCtaLabel: {
    ...type.subhead,
    color: colors.muted,
    fontWeight: "600",
  },
  optionText: {
    ...type.body,
    color: colors.ink,
    flex: 1,
  },
  composerInput: {
    minHeight: 96,
    borderRadius: radius.md,
    // The recessed inset fill, not another white card on a white card. Focus
    // needs no accent frame here either: the field is the only thing in the
    // card that takes a caret.
    backgroundColor: colors.surface2,
    padding: spacing.md,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 15,
    textAlignVertical: "top",
    outlineWidth: 0,
  },
  /** Layout only: it shares the composer's footer row with `textCta`. */
  primaryButton: { flex: 1 },
});
