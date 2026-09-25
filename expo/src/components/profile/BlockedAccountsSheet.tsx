import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ban, X } from "lucide-react-native";

import { Button } from "@/components/Button";
import {
  fetchBlockedAccounts,
  unblockAuthorEverywhere,
  type BlockedAccount,
} from "@/lib/blocks";
import { colors, fonts, radius, spacing, type } from "@/theme";

type LoadState = "loading" | "ready" | "error";

/**
 * Profile > Blocked accounts: everyone this reader has blocked, and the way
 * back.
 *
 * A block made from a story's ⋮ sheet or a comment's menu promises the undo
 * is here, so this list is what makes blocking safe to offer at all: a block
 * with no way back is a trap for the person who pressed it by mistake.
 *
 * Unblocking takes effect at once in this session (`lib/blocks.ts`), and the
 * server stops filtering the moment the row is deleted.
 */
export default function BlockedAccountsSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<LoadState>("loading");
  const [accounts, setAccounts] = useState<BlockedAccount[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);

  // Reopening the sheet, or Retry, while a load is still in flight starts a
  // second one; only the newest may write, or an older answer lands last.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setState("loading");
    const result = await fetchBlockedAccounts();
    if (seq !== loadSeq.current) return;
    if (result.ok) {
      setAccounts(result.accounts);
      setState("ready");
    } else {
      setState("error");
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setBusyId(null);
    setFailedId(null);
    void load();
  }, [visible, load]);

  const unblock = async (account: BlockedAccount) => {
    setBusyId(account.id);
    setFailedId(null);
    try {
      await unblockAuthorEverywhere(account.id);
      setAccounts((current) => current.filter((row) => row.id !== account.id));
    } catch {
      setFailedId(account.id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
        <View style={styles.sheet} testID="blocked-accounts-sheet">
          <View style={styles.header}>
            <Text style={styles.title}>Blocked accounts</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.close}
            >
              <X size={18} color={colors.strong} />
            </Pressable>
          </View>
          <Text style={styles.sub}>
            You don&apos;t see stories or comments from anyone on this list.
          </Text>

          {state === "loading" ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : state === "error" ? (
            <View style={styles.center} testID="blocked-accounts-error">
              <Text style={styles.message}>
                Your blocked accounts could not be loaded.
              </Text>
              <Button
                label="Try again"
                variant="secondary"
                size="sm"
                fullWidth={false}
                onPress={() => void load()}
              />
            </View>
          ) : accounts.length === 0 ? (
            <View style={styles.center} testID="blocked-accounts-empty">
              <Ban size={26} color={colors.tertiary} />
              <Text style={styles.message}>You haven&apos;t blocked anyone.</Text>
            </View>
          ) : (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {accounts.map((account) => (
                <View key={account.id} style={styles.row} testID={`blocked-${account.id}`}>
                  <View style={styles.avatar}>
                    {account.avatarUrl ? (
                      <Image
                        source={{ uri: account.avatarUrl }}
                        style={styles.avatarImage}
                        accessibilityIgnoresInvertColors
                      />
                    ) : (
                      <Text style={styles.avatarInitial}>
                        {account.name.charAt(0).toUpperCase()}
                      </Text>
                    )}
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {account.name === "Reader" ? account.name : `@${account.name}`}
                    </Text>
                    {failedId === account.id ? (
                      <Text style={styles.error}>That did not save. Try again.</Text>
                    ) : null}
                  </View>
                  <Button
                    label="Unblock"
                    variant="secondary"
                    size="sm"
                    fullWidth={false}
                    loading={busyId === account.id}
                    disabled={busyId !== null && busyId !== account.id}
                    onPress={() => void unblock(account)}
                    accessibilityLabel={`Unblock ${account.name}`}
                    testID={`unblock-${account.id}`}
                  />
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const AVATAR = 40;

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.scrimStrong,
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.related,
    maxHeight: "80%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    // The 20pt step of the ramp, in the UI face like the other sheet titles.
    ...type.titleSmall,
    fontFamily: fonts.ui,
    fontWeight: "700",
    color: colors.ink,
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  sub: { fontFamily: fonts.ui, color: colors.muted, fontSize: 14, lineHeight: 20 },
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingVertical: spacing.xxl,
  },
  message: {
    fontFamily: fonts.ui,
    color: colors.muted,
    fontSize: 15,
    textAlign: "center",
  },
  list: { flexGrow: 0 },
  listContent: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.track,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    overflow: "hidden",
    backgroundColor: colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: { width: AVATAR, height: AVATAR },
  avatarInitial: {
    fontFamily: fonts.ui,
    fontWeight: "700",
    color: colors.ink,
    fontSize: 16,
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  name: {
    fontFamily: fonts.ui,
    fontWeight: "700",
    color: colors.ink,
    fontSize: 15,
  },
  error: {
    fontFamily: fonts.ui,
    color: colors.accentPressed,
    fontSize: 13,
  },
});
