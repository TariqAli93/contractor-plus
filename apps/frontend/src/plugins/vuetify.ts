import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import { createVuetify } from 'vuetify';
import { aliases, mdi } from 'vuetify/iconsets/mdi';
import { ar } from 'vuetify/locale';

// Theme names referenced by the theme store.
export const LIGHT_THEME = 'contractorPlus';
export const DARK_THEME = 'contractorPlusDark';

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
    defaultTheme: LIGHT_THEME,
    themes: {
      [LIGHT_THEME]: {
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
      // Clean dark theme — slate surfaces (no pure black), lightened brand
      // colors for readable contrast on dark backgrounds.
      [DARK_THEME]: {
        dark: true,
        colors: {
          primary: '#4F9BD0',
          secondary: '#94A3B8',
          accent: '#F59E0B',
          success: '#22C55E',
          warning: '#FBBF24',
          error: '#F87171',
          info: '#38BDF8',
          background: '#0F172A',
          surface: '#1E293B',
        },
      },
    },
  },
  locale: {
    // Arabic-only app. Register Vuetify's official Arabic locale so internal
    // strings like "$vuetify.input.clear" render in Arabic, and force RTL.
    locale: 'ar',
    fallback: 'ar',
    messages: { ar },
    rtl: { ar: true },
  },
});
