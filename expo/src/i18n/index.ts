import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import en from './en.json';
import es from './es.json';
import pt from './pt.json';

const deviceLocale = getLocales()[0]?.languageCode ?? 'en';
const supportedLangs = ['en', 'es', 'pt'];
const fallbackLng = 'en';

/**
 * English everywhere until the whole app reads these files.
 *
 * Only a handful of components use i18n today (Profile's music switch and
 * feedback sheet); every screen around them is hard-coded English. Following
 * the device locale would put two Portuguese rows between English ones on the
 * You tab, including in the build Play reviews. Flip this to `true` in the
 * release that wires the rest of the app.
 */
export const FOLLOW_DEVICE_LOCALE = false;

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es }, pt: { translation: pt } },
  lng: FOLLOW_DEVICE_LOCALE && supportedLangs.includes(deviceLocale) ? deviceLocale : fallbackLng,
  fallbackLng,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
