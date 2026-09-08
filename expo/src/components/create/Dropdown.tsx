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
import { Check, ChevronDown } from "lucide-react-native";
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
  /** Optional supporting caption shown under the label inside the menu only. */
  detail?: string;
};

type Anchor = { x: number; y: number; width: number; height: number };

type OpenMenuDescriptor = {
  id: string;
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
  const [origin, setOrigin] = useState({ x: 0, y: 0 });

  const measureOrigin = useCallback(() => {
    // The root is not itself a Modal, so the menu's window-absolute anchor
    // coordinates (from the trigger's `measureInWindow`) need translating
    // into coordinates relative to this root before they mean anything as
    // `top`/`left` styles. The root sits still once laid out -- nothing
    // above a `DropdownGroup` scrolls it -- so measuring once on layout is
    // enough; re-measuring per open would only matter if the root itself
    // could move, which it does not.
    rootRef.current?.measureInWindow((x, y) => setOrigin({ x, y }));
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android" || !openId) return undefined;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      requestClose(openId);
      return true;
    });
    return () => sub.remove();
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
        <DropdownMenu descriptor={openMenu} originX={origin.x} originY={origin.y} onDone={() => requestClose(openId)} />
      ) : null}
    </View>
  );
}

function DropdownMenu({
  descriptor,
  originX,
  originY,
  onDone,
}: {
  descriptor: OpenMenuDescriptor;
  originX: number;
  originY: number;
  onDone: () => void;
}) {
  const { anchor, options, value, onChange } = descriptor;
  const screenWidth = Dimensions.get("window").width;
  const menuWidth = Math.min(Math.max(anchor?.width ?? 0, 220), screenWidth - SCREEN_MARGIN * 2);
  const left = anchor
    ? Math.min(Math.max(anchor.x - originX, SCREEN_MARGIN), screenWidth - menuWidth - SCREEN_MARGIN)
    : SCREEN_MARGIN;
  const top = anchor ? anchor.y - originY + anchor.height + 6 : 0;

  return (
    <View
      accessibilityViewIsModal
      accessibilityRole={Platform.OS === "web" ? "menu" : undefined}
      style={[
        styles.menu,
        { top, left, minWidth: menuWidth, maxWidth: screenWidth - SCREEN_MARGIN * 2 },
      ]}
    >
      <ScrollView
        style={styles.menuScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
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
              style={[styles.option, isSelected && styles.optionActive]}
            >
              <View style={styles.optionCopy}>
                {option.icon ? <Text style={styles.triggerIcon}>{option.icon}</Text> : null}
                <View style={styles.optionTextGroup}>
                  <Text style={[styles.optionLabel, isSelected && styles.optionLabelActive]}>
                    {option.label}
                  </Text>
                  {option.detail ? <Text style={styles.optionDetail}>{option.detail}</Text> : null}
                </View>
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
  const isOpen = openId === dropdownId;

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

  const open = useCallback(() => {
    Keyboard.dismiss();
    // Opens synchronously with no anchor yet, rather than waiting on
    // `measureInWindow` to open -- that call is asynchronous (a bridge
    // round-trip on a real device, and never resolved at all by the test
    // renderer's host-component mock), and gating "is the menu open" on it
    // would mean a real tap sometimes visibly does nothing for a moment,
    // and would mean this component could never be tested at all.
    // `DropdownMenu` renders a sensible fallback position until the anchor
    // measurement lands and this is upgraded to the real one.
    const descriptor: OpenMenuDescriptor = {
      id: dropdownId,
      testID,
      anchor: null,
      options: options as readonly DropdownOption[],
      value,
      onChange: (next) => onChange(next as T),
    };
    if (context) context.requestOpen(descriptor);
    else {
      setLocalOpenId(dropdownId);
      setLocalOpenMenu(descriptor);
    }
    onOpen?.();
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      const anchor: Anchor = { x, y, width, height };
      if (context) context.updateAnchor(dropdownId, anchor);
      else {
        setLocalOpenMenu((current) => (current && current.id === dropdownId ? { ...current, anchor } : current));
      }
    });
  }, [context, dropdownId, onChange, onOpen, options, testID, value]);

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

  const trigger = (
    <Pressable
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
      {variant === "field" ? <Text style={styles.fieldLabel}>{label}</Text> : null}
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

  if (context) {
    // A DropdownGroup ancestor owns the shared scrim and menu -- see
    // `DropdownOverlayHost` above -- so this instance only ever renders its
    // trigger.
    return <View style={style}>{trigger}</View>;
  }

  return (
    <DropdownOverlayHost
      openId={localOpenId}
      openMenu={localOpenMenu}
      requestClose={localRequestClose}
      rootStyle={style}
    >
      {trigger}
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
    minHeight: 48,
    flexDirection: "column",
    justifyContent: "center",
    gap: 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
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
    maxHeight: 320,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  menuScroll: { flexGrow: 0 },
  option: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionActive: { backgroundColor: colors.accentSoft },
  optionCopy: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  optionTextGroup: { flex: 1, gap: 1 },
  optionLabel: { color: colors.ink, fontFamily: fonts.ui, fontSize: 14, fontWeight: "700" },
  optionLabelActive: { color: colors.accent, fontWeight: "800" },
  optionDetail: { color: colors.tertiary, fontFamily: fonts.ui, fontSize: 12 },
});
