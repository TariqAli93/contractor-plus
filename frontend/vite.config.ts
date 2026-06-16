import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import vueDevTools from 'vite-plugin-vue-devtools';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ command }) => ({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    ...(command === 'serve' ? [vueDevTools()] : []),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Bind IPv4 loopback explicitly. Vite otherwise binds IPv6 ::1 only on
    // Windows, which makes `wait-on http://127.0.0.1:5173` (in the Electron dev
    // launch) hang forever and the desktop window never opens. strictPort fails
    // fast instead of silently moving to 5174 (which would also hang wait-on).
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      // Public asset serving lives outside /api on the backend. Without
      // this proxy `<img src="/uploads/...">` would hit Vite and 404.
      '/uploads': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
}));
