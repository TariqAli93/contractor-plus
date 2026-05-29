import { apiGet, apiPost } from './client';

export interface TunnelStatusResponse {
  enabled: boolean;
  running: boolean;
  subdomain: string | null;
  publicUrl: string | null;
  tunnelId: string | null;
  machineId: string;
  configExists: boolean;
  cloudflaredAvailable: boolean;
  lastError: string | null;
  updatedAt: string;
  warning?: string;
}

export const tunnelApi = {
  getStatus: (): Promise<TunnelStatusResponse> => apiGet('/tunnel/status'),
  enable: (): Promise<TunnelStatusResponse> => apiPost('/tunnel/enable'),
  disable: (): Promise<TunnelStatusResponse> => apiPost('/tunnel/disable'),
};
