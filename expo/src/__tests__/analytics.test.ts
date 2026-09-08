/* eslint-disable import/first */
// Mocks must be declared before imports for Jest hoisting
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
  expoConfig: { extra: {} },
}));

import * as Sentry from '@sentry/react-native';
import {
  initSentry,
  initPostHog,
  trackEvent,
  identifyUser,
  resetAnalytics,
  captureError,
} from '@/lib/analytics';

describe('analytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initSentry', () => {
    it('does not call Sentry.init when DSN is missing', () => {
      initSentry();
      expect(Sentry.init).not.toHaveBeenCalled();
    });
  });

  describe('initPostHog', () => {
    it('initializes without throwing', () => {
      expect(() => initPostHog()).not.toThrow();
    });
  });

  describe('trackEvent', () => {
    it('does not throw before PostHog init', () => {
      expect(() => trackEvent('test_event', { key: 'value' })).not.toThrow();
    });
  });

  describe('identifyUser', () => {
    it('sets Sentry user', () => {
      identifyUser('user-123', { plan: 'free' });
      expect(Sentry.setUser).toHaveBeenCalledWith({ id: 'user-123' });
    });
  });

  describe('resetAnalytics', () => {
    it('clears Sentry user', () => {
      resetAnalytics();
      expect(Sentry.setUser).toHaveBeenCalledWith(null);
    });
  });

  describe('captureError', () => {
    // This file's `expo-constants` mock never supplies a DSN, so `initSentry`
    // never actually configures the SDK -- exactly today's production state
    // (`app.json`'s `sentryDsn` is `""`). `captureError` must stay a no-op
    // under that condition even after `initSentry()` runs.
    it('is a no-op when Sentry was never initialised', () => {
      initSentry();
      expect(() =>
        captureError({
          bucket: 'generation.audio',
          severity: 'medium',
          error: new Error('boom'),
        }),
      ).not.toThrow();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('never throws even without calling initSentry first', () => {
      expect(() =>
        captureError({ bucket: 'generation.audio', error: new Error('boom') }),
      ).not.toThrow();
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
    });
  });
});
