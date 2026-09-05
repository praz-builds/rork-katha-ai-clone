// https://docs.expo.dev/guides/using-eslint/
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: ['node_modules/', 'dist/', '.expo/'],
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
