import 'vuetify/styles';
import { h } from 'vue';
import { createVuetify, type IconProps, type IconSet } from 'vuetify';
import { aliases, mdi as mdiSvg } from 'vuetify/iconsets/mdi-svg';
import { ar } from 'vuetify/locale';
import { mdiIconPaths } from './mdi-icons';

// Theme names referenced by the theme store.
export const LIGHT_THEME = 'contractorPlus';
export const DARK_THEME = 'contractorPlusDark';

// Icons render as @mdi/js SVG paths instead of shipping the heavy MDI webfont.
// Call sites keep their kebab names (icon="mdi-cash-plus"); this set resolves
// them to SVG paths via the generated map. Vuetify's own `$`-prefixed internal
// aliases are already resolved to path strings, so they pass straight through to
// the stock mdi-svg renderer.
const SvgIcon = mdiSvg.component;
const resolveIcon = (value: IconProps['icon']): IconProps['icon'] =>
  typeof value === 'string' && value.startsWith('mdi-') ? (mdiIconPaths[value] ?? '') : value;
const mdiNamedSvg: IconSet = {
  component: (props: IconProps) => h(SvgIcon, { ...props, icon: resolveIcon(props.icon) }),
};

export const vuetify = createVuetify({
  icons: { defaultSet: 'mdi', aliases, sets: { mdi: mdiNamedSvg } },
  // Desktop-native defaults: compact density everywhere, small crisp buttons,
  // low corner radius. These cascade to every screen so the app reads as a
  // business tool (tight, functional) rather than a roomy web dashboard.
  defaults: {
    VBtn: { variant: 'flat', size: 'small', rounded: 'sm' },
    VTextField: { variant: 'outlined', density: 'compact', rounded: 'sm' },
    VSelect: { variant: 'outlined', density: 'compact', rounded: 'sm' },
    VAutocomplete: { variant: 'outlined', density: 'compact', rounded: 'sm' },
    VCombobox: { variant: 'outlined', density: 'compact', rounded: 'sm' },
    VTextarea: { variant: 'outlined', density: 'compact', rounded: 'sm' },
    VNumberInput: { variant: 'outlined', density: 'compact', rounded: 'sm' },
    VFileInput: { variant: 'outlined', density: 'compact', rounded: 'sm' },
    VCard: { rounded: 'md' },
    VList: { density: 'compact' },
    VChip: { size: 'small' },
    VTable: { density: 'compact' },
    VCheckbox: { density: 'compact' },
    VSwitch: { density: 'compact', inset: true },
    VTabs: { density: 'compact' },
    VToolbar: { density: 'compact' },
    VDataTable: { density: 'compact' },
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
