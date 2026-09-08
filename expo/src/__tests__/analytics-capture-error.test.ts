/**
 * `captureError` once Sentry actually has a DSN.
 *
 * A separate file from `analytics.test.ts` on purpose: Jest gives each test
 * file its own module registry, and `analytics.test.ts` mocks
 * `expo-constants` with an empty DSN to prove the no-op path against exactly
 * today's production config. Proving the *reporting* path needs the opposite
 * fixture, so it needs its own file rather than a `jest.resetModules()`
 * dance inside the same one.
 */
import * as Sentry from '@sentry/react-native';
import { initSentry, captureError } from '@/lib/analytics';

// Jest hoists `jest.mock()` calls above these imports regardless of where
// they are written in the file, so writing the real imports first (unlike
// `analytics.test.ts`, which needed `eslint-disable import/first` for the
// opposite ordering) keeps this file lint-clean without changing behavior.
jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  setUser: jest.fn(),
  captureMessage: jest.fn(),
}));

jest.mock('posthog-react-native', () => {
  return jest.fn().mockImplementation(() => ({
    capture: jest.fn(),
    identify: jest.fn(),
    reset: jest.fn(),
  }));
});

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { sentryDsn: 'https://fakekey@sentry.katha.test/1234' } },
}));

describe('captureError with a configured DSN', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    initSentry();
  });

  it('sends a message with the mapped severity level and allowlisted-shaped tags', () => {
    captureError({
      bucket: 'generation.audio',
      severity: 'high',
      errorCode: 'playback_failed',
      error: new Error('full provider payload that must never persist'),
      context: { story_id: 'story-1', chapter_id: 'chapter-1', voice_gender: 'female' },
    });

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const [message, options] = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(message).toBe('playback_failed');
    expect(options.level).toBe('error');
    expect(options.tags).toEqual({
      bucket: 'generation.audio',
      severity: 'high',
      error_code: 'playback_failed',
    });
    expect(options.extra).toEqual({
      story_id: 'story-1',
      chapter_id: 'chapter-1',
      voice_gender: 'female',
    });
  });

  it('never sends the original error message, only the safe bounded one', () => {
    const secret = 'this is a users story idea and must not leave the device';
    captureError({ bucket: 'generation.audio', error: new Error(secret) });

    const [message] = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(message).toBe('Error');
    expect(JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls[0])).not.toContain(
      secret,
    );
  });

  it('defaults to medium/warning severity when none is given', () => {
    captureError({ bucket: 'generation.audio', error: new Error('boom') });
    const [, options] = (Sentry.captureMessage as jest.Mock).mock.calls[0];
    expect(options.level).toBe('warning');
    expect(options.tags.severity).toBe('medium');
  });

  it('never throws even if Sentry.captureMessage itself throws', () => {
    (Sentry.captureMessage as jest.Mock).mockImplementation(() => {
      throw new Error('sentry SDK internal failure');
    });
    expect(() =>
      captureError({ bucket: 'generation.audio', error: new Error('boom') }),
    ).not.toThrow();
  });
});
