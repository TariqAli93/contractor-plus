import 'vuetify/styles';
import { h } from 'vue';
import { createVuetify, type IconProps, type IconSet } from 'vuetify';
import { aliases, mdi as mdiSvg } from 'vuetify/iconsets/mdi-svg';
import { ar } from 'vuetify/locale';
import { mdiIconPaths } from './mdi-icons';

/** The application is deliberately locked to one restrained desktop theme. */
export const APP_THEME = 'contractorPlus';

// SVG paths keep the installer small while retaining the familiar MDI command
// vocabulary used by the existing Vue components.
const SvgIcon = mdiSvg.component;
const resolveIcon = (value: IconProps['icon']): IconProps['icon'] =>
  typeof value === 'string' && value.startsWith('mdi-') ? (mdiIconPaths[value] ?? '') : value;
const mdiNamedSvg: IconSet = {
  component: (props: IconProps) => h(SvgIcon, { ...props, icon: resolveIcon(props.icon) }),
};

export const vuetify = createVuetify({
  icons: { defaultSet: 'mdi', aliases, sets: { mdi: mdiNamedSvg } },
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
    VChip: { size: 'small', rounded: 'sm' },
    VTable: { density: 'compact' },
    VCheckbox: { density: 'compact' },
    VSwitch: { density: 'compact', inset: true },
    VTabs: { density: 'compact' },
    VToolbar: { density: 'compact' },
    VDataTable: { density: 'compact' },
  },
  theme: {
    defaultTheme: APP_THEME,
    themes: {
      [APP_THEME]: {
        dark: false,
        colors: {
          primary: '#234E70',
          secondary: '#4A5568',
          accent: '#B7791F',
          success: '#2F855A',
          warning: '#B7791F',
          error: '#C53030',
          info: '#234E70',
          background: '#F3F5F7',
          surface: '#FFFFFF',
          'surface-variant': '#E9EEF3',
          'on-surface': '#1A202C',
          'on-background': '#1A202C',
          'on-primary': '#FFFFFF',
          outline: '#CBD5E0',
        },
      },
    },
  },
  locale: {
    locale: 'ar',
    fallback: 'ar',
    messages: { ar },
    rtl: { ar: true },
  },
});
