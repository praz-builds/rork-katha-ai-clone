/**
 * A stand-in for `expo/fetch` under Jest.
 *
 * The real module cannot be loaded in this environment: `FetchResponse` extends
 * a class provided by the native runtime, and jest-expo has nothing to give it,
 * so importing it throws "Super expression must either be null or a function"
 * before any test body runs. Every suite that reaches `api.ts` imports it
 * transitively, so the mock is mapped globally in `jest.config.js` rather than
 * repeated per suite.
 *
 * Suites that actually exercise streaming still call `jest.mock("expo/fetch")`
 * themselves, which takes precedence over this mapping.
 */
export const fetch = jest.fn(async () => {
  throw new Error(
    "expo/fetch is not available under Jest. Mock it in the test that needs it.",
  );
});
