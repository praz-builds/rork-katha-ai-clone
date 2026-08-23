import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import en from './en.json';
import es from './es.json';
import pt from './pt.json';

const deviceLocale = getLocales()[0]?.languageCode ?? 'en';
const supportedLangs = ['en', 'es', 'pt'];
const fallbackLng = 'en';

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, es: { translation: es }, pt: { translation: pt } },
  lng: supportedLangs.includes(deviceLocale) ? deviceLocale : fallbackLng,
  fallbackLng,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
