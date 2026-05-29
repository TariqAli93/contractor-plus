import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import { createVuetify } from 'vuetify';
import { aliases, mdi } from 'vuetify/iconsets/mdi';
import { ar, en } from 'vuetify/locale';

const defaultLocale =
  (globalThis.localStorage?.getItem('contractor-plus.locale') as 'ar' | 'en' | null) ?? 'ar';

export const vuetify = createVuetify({
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  defaults: {
    VBtn: { variant: 'flat' },
    VTextField: { variant: 'outlined', density: 'comfortable' },
    VSelect: { variant: 'outlined', density: 'comfortable' },
    VAutocomplete: { variant: 'outlined', density: 'comfortable' },
    VCard: { rounded: 'lg' },
  },
  theme: {
    defaultTheme: 'contractorPlus',
    themes: {
      contractorPlus: {
        dark: false,
        colors: {
          primary: '#1E5F8C',
          secondary: '#37474F',
          accent: '#D97706',
          success: '#16A34A',
          warning: '#F59E0B',
          error: '#DC2626',
          info: '#0284C7',
          background: '#F8FAFC',
          surface: '#FFFFFF',
        },
      },
    },
  },
  locale: {
    // Register Vuetify's official locale messages so internal strings like
    // "$vuetify.input.clear" resolve in Arabic. English stays as the fallback
    // for any keys an upstream component adds before they reach the AR bundle.
    locale: defaultLocale,
    fallback: 'en',
    messages: { ar, en },
    rtl: { ar: true, en: false },
  },
});

export function setVuetifyLocale(locale: 'ar' | 'en') {
  vuetify.locale.current.value = locale;
}
