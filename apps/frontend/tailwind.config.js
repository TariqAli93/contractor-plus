/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts,tsx}'],
  // Vuetify owns the design system; tailwind is for layout glue.
  // We disable preflight to avoid clobbering Vuetify's base styles.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans Arabic"', '"Inter"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [require('tailwindcss-rtl')],
};
