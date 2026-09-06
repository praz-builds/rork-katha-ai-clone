module.exports = {
  preset: 'jest-expo',
  /**
   * 5s is not enough for these suites.
   *
   * The screen tests mount the whole onboarding tree - SafeAreaProvider,
   * fonts, Reanimated, the seed catalogue - and a cold first render of that
   * lands around 6 to 8 seconds on a laptop under load. At Jest's 5s default
   * the suites fail on a stopwatch rather than on a broken assertion, which
   * teaches the team to ignore a red run. Raised to 30s: still short enough to
   * catch a genuine hang, long enough that a slow machine is not a failure.
   */
  testTimeout: 30000,
  setupFiles: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm/[^/]+/node_modules/)?(((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|posthog-react-native|react-native-svg|lucide-react-native))',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // See src/__mocks__/expo-fetch.ts: the real module needs the native runtime.
    '^expo/fetch$': '<rootDir>/src/__mocks__/expo-fetch.ts',
  },
};
