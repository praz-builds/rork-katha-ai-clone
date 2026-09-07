import { createContext, useCallback, useContext, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AccessibilityInfo,
  Dimensions,
  findNodeHandle,
  Keyboard,
  Modal,
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

type DropdownContextValue = {
  openId: string | null;
  requestOpen: (id: string) => void;
  requestClose: (id?: string) => void;
};

const DropdownContext = createContext<DropdownContextValue | null>(null);

/**
 * Wrap any part of a screen that hosts more than one Dropdown so opening one
 * closes whichever other one was open, per the "only one dropdown open at a
 * time" requirement. A Dropdown rendered with no group above it still works
 * on its own -- it just cannot see sibling dropdowns to close them.
 */
export function DropdownGroup({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const requestOpen = useCallback((id: string) => setOpenId(id), []);
  const requestClose = useCallback(
    (id?: string) =>
      setOpenId((current) => (id === undefined || current === id ? null : current)),
    [],
  );
  return (
    <DropdownContext.Provider value={{ openId, requestOpen, requestClose }}>
      {children}
    </DropdownContext.Provider>
  );
}

const SCREEN_MARGIN = 12;

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
  const [localOpen, setLocalOpen] = useState(false);
  const isOpen = context ? context.openId === dropdownId : localOpen;
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

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
    else setLocalOpen(false);
    returnFocusToTrigger();
  }, [context, dropdownId, returnFocusToTrigger]);

  const open = useCallback(() => {
    Keyboard.dismiss();
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
    });
    onOpen?.();
    if (context) context.requestOpen(dropdownId);
    else setLocalOpen(true);
  }, [context, dropdownId, onOpen]);

  const toggle = useCallback(() => {
    if (isOpen) close();
    else open();
  }, [isOpen, open, close]);

  const selected = options.find((option) => option.value === value);
  const screenWidth = Dimensions.get("window").width;
  const menuWidth = Math.min(
    Math.max(anchor?.width ?? 0, 220),
    screenWidth - SCREEN_MARGIN * 2,
  );
  const left = anchor
    ? Math.min(Math.max(anchor.x, SCREEN_MARGIN), screenWidth - menuWidth - SCREEN_MARGIN)
    : SCREEN_MARGIN;
  const top = anchor ? anchor.y + anchor.height + 6 : 0;

  return (
    <View style={style}>
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

      {isOpen ? (
        <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
          {/*
            The scrim is a plain full-screen Pressable, never a wrapper around
            the menu. Tapping it only closes -- it never touches `value` -- and
            it is hidden from the accessibility tree so a screen reader lands
            on the menu below, not on an unlabeled full-screen surface.
          */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID={testID ? `${testID}-scrim` : `dropdown-scrim-${dropdownId}`}
          />
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
                      close();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={option.accessibilityLabel ?? option.label}
                    accessibilityState={{ selected: isSelected }}
                    style={[styles.option, isSelected && styles.optionActive]}
                  >
                    <View style={styles.optionCopy}>
                      {option.icon ? <Text style={styles.triggerIcon}>{option.icon}</Text> : null}
                      <View style={styles.optionTextGroup}>
                        <Text
                          style={[styles.optionLabel, isSelected && styles.optionLabelActive]}
                        >
                          {option.label}
                        </Text>
                        {option.detail ? (
                          <Text style={styles.optionDetail}>{option.detail}</Text>
                        ) : null}
                      </View>
                    </View>
                    {isSelected ? <Check size={16} color={colors.accent} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
