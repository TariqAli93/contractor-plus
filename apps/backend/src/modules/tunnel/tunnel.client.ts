import { env } from '../../config/env.js';
import type { ManagementEnableResponse } from './tunnel.types.js';

// Thin client for codel-management-api. No auth header — the management
// server identifies this machine by `machine_id` in the body and is the
// authoritative owner of Cloudflare credentials.

export class ManagementApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ManagementApiError';
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const url = `${env.MANAGEMENT_API_URL.replace(/\/+$/, '')}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.MANAGEMENT_API_TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'network';
    throw new ManagementApiError(`management API POST ${path} failed (${reason})`);
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const obj = (parsed ?? {}) as { error?: string; message?: string };
    const detail = obj.error ?? obj.message ?? `${res.status} ${res.statusText}`;
    throw new ManagementApiError(
      `management API POST ${path} failed: ${detail}`,
      res.status,
      parsed ?? text,
    );
  }

  return parsed as T;
}

export const managementApi = {
  enable(machineId: string, localServiceUrl: string): Promise<ManagementEnableResponse> {
    return postJson<ManagementEnableResponse>('/api/tunnel/enable', {
      machine_id: machineId,
      local_service_url: localServiceUrl,
    });
  },

  disable(machineId: string): Promise<unknown> {
    return postJson<unknown>('/api/tunnel/disable', { machine_id: machineId });
  },
};
