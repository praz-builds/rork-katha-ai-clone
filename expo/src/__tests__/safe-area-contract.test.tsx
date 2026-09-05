/**
 * Guards the safe-area contract.
 *
 * `useSafeAreaInsets` throws when no `SafeAreaProvider` is mounted above it,
 * rather than degrading to zero insets. A screen that reads insets therefore
 * renders as a blank page with no visible error, which is exactly how this
 * shipped: `WriterOnboarding` and `CreateBriefFlow` both read insets, and
 * nothing in the app mounted a provider.
 */
import React from "react";
import { render } from "@testing-library/react-native";
import { Text, View } from "react-native";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { ScreenScaffold } from "@/components/KathaPrimitives";

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function InsetReader() {
  const insets = useSafeAreaInsets();
  return <Text>{`top:${insets.top} bottom:${insets.bottom}`}</Text>;
}

describe("safe area", () => {
  it("throws without a provider, which is why the app must mount one", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(
      () => undefined,
    );
    // Not a hypothetical. This is the failure mode: no error boundary catches
    // it in a release build, and the user sees an empty screen.
    expect(() => render(<InsetReader />)).rejects.toBeDefined();
    consoleError.mockRestore();
  });

  it("resolves real insets under a provider", async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <InsetReader />
      </SafeAreaProvider>,
    );
    expect(view.getByText("top:47 bottom:34")).toBeTruthy();
  });

  it("keeps the scaffold transparent to the provider above it", async () => {
    const view = await render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ScreenScaffold>
          <View>
            <InsetReader />
          </View>
        </ScreenScaffold>
      </SafeAreaProvider>,
    );
    expect(view.getByText("top:47 bottom:34")).toBeTruthy();
  });
});
