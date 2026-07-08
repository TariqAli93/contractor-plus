/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

// Injected by Vite `define` (see vite.config.ts). 'server' = full local backend
// desktop build; 'client' = frontend-only build pointing at a remote instance.
declare const __CONTRACTOR_APP_MODE__: 'server' | 'client';

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
