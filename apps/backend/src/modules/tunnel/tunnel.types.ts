// Wire format returned by the management API on POST /api/tunnel/enable.
// Cloudflared credentials live inside `credentials` and are written to disk
// verbatim; we never inspect their internals.
export interface ManagementEnableResponse {
  enabled: boolean;
  subdomain: string;
  tunnel_id: string;
  credentials: Record<string, unknown>;
  config?: {
    ingress?: Array<{ hostname?: string; service?: string }>;
  };
}

// Shape returned to the frontend by GET/POST tunnel endpoints. Read-only view
// over the persisted TunnelState row + runtime checks (process alive,
// cloudflared binary present).
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
  // Populated only by /disable when the management API call failed but the
  // local cloudflared process was still stopped successfully.
  warning?: string;
}
