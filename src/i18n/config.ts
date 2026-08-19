import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { LOCALE_STORAGE_KEY, readStoredLocale, type SupportedLocale } from '@/i18n/constants';
import { suppressUnhandledRejection } from '@/lib/suppressUnhandledRejection';

import commonEn from '@/locales/en/common.json';
import commonDe from '@/locales/de/common.json';
import settingsEn from '@/locales/en/settings.json';
import settingsDe from '@/locales/de/settings.json';
import macrosEn from '@/locales/en/macros.json';
import macrosDe from '@/locales/de/macros.json';
import toolsEn from '@/locales/en/tools.json';
import toolsDe from '@/locales/de/tools.json';
import programEn from '@/locales/en/program.json';
import programDe from '@/locales/de/program.json';
import hooksEn from '@/locales/en/hooks.json';
import hooksDe from '@/locales/de/hooks.json';
import componentsEn from '@/locales/en/components.json';
import componentsDe from '@/locales/de/components.json';

const initialLng: SupportedLocale = readStoredLocale() ?? 'en';

function persistAppLocale(lng: SupportedLocale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, lng);
  } catch {
    /* ignore quota / private mode */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng;
  }
}

export const i18nReady = i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: commonEn,
      settings: settingsEn,
      macros: macrosEn,
      tools: toolsEn,
      program: programEn,
      hooks: hooksEn,
      components: componentsEn,
    },
    de: {
      common: commonDe,
      settings: settingsDe,
      macros: macrosDe,
      tools: toolsDe,
      program: programDe,
      hooks: hooksDe,
      components: componentsDe,
    },
  },
  lng: initialLng,
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common', 'settings', 'macros', 'tools', 'program', 'hooks', 'components'],
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

suppressUnhandledRejection(i18nReady, 'i18n init failed');

export function setAppLocale(lng: SupportedLocale): void {
  i18n
    .changeLanguage(lng)
    .then(() => {
      persistAppLocale(lng);
    })
    .catch((error: unknown) => {
      console.error('i18n language change failed', error);
    });
}

if (typeof document !== 'undefined') {
  document.documentElement.lang = initialLng;
}

export default i18n;
