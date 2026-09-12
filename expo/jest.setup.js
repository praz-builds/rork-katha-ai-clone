/**
 * The AsyncStorage native module does not exist under Jest.
 *
 * Importing it throws at module load ("NativeModule: AsyncStorage is null"),
 * which means any screen that reaches it *transitively* fails to import — not
 * because the test touches storage, but because something three files down
 * does. That is how adding one `import` to `CreateStudioScreen` broke four
 * suites that never mention persistence.
 *
 * The library ships an in-memory mock for exactly this. Registering it here,
 * once, rather than in each suite keeps the failure from being re-discovered
 * every time a screen grows a new persisted concern. A suite that wants to
 * assert on the calls still declares its own `jest.mock`, which takes
 * precedence over this one.
 */
jest.mock(
  "@react-native-async-storage/async-storage",
  () =>
    require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

/**
 * RevenueCat's SDK cannot be loaded by Jest at all.
 *
 * `react-native-purchases` pulls in `@revenuecat/purchases-js-hybrid-mappings`,
 * which ships a compiled Svelte bundle that the transform chain refuses, so the
 * failure is "Test suite failed to run" with a wall of minified source and no
 * mention of the file under test. That is not a billing problem: it happens to
 * any suite that renders a screen which transitively reaches `@/lib/revenuecat`
 * — which is now every screen that quotes a price, because `@/lib/entitlements`
 * asks the SDK whether the user has a plan.
 *
 * Mocked here, once, for the same reason AsyncStorage is: so the next component
 * that grows an entitlement check does not break four unrelated suites. A suite
 * that wants to assert on purchases still declares its own `jest.mock`, which
 * takes precedence over this one.
 */
jest.mock("react-native-purchases", () => ({
  __esModule: true,
  default: {
    configure: jest.fn(),
    addCustomerInfoUpdateListener: jest.fn(),
    removeCustomerInfoUpdateListener: jest.fn(),
    getCustomerInfo: jest.fn().mockResolvedValue(null),
    getOfferings: jest.fn().mockResolvedValue(null),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
    logIn: jest.fn(),
    logOut: jest.fn(),
  },
}));

jest.mock("react-native-purchases-ui", () => ({
  __esModule: true,
  default: {
    presentPaywall: jest.fn(),
    presentPaywallIfNeeded: jest.fn(),
    presentCustomerCenter: jest.fn(),
  },
}));
