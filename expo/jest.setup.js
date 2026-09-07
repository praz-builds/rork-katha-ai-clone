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
