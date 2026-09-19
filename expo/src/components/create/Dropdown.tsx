import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AccessibilityInfo,
  BackHandler,
  Dimensions,
  findNodeHandle,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { Check, ChevronDown, HelpCircle } from "lucide-react-native";
import { colors, fonts, radius, spacing } from "@/theme";

/**
 * The one reusable dropdown for the create flow.
 *
 * Reported bug: a filter chip opened a picker that only closed by tapping the
 * same chip again -- tapping outside did nothing. This component owns the
 * fix once, centrally, rather than patching each picker: outside-tap and the
 * hardware back button both close it, and closing is always a cancel. The
 * option list only ever mutates the committed value when the user taps an
 * option; the scrim and back button paths never call `onChange`.
 *
 * Deliberately not a native `Modal`. A `Modal` opens a separate native
 * window that covers the whole screen, so while one dropdown's menu is open
 * the *other* dropdown's trigger sits underneath that window and cannot
 * receive a tap at all on a real device -- only in the test renderer, which
 * does not model window occlusion. The menu and its scrim are instead
 * rendered as absolutely-positioned siblings inside the normal view tree, in
 * an order that keeps every trigger reachable: the scrim renders *before*
 * `children` (so triggers, painted after it, sit visually and hit-test
 * above it) and the menu renders *after* `children` (so it -- and only it --
 * sits above everything, including other triggers it happens to overlap).
 */

export type DropdownOption<T extends string = string> = {
  value: T;
  /** Shown in the menu row, and on the closed trigger unless `valueLabel` is set. */
  label: string;
  /** Shorter text for the closed trigger, e.g. "15" for the menu row "15 chapters". */
  valueLabel?: string;
  /** Overrides the option row's accessible name, e.g. "Choose Romance" for a "Romance" row. */
  accessibilityLabel?: string;
  /** Optional leading glyph, e.g. a genre emoji. */
  icon?: string;
  /**
   * What this option means. Never shown in the menu itself -- the menu is a
   * plain list of labels. It appears only in the dropdown's help card, opened
   * from the "?" on a trigger that sets `help`.
   */
  detail?: string;
};

/** Gap between the trigger and the menu, on whichever side it opens. */
const MENU_GAP = 6;
/** Tallest the menu ever gets, even with room to spare. */
const MENU_MAX_HEIGHT = 320;
/**
 * Shortest the menu is allowed to be before it flips to the other side.
 *
 * Roughly three rows: enough that a list still reads as a list and still
 * scrolls usefully. Below this, opening downward is worse than opening up.
 */
const MENU_MIN_HEIGHT = 160;
/** Matches `styles.option.minHeight`; used only to decide if scrolling is possible. */
const OPTION_MIN_HEIGHT = 44;

type Anchor = { x: number; y: number; width: number; height: number };

type OpenMenuDescriptor = {
  id: string;
  /** "options" is the picker; "help" is the "?" card explaining the options. */
  kind: "options" | "help";
  /** The field name, used as the help card's title. */
  label: string;
  /** Optional sentence at the top of the help card, above the option list. */
  helpIntro?: string;
  testID?: string;
  // Starts null: opening must not wait on `measureInWindow`, which is
  // asynchronous (and, in tests, may never resolve at all -- see the
  // comment on `open` below). The menu renders with a sensible fallback
  // position until the measurement lands.
  anchor: Anchor | null;
  options: readonly DropdownOption[];
  value: string;
  onChange: (value: string) => void;
};

type DropdownContextValue = {
  openId: string | null;
  openMenu: OpenMenuDescriptor | null;
  requestOpen: (descriptor: OpenMenuDescriptor) => void;
  requestClose: (id?: string) => void;
  updateAnchor: (id: string, anchor: Anchor) => void;
};

const DropdownContext = createContext<DropdownContextValue | null>(null);

const SCREEN_MARGIN = 12;

/**
 * Marks the menu, the help card, every trigger and every "?" so the web
 * outside-click listener below leaves them alone. `dataSet` is how
 * react-native-web renders a `data-*` attribute; native ignores it.
 */
const KEEP_OPEN = { dataSet: { dropdownKeep: "1" } } as Record<string, unknown>;

/**
 * Closes whichever entry matches `id` (or, with no `id`, whichever is open).
 * Shared by the grouped and standalone open/close state so both behave
 * identically.
 */
function closeMatching(currentId: string | null, closeId?: string): string | null {
  if (closeId !== undefined && currentId !== closeId) return currentId;
  return null;
}

/**
 * Hosts the shared scrim and popover menu for one or more triggers. A
 * `DropdownGroup` renders one of these around every dropdown it coordinates;
 * a standalone `Dropdown` (no group above it) renders one around just
 * itself, so outside-tap-to-close and the no-Modal reachability guarantee
 * hold either way.
 */
function DropdownOverlayHost({
  openId,
  openMenu,
  requestClose,
  rootStyle,
  children,
}: {
  openId: string | null;
  openMenu: OpenMenuDescriptor | null;
  requestClose: (id?: string) => void;
  rootStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const rootRef = useRef<View>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0, height: 0 });

  const measureOrigin = useCallback(() => {
    // The root is not itself a Modal, so the menu's window-absolute anchor
    // coordinates (from the trigger's `measureInWindow`) need translating
    // into coordinates relative to this root before they mean anything as
    // `top`/`left` styles. The root sits still once laid out -- nothing
    // above a `DropdownGroup` scrolls it -- so measuring once on layout is
    // enough; re-measuring per open would only matter if the root itself
    // could move, which it does not.
    rootRef.current?.measureInWindow((x, y, _width, height) => setOrigin({ x, y, height }));
  }, []);

  // Re-measured on every open, not only on layout.
  //
  // The original comment here reasoned that the root "sits still once laid
  // out", which is true of scrolling but not of everything: a rotation, a
  // keyboard opening, or a browser window resize all move it, and a stale
  // origin puts the menu somewhere the trigger is not. Measuring on open
  // costs one call per interaction and removes the whole class.
  useEffect(() => {
    if (openId) measureOrigin();
  }, [openId, measureOrigin]);

  useEffect(() => {
    if (Platform.OS !== "android" || !openId) return undefined;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      requestClose(openId);
      return true;
    });
    return () => sub.remove();
  }, [openId, requestClose]);

  /*
    Web: a click ANYWHERE outside the open menu closes it.

    The scrim cannot do this on its own. It is painted behind the page so the
    other triggers stay reachable, which also puts every text field, label and
    card in front of it -- so a click on the Writing style box, say, never
    reached the scrim and a help card stayed open over the form. Clicks on a
    trigger or a "?" are left to their own handlers, so pressing the same
    control still toggles and pressing another still switches.
  */
  useEffect(() => {
    if (Platform.OS !== "web" || !openId) return undefined;
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return undefined;
    const onPointerDown = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest?.("[data-dropdown-keep]")) return;
      requestClose(openId);
    };
    doc.addEventListener("pointerdown", onPointerDown, true);
    return () => doc.removeEventListener("pointerdown", onPointerDown, true);
  }, [openId, requestClose]);

  return (
    <View ref={rootRef} onLayout={measureOrigin} style={rootStyle} collapsable={false}>
      {openId ? (
        <Pressable
          style={styles.scrim}
          onPress={() => requestClose(openId)}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID={openMenu?.testID ? `${openMenu.testID}-scrim` : `dropdown-scrim-${openId}`}
        />
      ) : null}
      {children}
      {openId && openMenu ? (
        <DropdownMenu
          descriptor={openMenu}
          originX={origin.x}
          originY={origin.y}
          originHeight={origin.height}
          onDone={() => requestClose(openId)}
        />
      ) : null}
    </View>
  );
}

function DropdownMenu({
  descriptor,
  originX,
  originY,
  originHeight,
  onDone,
}: {
  descriptor: OpenMenuDescriptor;
  originX: number;
  originY: number;
  originHeight: number;
  onDone: () => void;
}) {
  const { anchor, options, value, onChange } = descriptor;
  const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
  const menuWidth = Math.min(Math.max(anchor?.width ?? 0, 220), screenWidth - SCREEN_MARGIN * 2);
  const left = anchor
    ? Math.min(Math.max(anchor.x - originX, SCREEN_MARGIN), screenWidth - menuWidth - SCREEN_MARGIN)
    : SCREEN_MARGIN;

  /*
    The menu is placed against the VIEWPORT, not merely below the trigger.

    It used to be `top = trigger bottom` with a flat `maxHeight: 320` and no
    awareness of where the screen ends. A trigger sitting low on the page --
    which Genre does, inside More options -- put most of the menu below the
    bottom edge, and the part that hung off was not merely ugly, it was
    UNREACHABLE: a ScrollView cannot be scrolled through a region that is not
    on screen. With twelve genres and roughly five of them visible, the
    reported symptom was exactly that -- Horror and Romance simply did not
    exist, and a genre already scrolled past could not be selected again.

    So: measure the room actually available on each side, open upward when
    there is meaningfully more room above, and cap the height at what fits.
    The menu now always ends on screen, and the scroll happens inside a box
    the user can actually reach.
  */
  const anchorTop = anchor ? anchor.y : 0;
  const anchorBottom = anchor ? anchor.y + anchor.height : 0;
  const roomBelow = screenHeight - anchorBottom - MENU_GAP - SCREEN_MARGIN;
  const roomAbove = anchorTop - MENU_GAP - SCREEN_MARGIN;
  /*
    Open below the trigger whenever the list itself fits there, like every
    other dropdown. The flip used to fire whenever there was less than
    MENU_MIN_HEIGHT below -- so Language, the last field on the page with a
    single option, jumped above itself though its one row fitted below with
    room to spare. It now flips only when this menu's own height does not fit
    below (capped at MENU_MIN_HEIGHT for long lists, which may scroll), and
    only when above is a real improvement.
  */
  const neededHeight = descriptor.kind === "help"
    ? MENU_MIN_HEIGHT
    : Math.min(options.length * OPTION_MIN_HEIGHT + spacing.xs * 2 + 2, MENU_MIN_HEIGHT);
  const openUpward = roomBelow < neededHeight && roomAbove > roomBelow;
  const available = Math.max(openUpward ? roomAbove : roomBelow, MENU_MIN_HEIGHT);
  const maxHeight = Math.min(MENU_MAX_HEIGHT, available);
  /*
    An upward menu is pinned by its BOTTOM edge, just above the trigger.

    It used to be pinned by its top at `trigger - maxHeight`, which is only
    right when the menu is exactly `maxHeight` tall. A short list -- Language
    has one option -- then floated up to 320px above its own trigger, over
    whatever field sat there, and read as a different dropdown opening.
    Anchoring the bottom edge keeps the menu against its trigger whatever its
    real height turns out to be. `bottom` needs the root's height; until that
    has been measured the old top-based placement is the fallback.
  */
  const placement: ViewStyle = !anchor
    ? { top: 0 }
    : openUpward && originHeight > 0
      ? { bottom: originHeight - (anchorTop - originY) + MENU_GAP }
      : openUpward
        ? { top: anchorTop - originY - MENU_GAP - maxHeight }
        : { top: anchorBottom - originY + MENU_GAP };

  /*
    Nothing is painted at the fallback position.

    Opening does not wait on `measureInWindow` (see `open` below), so for the
    frame or two before the anchor lands the menu has no idea where its
    trigger is and sits at the top of the group. For a trigger near the top
    that is invisible; for Language, the LAST field on the page, the menu
    appeared a screen away from the finger and then jumped back down -- which
    reads as a different dropdown opening, which is exactly what was
    reported. Holding it invisible until it knows where to be turns a jump
    into a delay of one measurement.

    It is `opacity`, not an early `return null`: the rows stay mounted and
    reachable, so a screen reader and the test renderer -- where
    `measureInWindow` may never resolve at all -- still see a complete menu.
  */
  const placed = Boolean(anchor);

  if (descriptor.kind === "help") {
    const explained = options.filter((option) => option.detail);
    return (
      <View
        {...KEEP_OPEN}
        accessibilityViewIsModal
        style={[
          styles.menu,
          styles.helpCard,
          placement,
          { left, minWidth: menuWidth, maxWidth: Math.min(screenWidth - SCREEN_MARGIN * 2, 360), maxHeight },
          placed ? null : styles.menuUnplaced,
        ]}
      >
        <ScrollView style={styles.menuScroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.helpTitle} accessibilityRole="header">{descriptor.label}</Text>
          {descriptor.helpIntro ? <Text style={styles.helpText}>{descriptor.helpIntro}</Text> : null}
          {explained.map((option) => (
            <View key={option.value} style={styles.helpRow}>
              <Text style={styles.helpOption}>{option.label}</Text>
              <Text style={styles.helpText}>{option.detail}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // Worth stating because it is the difference between a scrollable list and
  // a truncated one: `showsVerticalScrollIndicator` is ON here. With it off,
  // a list that is cut off looks identical to a list that has ended, and a
  // user has no reason to try scrolling something they believe is complete.
  const scrolls = options.length * OPTION_MIN_HEIGHT > maxHeight;

  return (
    <View
      {...KEEP_OPEN}
      accessibilityViewIsModal
      accessibilityRole={Platform.OS === "web" ? "menu" : undefined}
      style={[
        styles.menu,
        placement,
        { left, minWidth: menuWidth, maxWidth: screenWidth - SCREEN_MARGIN * 2, maxHeight },
        placed ? null : styles.menuUnplaced,
      ]}
    >
      <ScrollView
        style={styles.menuScroll}
        contentContainerStyle={styles.menuList}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={scrolls}
        persistentScrollbar={scrolls}
      >
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <Pressable
              key={option.value}
              onPress={() => {
                onChange(option.value);
                onDone();
              }}
              accessibilityRole="button"
              accessibilityLabel={option.accessibilityLabel ?? option.label}
              accessibilityState={{ selected: isSelected }}
              // No dividers. Rows are told apart by their own rounded
              // highlight -- peach when selected, a quiet track tint under a
              // finger or pointer -- and by the gap between them.
              style={(state) => {
                const { pressed, hovered } = state as { pressed: boolean; hovered?: boolean };
                return [
                  styles.option,
                  (pressed || hovered) && !isSelected && styles.optionHover,
                  isSelected && styles.optionActive,
                ];
              }}
            >
              <View style={styles.optionCopy}>
                {option.icon ? <Text style={styles.triggerIcon}>{option.icon}</Text> : null}
                <Text style={[styles.optionLabel, isSelected && styles.optionLabelActive]}>
                  {option.label}
                </Text>
              </View>
              {isSelected ? <Check size={16} color={colors.accent} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * Wrap any part of a screen that hosts more than one Dropdown so opening one
 * closes whichever other one was open, per the "only one dropdown open at a
 * time" requirement. A Dropdown rendered with no group above it still works
 * on its own -- it just cannot see sibling dropdowns to close them.
 */
export function DropdownGroup({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<OpenMenuDescriptor | null>(null);

  const requestOpen = useCallback((descriptor: OpenMenuDescriptor) => {
    setOpenId(descriptor.id);
    setOpenMenu(descriptor);
  }, []);
  const requestClose = useCallback((id?: string) => {
    setOpenId((current) => closeMatching(current, id));
    setOpenMenu((current) => (id !== undefined && current?.id !== id ? current : null));
  }, []);
  const updateAnchor = useCallback((id: string, anchor: Anchor) => {
    setOpenMenu((current) => (current && current.id === id ? { ...current, anchor } : current));
  }, []);

  return (
    <DropdownContext.Provider value={{ openId, openMenu, requestOpen, requestClose, updateAnchor }}>
      <DropdownOverlayHost
        openId={openId}
        openMenu={openMenu}
        requestClose={requestClose}
        rootStyle={styles.groupRoot}
      >
        {children}
      </DropdownOverlayHost>
    </DropdownContext.Provider>
  );
}

export function Dropdown<T extends string = string>({
  id,
  label,
  value,
  options,
  onChange,
  onOpen,
  variant = "field",
  disabled = false,
  help,
  style,
  testID,
}: {
  /** Unique among dropdowns sharing a `DropdownGroup`. */
  id: string;
  /** The field name. Doubles as the trigger's accessible name. */
  label: string;
  value: T;
  options: readonly DropdownOption<T>[];
  onChange: (value: T) => void;
  /** Fires when the menu opens -- hook haptics here, not into `onChange`. */
  onOpen?: () => void;
  /** "field": labelled box (Chapters, Chapter length, Language). "pill": icon + value chip (Genre). */
  variant?: "field" | "pill";
  disabled?: boolean;
  /**
   * Puts a "?" at the trigger's top-right that opens a card explaining the
   * options (each option's `detail`). `true` lists the options alone; a string
   * is shown first, above them. Omit it where the options explain themselves
   * (Chapters, Language). Field variant only.
   */
  help?: boolean | string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const generatedId = useId();
  const dropdownId = id || generatedId;
  const context = useContext(DropdownContext);
  const triggerRef = useRef<View>(null);

  // Standalone fallback state, used only when no DropdownGroup ancestor
  // provides shared open/close state.
  const [localOpenId, setLocalOpenId] = useState<string | null>(null);
  const [localOpenMenu, setLocalOpenMenu] = useState<OpenMenuDescriptor | null>(null);

  const openId = context ? context.openId : localOpenId;
  const openKind = context ? context.openMenu?.kind : localOpenMenu?.kind;
  const isOpen = openId === dropdownId && openKind !== "help";
  const helpId = `${dropdownId}:help`;
  const isHelpOpen = openId === helpId;

  const localRequestClose = useCallback((closeId?: string) => {
    setLocalOpenId((current) => closeMatching(current, closeId));
    setLocalOpenMenu((current) => (closeId !== undefined && current?.id !== closeId ? current : null));
  }, []);

  const returnFocusToTrigger = useCallback(() => {
    // Best-effort: RN's accessibility focus API needs a native tag and does
    // not exist on web. Failing silently here just means the platform's own
    // default focus behaviour applies instead of an explicit nudge back.
    if (Platform.OS === "web") return;
    const node = findNodeHandle(triggerRef.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);

  const close = useCallback(() => {
    if (context) context.requestClose(dropdownId);
    else localRequestClose(dropdownId);
    returnFocusToTrigger();
  }, [context, dropdownId, localRequestClose, returnFocusToTrigger]);

  const show = useCallback((kind: "options" | "help") => {
    Keyboard.dismiss();
    const menuId = kind === "help" ? helpId : dropdownId;
    // Opens synchronously with no anchor yet, rather than waiting on
    // `measureInWindow` to open -- that call is asynchronous (a bridge
    // round-trip on a real device, and never resolved at all by the test
    // renderer's host-component mock), and gating "is the menu open" on it
    // would mean a real tap sometimes visibly does nothing for a moment,
    // and would mean this component could never be tested at all.
    // `DropdownMenu` renders a sensible fallback position until the anchor
    // measurement lands and this is upgraded to the real one.
    const descriptor: OpenMenuDescriptor = {
      id: menuId,
      kind,
      label,
      helpIntro: typeof help === "string" ? help : undefined,
      testID: testID && kind === "help" ? `${testID}-help` : testID,
      anchor: null,
      options: options as readonly DropdownOption[],
      value,
      onChange: (next) => onChange(next as T),
    };
    if (context) context.requestOpen(descriptor);
    else {
      setLocalOpenId(menuId);
      setLocalOpenMenu(descriptor);
    }
    onOpen?.();
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      const anchor: Anchor = { x, y, width, height };
      if (context) context.updateAnchor(menuId, anchor);
      else {
        setLocalOpenMenu((current) => (current && current.id === menuId ? { ...current, anchor } : current));
      }
    });
  }, [context, dropdownId, help, helpId, label, onChange, onOpen, options, testID, value]);

  const open = useCallback(() => show("options"), [show]);
  const closeHelp = useCallback(() => {
    if (context) context.requestClose(helpId);
    else localRequestClose(helpId);
  }, [context, helpId, localRequestClose]);
  const toggleHelp = useCallback(() => {
    if (isHelpOpen) closeHelp();
    else show("help");
  }, [closeHelp, isHelpOpen, show]);

  const toggle = useCallback(() => {
    if (isOpen) close();
    else open();
  }, [isOpen, open, close]);

  // The hardware back button closes only the dropdown that is actually
  // open, and goes through the same `close()` as everything else so focus
  // returns to the trigger -- matching what a plain outside tap does.
  useEffect(() => {
    if (Platform.OS !== "android" || !isOpen) return undefined;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [isOpen, close]);

  const selected = options.find((option) => option.value === value);
  const showHelp = variant === "field" && help !== undefined && help !== false;

  const trigger = (
    <Pressable
      {...KEEP_OPEN}
      ref={triggerRef}
      onPress={disabled ? undefined : toggle}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Announces the current value alongside the field name, so a screen
      // reader hears e.g. "Chapter length, Standard" without the visible
      // name itself having to change.
      accessibilityValue={selected ? { text: selected.valueLabel ?? selected.label } : undefined}
      accessibilityState={{ expanded: isOpen, disabled }}
      hitSlop={variant === "pill" ? undefined : 2}
      style={[
        variant === "pill" ? styles.pillTrigger : styles.fieldTrigger,
        disabled && styles.triggerDisabled,
      ]}
      testID={testID}
    >
      {variant === "field" ? <Text style={[styles.fieldLabel, showHelp && styles.fieldLabelWithHelp]}>{label}</Text> : null}
      <View style={styles.triggerValueRow}>
        {selected?.icon ? <Text style={styles.triggerIcon}>{selected.icon}</Text> : null}
        <Text
          numberOfLines={1}
          style={variant === "pill" ? styles.pillValueText : styles.fieldValueText}
        >
          {selected?.valueLabel ?? selected?.label ?? label}
        </Text>
        <ChevronDown
          size={variant === "pill" ? 16 : 15}
          color={variant === "pill" ? colors.accent : colors.tertiary}
        />
      </View>
    </Pressable>
  );

  /*
    A sibling of the trigger, not a child: a pressable inside a pressable is a
    button inside a button on web, and a tap on the "?" must never also open
    the menu. It stays tappable while the trigger is disabled, because a
    locked control is exactly the one whose options need explaining.
  */
  const helpButton = showHelp ? (
    <Pressable
      {...KEEP_OPEN}
      onPress={toggleHelp}
      accessibilityRole="button"
      accessibilityLabel={`About ${label}`}
      accessibilityState={{ expanded: isHelpOpen }}
      hitSlop={8}
      style={styles.helpButton}
      testID={testID ? `${testID}-help-button` : undefined}
    >
      <HelpCircle size={14} color={isHelpOpen ? colors.accent : colors.tertiary} />
    </Pressable>
  ) : null;

  if (context) {
    // A DropdownGroup ancestor owns the shared scrim and menu -- see
    // `DropdownOverlayHost` above -- so this instance only ever renders its
    // trigger.
    return <View style={style}>{trigger}{helpButton}</View>;
  }

  return (
    <DropdownOverlayHost
      openId={localOpenId}
      openMenu={localOpenMenu}
      requestClose={localRequestClose}
      rootStyle={style}
    >
      {trigger}
      {helpButton}
    </DropdownOverlayHost>
  );
}

const styles = StyleSheet.create({
  groupRoot: { flex: 1 },
  // Deliberately oversized and un-positioned relative to the *screen* --
  // this root may be as small as a single trigger (the standalone case) or
  // as large as the whole screen (the grouped case), and either way the
  // scrim must still reach every edge of the visible app. Because it is a
  // plain sibling (not a Modal), a large negative inset does that without
  // needing to know the device's actual dimensions.
  scrim: {
    position: "absolute",
    top: -2000,
    left: -2000,
    right: -2000,
    bottom: -2000,
  },
  fieldTrigger: {
    minHeight: 52,
    flexDirection: "column",
    justifyContent: "center",
    gap: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pillTrigger: {
    minWidth: 128,
    maxWidth: 170,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.accent,
    paddingHorizontal: spacing.md,
  },
  triggerDisabled: { opacity: 0.5 },
  fieldLabelWithHelp: { paddingRight: spacing.xl },
  // Level with the field label, and over the chevron's column so the two
  // right-edge glyphs line up; the trigger's taller padding keeps them apart.
  helpButton: {
    position: "absolute",
    top: 6,
    right: spacing.md - 5,
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: {
    color: colors.tertiary,
    fontFamily: fonts.ui,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  triggerValueRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  triggerIcon: { fontSize: 15 },
  fieldValueText: {
    flex: 1,
    color: colors.ink,
    fontFamily: fonts.ui,
    fontSize: 14,
    fontWeight: "700",
  },
  pillValueText: {
    color: colors.accent,
    fontFamily: fonts.ui,
    fontSize: 13,
    fontWeight: "800",
    flexShrink: 1,
  },
  menu: {
    position: "absolute",
    // Comfortably above any ordinary in-flow content (the highest sibling
    // zIndex elsewhere in the create flow is 20), so the menu -- and only
    // the menu -- reliably paints above everything else it might overlap.
    zIndex: 1000,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  /**
   * The one frame before the trigger has been measured. Invisible rather
   * than unmounted, so the rows are still there for a screen reader and for
   * the test renderer; see the comment on `placed`.
   */
  menuUnplaced: {
    opacity: 0,
  },
  menuScroll: { flexGrow: 0 },
  menuList: { padding: spacing.xs, gap: 2 },
  option: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionHover: { backgroundColor: colors.track },
  optionActive: { backgroundColor: colors.accentSoft },
  optionCopy: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  optionLabel: { flex: 1, color: colors.ink, fontFamily: fonts.ui, fontSize: 14, fontWeight: "700" },
  optionLabelActive: { color: colors.accent, fontWeight: "800" },
  helpCard: { padding: spacing.md },
  helpTitle: { color: colors.ink, fontFamily: fonts.ui, fontSize: 14, fontWeight: "800", marginBottom: spacing.xs },
  helpRow: { marginTop: spacing.sm, gap: 2 },
  helpOption: { color: colors.ink, fontFamily: fonts.ui, fontSize: 13, fontWeight: "700" },
  helpText: { color: colors.muted, fontFamily: fonts.ui, fontSize: 13, lineHeight: 18 },
});
