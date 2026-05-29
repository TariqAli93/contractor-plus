import { createI18n } from 'vue-i18n';
import ar from '@/i18n/locales/ar.json';
import en from '@/i18n/locales/en.json';

const defaultLocale =
  (globalThis.localStorage?.getItem('contractor-plus.locale') as 'ar' | 'en' | null) ??
  (import.meta.env.VITE_DEFAULT_LOCALE as 'ar' | 'en') ??
  'ar';

export const i18n = createI18n({
  legacy: false,
  locale: defaultLocale,
  fallbackLocale: 'en',
  messages: { ar, en },
});

export function setI18nLocale(locale: 'ar' | 'en') {
  i18n.global.locale.value = locale;
}
