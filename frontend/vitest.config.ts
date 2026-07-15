import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// Vue SFCs are transformed so component specs can mount real components; plain
// unit tests over modules (router config, stores, pure helpers) are unaffected
// since the transform only touches `.vue` files. Vuetify components must be
// registered per-test (its plugin is not installed here). Mirrors
// vite.config.ts's `@` alias so `@/…` imports resolve identically.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    include: ['test/**/*.spec.ts'],
    server: {
      deps: { inline: ['vuetify'] },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
