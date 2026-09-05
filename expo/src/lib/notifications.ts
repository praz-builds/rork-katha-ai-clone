import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { registerPushToken } from "@/lib/api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Android notification channels.
 *
 * They must exist before the first notification arrives or Android drops it
 * silently, with no error anywhere the app can see. `generation` is separate
 * from `stories` deliberately: a user has to be able to mute "an author you
 * follow published" without also muting "the story you paid for is ready",
 * which is the one they explicitly asked to be told about.
 */
const CHANNELS = [
  {
    id: "default",
    name: "Katha",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
  },
  {
    id: "generation",
    name: "Your stories",
    importance: Notifications.AndroidImportance.HIGH,
    description: "When a story or chapter you asked for is finished",
  },
  {
    id: "stories",
    name: "Authors you follow",
    importance: Notifications.AndroidImportance.HIGH,
    description: "When an author you follow publishes something new",
  },
] as const;

export async function setupAndroidChannel() {
  if (Platform.OS !== "android") return;
  for (const channel of CHANNELS) {
    await Notifications.setNotificationChannelAsync(channel.id, {
      name: channel.name,
      importance: channel.importance,
      vibrationPattern: "vibrationPattern" in channel
        ? [...channel.vibrationPattern]
        : undefined,
      description: "description" in channel ? channel.description : undefined,
    });
  }
}

/**
 * Triggers the OS dialog. Call it only from a screen that has already made the
 * case for it.
 *
 * iOS grants exactly one system prompt per install: once it is dismissed there
 * is no second ask, only a trip to Settings that almost nobody makes. Android
 * 13+ is the same runtime permission under `POST_NOTIFICATIONS`, and
 * `requestPermissionsAsync` covers both.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) {
    // Simulators cannot register with APNs or FCM at all, so a "denied" here is
    // a property of the environment and never of the user's choice.
    console.warn("Notifications require a physical device");
    return false;
  }

  // Channels first. A permission granted before the channel exists means the
  // first notification lands on Android with nowhere to go.
  await setupAndroidChannel();

  const settings = (await Notifications.getPermissionsAsync()) as unknown as {
    granted: boolean;
  };
  if (settings.granted) return true;

  const result = (await Notifications.requestPermissionsAsync()) as unknown as {
    granted: boolean;
  };
  return result.granted;
}

export async function getPushToken(): Promise<string | null> {
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return null;
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch (error) {
    console.warn("Failed to get push token:", error);
    return null;
  }
}

/**
 * Fetch the current token and hand it to the server.
 *
 * Safe to call on every cold start, and it should be. Expo tokens rotate on
 * reinstall, on some OS updates, and when a backup is restored onto a new
 * device; the app is the only thing that ever learns the new value. A token
 * written once goes stale invisibly, and the first symptom is a user reporting
 * they were never told their story was ready.
 *
 * Never asks for permission. A cold start is not a moment to interrupt someone,
 * and on iOS an ask spent here is an ask that cannot be spent on the screen
 * that actually earns it.
 */
export async function syncPushToken(): Promise<boolean> {
  if (!Device.isDevice) return false;
  if (Platform.OS !== "ios" && Platform.OS !== "android") return false;

  const settings = (await Notifications.getPermissionsAsync()) as unknown as {
    granted: boolean;
  };
  if (!settings.granted) return false;

  const token = await getPushToken();
  if (!token) return false;

  try {
    await registerPushToken(token, Platform.OS);
    return true;
  } catch (error) {
    // A registration that fails is retried on the next cold start. It must
    // never surface to the user, who did not ask for this and cannot act on it.
    console.warn("Failed to register push token:", error);
    return false;
  }
}

/**
 * The full grant path, for the screen that asks.
 *
 * Returns whether the user granted, not whether registration succeeded: the
 * caller advances the flow on the person's answer, and a failed registration
 * is this module's problem to retry.
 */
export async function enableNotifications(): Promise<boolean> {
  const granted = await requestNotificationPermission();
  if (granted) await syncPushToken();
  return granted;
}
