/**
 * Ambient typing for the `window.desktop` bridge exposed by the Electron preload
 * (apps/desktop/src/preload.ts). Present only in the desktop build; on the web
 * `window.desktop` is undefined, which the setup store/guards check for.
 */

export interface DesktopDbConfig {
  host: string;
  port: number;
  database: string;
  adminUser: string;
  adminPassword: string;
}

export interface DesktopOwnerInput {
  username: string;
  pin: string;
  fullName?: string;
}

export interface DesktopTestResult {
  ok: boolean;
  message: string;
  serverVersion?: string;
}

export type DesktopStepId = 'test' | 'createdb' | 'migrate' | 'owner' | 'finalize';
export type DesktopStepStatus = 'pending' | 'loading' | 'success' | 'error';

export interface DesktopProgress {
  step: DesktopStepId;
  status: DesktopStepStatus;
  message?: string;
}

export interface DesktopInitRequest {
  db: DesktopDbConfig;
  owner: DesktopOwnerInput;
}

export interface DesktopInitResult {
  ok: boolean;
  error?: string;
  failedStep?: DesktopStepId;
}

export interface DesktopCompleteResult {
  ok: boolean;
  appUrl?: string;
  error?: string;
}

export interface DesktopExportResult {
  ok: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

export interface DesktopSetupState {
  isDesktop: true;
  setupComplete: boolean;
  appVersion: string;
  platform: string;
  defaultDb: {
    host: string;
    port: number;
    database: string;
    adminUser: string;
  };
}

export interface DesktopCredentials {
  appName: string;
  username: string;
  pin: string;
  createdAt: string;
}

export interface DesktopApi {
  isDesktop: true;
  getState(): Promise<DesktopSetupState>;
  setup: {
    testConnection(db: DesktopDbConfig): Promise<DesktopTestResult>;
    initialize(req: DesktopInitRequest): Promise<DesktopInitResult>;
    complete(): Promise<DesktopCompleteResult>;
    reset(): Promise<{ ok: boolean }>;
    onProgress(cb: (event: DesktopProgress) => void): () => void;
  };
  exportTxt(cred: DesktopCredentials): Promise<DesktopExportResult>;
  exportPdf(cred: DesktopCredentials): Promise<DesktopExportResult>;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export {};
