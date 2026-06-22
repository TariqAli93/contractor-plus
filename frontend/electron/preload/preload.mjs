/**
 * preload.mjs — exposes the `window.desktop` bridge the Vue app expects
 * (see frontend/src/types/desktop.d.ts). contextIsolation is on; only this
 * minimal, typed surface crosses into the renderer.
 *
 * NOTE: this file MUST keep the `.mjs` extension. Electron loads a preload
 * script as ESM purely by extension — it ignores the package's
 * `"type": "module"` — so a `.js` preload would be parsed as CommonJS and the
 * `import` below would throw. The window's webPreferences set `sandbox: false`,
 * which is what allows an ESM preload at all.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,

  getState: () => ipcRenderer.invoke('desktop:getState'),

  setup: {
    testConnection: (db) => ipcRenderer.invoke('desktop:setup:test', db),
    initialize: (req) => ipcRenderer.invoke('desktop:setup:initialize', req),
    complete: () => ipcRenderer.invoke('desktop:setup:complete'),
    reset: () => ipcRenderer.invoke('desktop:setup:reset'),
    onProgress: (cb) => {
      const listener = (_event, payload) => cb(payload);
      ipcRenderer.on('desktop:setup:progress', listener);
      return () => ipcRenderer.removeListener('desktop:setup:progress', listener);
    },
  },

  exportTxt: (cred) => ipcRenderer.invoke('desktop:exportTxt', cred),
  exportPdf: (cred) => ipcRenderer.invoke('desktop:exportPdf', cred),
});
