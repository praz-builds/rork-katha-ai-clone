// https://docs.expo.dev/guides/using-eslint/
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: ['node_modules/', 'dist/', '.expo/'],
  },
  {
    // `jest.setup.js` is not a test, but it runs inside the test environment
    // and legitimately calls `jest.mock`. Without this it fails `no-undef` on
    // the one global it exists to use.
    files: ['jest.setup.js'],
    languageOptions: { globals: { jest: 'readonly' } },
  },
  {
    rules: {
      // Animated.Value.interpolate triggers false positives
      'react-hooks/refs': 'off',
      // Prose text in JSX uses quotes/apostrophes naturally
      'react/no-unescaped-entities': 'warn',
    },
  },
];
