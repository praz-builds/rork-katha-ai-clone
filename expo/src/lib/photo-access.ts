/**
 * Whether the photo library may be opened, asking only where asking means
 * something.
 *
 * On Android, `launchImageLibraryAsync` opens the system photo picker
 * (`PickVisualMedia`, backported to older versions through Google Play
 * services). The picker hands back only the photo the person chose and needs
 * no permission on any Android version.
 *
 * `requestMediaLibraryPermissionsAsync` is a different thing there: below
 * Android 13 it asks for READ/WRITE_EXTERNAL_STORAGE. `app.json` blocks both
 * (the app never reads shared storage, and Play asks every app that declares
 * them to justify it), and a permission the manifest does not declare is
 * always refused. Asking first would therefore have turned every photo pick
 * on Android 12 and below into "Photo access needed", with no way to grant it.
 *
 * iOS and web still ask: iOS shows the `photosPermission` string from
 * `app.json`, and web resolves granted.
 */
import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";

export async function ensurePhotoLibraryAccess(): Promise<boolean> {
  if (Platform.OS === "android") return true;
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return permission.granted;
}
