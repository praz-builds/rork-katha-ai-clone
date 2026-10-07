/**
 * The remote update switch (2026-10-07): version maths, the offline rules, and
 * the two screens it can put up.
 */
import React from "react";
import { BackHandler, Linking } from "react-native";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

jest.mock("@/lib/supabase", () => ({ supabase: {} }));
jest.mock("expo-application", () => ({ nativeApplicationVersion: "1.0.1" }));

/* eslint-disable import/first */
import {
  compareVersions,
  evaluateUpdate,
  loadAppVersionConfig,
  marketUrl,
  statusFrom,
} from "@/lib/app-version";
import { UpdateGate } from "@/components/UpdateGate";
/* eslint-enable import/first */

const row = (min: string, latest: string) => ({
  minimum_supported_version: min,
  latest_version: latest,
  store_url: "https://play.google.com/store/apps/details?id=ai.katha.createstories",
});
const config = (min: string, latest: string) => ({
  minimumSupportedVersion: min,
  latestVersion: latest,
  storeUrl: "https://play.google.com/store/apps/details?id=ai.katha.createstories",
});

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("comparing versions", () => {
  it("compares numerically, never as strings", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0", "1.99.99")).toBe(1);
  });

  it("treats missing segments as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.0.1", "1.0")).toBe(1);
  });
});

describe("deciding", () => {
  it.each([
    ["1.0.0", "1.2.0", "1.4.0", "required"],
    ["1.2.0", "1.2.0", "1.4.0", "recommended"],
    ["1.3.9", "1.2.0", "1.4.0", "recommended"],
    ["1.4.0", "1.2.0", "1.4.0", "ok"],
    ["1.10.0", "1.9.0", "1.9.0", "ok"],
  ])("installed %s, minimum %s, latest %s -> %s", (installed, min, latest, expected) => {
    expect(evaluateUpdate(config(min, latest), installed)).toBe(expected);
  });

  it("does nothing with no config or no installed version", () => {
    expect(evaluateUpdate(null, "1.0.0")).toBe("ok");
    expect(evaluateUpdate(config("9.0.0", "9.0.0"), null)).toBe("ok");
  });
});

describe("loading the config", () => {
  it("uses and caches a fresh answer", async () => {
    const loaded = await loadAppVersionConfig("android", async () => row("1.2.0", "1.4.0"));
    expect(loaded).toEqual({ config: config("1.2.0", "1.4.0"), fresh: true });
  });

  it("offline with nothing cached: the app runs", async () => {
    const loaded = await loadAppVersionConfig("android", async () => {
      throw new Error("offline");
    });
    expect(statusFrom(loaded, "1.0.0")).toBe("ok");
  });

  it("offline with a cached minimum above this build: still blocked", async () => {
    await loadAppVersionConfig("android", async () => row("2.0.0", "2.0.0"));
    const offline = await loadAppVersionConfig("android", async () => {
      throw new Error("offline");
    });
    expect(offline.fresh).toBe(false);
    expect(statusFrom(offline, "1.0.1")).toBe("required");
  });

  it("offline, a cached config only blocks; it never nags", async () => {
    await loadAppVersionConfig("android", async () => row("1.0.0", "2.0.0"));
    const offline = await loadAppVersionConfig("android", async () => {
      throw new Error("offline");
    });
    expect(statusFrom(offline, "1.0.1")).toBe("ok");
  });

  it("gives up on a hung request instead of spinning", async () => {
    const loaded = await loadAppVersionConfig(
      "android",
      () => new Promise(() => undefined),
      20,
    );
    expect(loaded).toEqual({ config: null, fresh: false });
  });

  it("refuses a malformed row", async () => {
    const loaded = await loadAppVersionConfig("android", async () => ({ minimum_supported_version: 3 }));
    expect(loaded.config).toBeNull();
  });
});

describe("the gate", () => {
  let openURL: jest.SpyInstance;
  beforeEach(() => {
    openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  });
  afterEach(() => openURL.mockRestore());

  it("blocks a build below the minimum, with no way past but the store", async () => {
    const back = jest.spyOn(BackHandler, "addEventListener");
    const view = await render(
      <UpdateGate enabled installedVersion="1.0.1" fetchRow={async () => row("1.2.0", "1.4.0")} />,
    );
    await waitFor(() => expect(view.getByTestId("update-required")).toBeTruthy());
    expect(view.getByText("Update required")).toBeTruthy();
    expect(view.queryByText("Not now")).toBeNull();
    // Android Back is consumed while it shows.
    const handler = back.mock.calls.at(-1)?.[1] as () => boolean;
    expect(handler()).toBe(true);
    await fireEvent.press(view.getByTestId("update-now"));
    expect(openURL).toHaveBeenCalledWith(
      "https://play.google.com/store/apps/details?id=ai.katha.createstories",
    );
    back.mockRestore();
  });

  it("falls back to Play's app link, and says so when nothing opens", async () => {
    openURL.mockRejectedValue(new Error("no handler"));
    const view = await render(
      <UpdateGate enabled installedVersion="1.0.1" fetchRow={async () => row("1.2.0", "1.4.0")} />,
    );
    await waitFor(() => expect(view.getByTestId("update-required")).toBeTruthy());
    await fireEvent.press(view.getByTestId("update-now"));
    await waitFor(() => expect(view.getByText(/Couldn't open the store/)).toBeTruthy());
    expect(openURL).toHaveBeenCalledWith("market://details?id=ai.katha.createstories");
  });

  it("offers a newer version, and remembers when it is dismissed", async () => {
    const view = await render(
      <UpdateGate enabled installedVersion="1.2.0" fetchRow={async () => row("1.0.0", "1.4.0")} />,
    );
    await waitFor(() => expect(view.getByTestId("update-recommended")).toBeTruthy());
    await fireEvent.press(view.getByLabelText("Not now"));
    await waitFor(() => expect(view.queryByTestId("update-recommended")).toBeNull());
    const again = await render(
      <UpdateGate enabled installedVersion="1.2.0" fetchRow={async () => row("1.0.0", "1.4.0")} />,
    );
    await waitFor(() => expect(again.queryByTestId("update-recommended")).toBeNull());
  });

  it("draws nothing for a current build, or when disabled", async () => {
    const current = await render(
      <UpdateGate enabled installedVersion="1.4.0" fetchRow={async () => row("1.2.0", "1.4.0")} />,
    );
    await waitFor(() => expect(current.toJSON()).toBeNull());
    const off = await render(
      <UpdateGate enabled={false} installedVersion="1.0.0" fetchRow={async () => row("9.0.0", "9.0.0")} />,
    );
    expect(off.toJSON()).toBeNull();
  });
});

it("builds Play's app link from the listing", () => {
  expect(marketUrl("https://play.google.com/store/apps/details?id=ai.katha.createstories"))
    .toBe("market://details?id=ai.katha.createstories");
  expect(marketUrl("https://apps.apple.com/app/id123")).toBeNull();
});
