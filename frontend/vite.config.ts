import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import vueDevTools from 'vite-plugin-vue-devtools';
import { fileURLToPath, URL } from 'node:url';

// ---------------------------------------------------------------------------
// Build/run target switches (NuqtaPlus-style mode separation).
//
//   VITE_TARGET           web | electron   — how Vite builds/serves the SPA
//   CONTRACTOR_APP_MODE   server | client  — desktop runs a full local backend
//                                            (server) or connects to a remote
//                                            instance (client)
//
// NOTE ON base/outDir — this app deviates from the generic Electron pattern on
// purpose. Contractor Plus does NOT load the packaged SPA over `file://`; the
// Electron main process serves it via the custom `app://` protocol (and, once
// setup completes, via the backend service origin `http://127.0.0.1:PORT`).
// Both require ABSOLUTE (`/`) asset paths — relative (`./`) paths would break
// asset resolution on nested `app://app/<route>` URLs. The built SPA also ships
// as electron-builder `extraResources` from `dist/` (see electron-builder*.yml)
// and is resolved by runtime.frontendDist(), so the output dir stays `dist` for
// every target. We keep the target flags wired (define + plugin gating) so the
// separation is explicit and future-proof.
// ---------------------------------------------------------------------------
const target = process.env.VITE_TARGET || 'web';
const isElectronTarget = target === 'electron';
const appMode = process.env.CONTRACTOR_APP_MODE || 'server';

export default defineConfig(({ command }) => ({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    // VueDevTools only during dev/serve.
    ...(command === 'serve' ? [vueDevTools()] : []),
    // Electron-only plugins would go here, gated on isElectronTarget. This app
    // ships its Electron main/preload RAW (not bundled) and serves the SPA over
    // the app:// protocol, so it intentionally does NOT use vite-plugin-electron.
    ...(isElectronTarget ? [] : []),
  ],
  // See the note above: `/` for all targets (app:// + service origin, not file://).
  base: '/',
  define: {
    __CONTRACTOR_APP_MODE__: JSON.stringify(appMode),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Kept at `dist` for every target — electron-builder ships `dist/` as
    // extraResources and runtime.frontendDist() resolves it. See note above.
    outDir: 'dist',
    emptyOutDir: true,
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
