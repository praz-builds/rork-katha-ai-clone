import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) {
    console.warn('Notifications require a physical device');
    return false;
  }

  const settings =
    (await Notifications.getPermissionsAsync()) as unknown as {
      granted: boolean;
    };
  if (settings.granted) return true;

  const result =
    (await Notifications.requestPermissionsAsync()) as unknown as {
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
    console.warn('Failed to get push token:', error);
    return null;
  }
}

export async function setupAndroidChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Katha',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
    await Notifications.setNotificationChannelAsync('stories', {
      name: 'New Stories',
      importance: Notifications.AndroidImportance.HIGH,
      description: 'Notifications when authors you follow publish',
    });
  }
}
