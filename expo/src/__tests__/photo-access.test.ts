/**
 * Picking a photo on Android must not depend on a storage permission the
 * manifest no longer declares.
 *
 * `app.json` blocks READ/WRITE_EXTERNAL_STORAGE. Below Android 13,
 * `requestMediaLibraryPermissionsAsync` asks for exactly those, so after the
 * block it is refused every time -- and the avatar and character-reference
 * pickers both asked it first, which would have ended every photo pick on
 * Android 12 and below at "permission". The system photo picker itself needs
 * no permission, so Android goes straight to it.
 */

/* eslint-disable import/first */
const mockRequestPermission = jest.fn();
const mockLaunchLibrary = jest.fn();

jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn().mockResolvedValue({ userId: "u1" }) }));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { functions: { invoke: jest.fn() } },
}));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: () => mockRequestPermission(),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchLibrary(...args),
}));
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: "jpeg" },
}));

import { Platform } from "react-native";
import { ensurePhotoLibraryAccess } from "@/lib/photo-access";
import { pickAndUploadAvatar } from "@/lib/profile";

const originalOS = Platform.OS;

function setOS(os: typeof Platform.OS) {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true, writable: true });
}

beforeEach(() => {
  mockRequestPermission.mockReset();
  mockLaunchLibrary.mockReset();
  // What a blocked READ_EXTERNAL_STORAGE answers on Android 12 and below.
  mockRequestPermission.mockResolvedValue({ granted: false, status: "denied" });
  mockLaunchLibrary.mockResolvedValue({ canceled: true, assets: null });
});

afterEach(() => setOS(originalOS));

describe("on Android", () => {
  beforeEach(() => setOS("android"));

  it("opens the photo picker without asking for storage access", async () => {
    await expect(ensurePhotoLibraryAccess()).resolves.toBe(true);
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it("reaches the picker from the avatar flow even though storage access is refused", async () => {
    const result = await pickAndUploadAvatar();
    expect(mockLaunchLibrary).toHaveBeenCalledTimes(1);
    // The person closed the picker; nobody was told they lack permission.
    expect(result).toEqual({ ok: false, reason: "cancelled" });
  });
});

describe("on iOS", () => {
  beforeEach(() => setOS("ios"));

  it("still asks, and a refusal still stops before the picker", async () => {
    await expect(ensurePhotoLibraryAccess()).resolves.toBe(false);
    const result = await pickAndUploadAvatar();
    expect(result).toEqual({ ok: false, reason: "permission" });
    expect(mockLaunchLibrary).not.toHaveBeenCalled();
  });
});
