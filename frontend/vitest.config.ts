import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Minimal Vitest config — deliberately does NOT load the Vue/Vuetify plugins, so
// unit tests over plain modules (router config, stores, pure helpers) run fast
// and without a full component runtime. It mirrors vite.config.ts's `@` alias so
// `@/…` imports resolve identically.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
