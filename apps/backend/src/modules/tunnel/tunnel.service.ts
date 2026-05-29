import type { PrismaClient, TunnelState } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { TunnelRepository } from './tunnel.repository.js';
import { managementApi, ManagementApiError } from './tunnel.client.js';
import { tunnelArtifactsExist, tunnelFilePaths, writeTunnelArtifacts } from './tunnel.fs.js';
import { isRunning, startCloudflared, stopCloudflared } from './tunnel.runner.js';
import { AuditService, type AuditActor } from '../audit/audit.service.js';
import { ConflictError } from '../../shared/errors/conflict.error.js';
import { toJsonValue } from '../../shared/utils/json.js';
import { env } from '../../config/env.js';
import { getOrCreateMachineId } from '../../lib/machine-id.js';
import { resolveCloudflaredPath } from '../../lib/cloudflared-path.js';
import type { TunnelStatusResponse } from './tunnel.types.js';

const TUNNEL = 'Tunnel';

// Thin remote-access agent. The management server provisions Cloudflare
// tunnels; this service drives the local cloudflared process and persists
// only the bits the UI needs to render status.
//
// Lifecycle:
//   enable:   call mgmt API → write credentials.json + config.yml → spawn
//             cloudflared → persist {enabled, subdomain, publicUrl, tunnelId}.
//   disable:  stop cloudflared → notify mgmt API (best-effort) → persist
//             {enabled: false}. A failed mgmt call is surfaced as a warning,
//             not an error — the local process is already down.
//   getStatus: reads DB + checks process aliveness. Never calls remote.
//   resume:   on boot, if state.enabled and artifacts exist, re-spawn
//             cloudflared without re-provisioning.

export class TunnelService {
  private readonly repo: TunnelRepository;
  private readonly audit: AuditService;
  private static enableInFlight: Promise<TunnelStatusResponse> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly log: FastifyBaseLogger,
  ) {
    this.repo = new TunnelRepository(prisma);
    this.audit = new AuditService(prisma);
  }

  // ---------- status ----------

  async getStatus(): Promise<TunnelStatusResponse> {
    const state = await this.repo.getOrCreate();
    return this.toResponse(state);
  }

  // ---------- enable ----------

  async enable(actor: AuditActor): Promise<TunnelStatusResponse> {
    if (TunnelService.enableInFlight) return TunnelService.enableInFlight;
    TunnelService.enableInFlight = this.enableInternal(actor).finally(() => {
      TunnelService.enableInFlight = null;
    });
    return TunnelService.enableInFlight;
  }

  private async enableInternal(actor: AuditActor): Promise<TunnelStatusResponse> {
    const state = await this.repo.getOrCreate();

    // Idempotent: if it's already enabled and the local process is alive,
    // return current status instead of re-provisioning (avoids a needless
    // management-API round-trip and a spurious 409).
    if (state.enabled && isRunning()) {
      return this.toResponse(state);
    }

    const cloudflared = resolveCloudflaredPath();
    if (cloudflared.status !== 'found') {
      const checked = cloudflared.checked.map((c) => `  - ${c.path} (${c.note})`).join('\n');
      throw new ConflictError(
        `cloudflared binary not found. Checked paths:\n${checked}`,
        'CLOUDFLARED_MISSING',
      );
    }

    const machineId = getOrCreateMachineId();
    const localServiceUrl = env.LOCAL_SERVICE_URL ?? `http://localhost:${env.PORT}`;

    this.log.info(`[tunnel] enable requested (machine=${machineId})`);

    let response;
    try {
      response = await managementApi.enable(machineId, localServiceUrl);
    } catch (err) {
      const message = this.errorMessage(err);
      await this.repo.update(state.id, { lastError: message });
      await this.audit.log(actor, {
        action: 'UPDATE',
        entity: TUNNEL,
        entityId: state.id,
        newValues: toJsonValue({ event: 'error', attemptedOperation: 'enable', error: message }),
      });
      // Distinguish a management-side conflict (HTTP 409 — e.g. the tunnel is
      // already provisioned for this machine) from a generic enable failure so
      // the UI can show a specific message. The structured message is kept.
      const code =
        err instanceof ManagementApiError && err.status === 409
          ? 'TUNNEL_MGMT_CONFLICT'
          : 'TUNNEL_ENABLE_FAILED';
      throw new ConflictError(`Tunnel enable failed: ${message}`, code);
    }

    if (!response || response.enabled !== true || !response.tunnel_id || !response.credentials) {
      const message = 'Management API response missing enabled flag, tunnel_id, or credentials';
      await this.repo.update(state.id, { lastError: message });
      throw new ConflictError(message, 'TUNNEL_ENABLE_FAILED');
    }

    const hostname = response.config?.ingress?.[0]?.hostname ?? response.subdomain;
    if (!hostname) {
      const message = 'Management API response missing hostname/subdomain';
      await this.repo.update(state.id, { lastError: message });
      throw new ConflictError(message, 'TUNNEL_ENABLE_FAILED');
    }

    try {
      writeTunnelArtifacts({
        tunnelId: response.tunnel_id,
        hostname,
        credentials: response.credentials,
      });
    } catch (err) {
      const message = `Failed to write cloudflared artifacts: ${this.errorMessage(err)}`;
      await this.repo.update(state.id, { lastError: message });
      throw new ConflictError(message, 'TUNNEL_ENABLE_FAILED');
    }

    startCloudflared(cloudflared.path, this.log);

    const updated = await this.repo.update(state.id, {
      enabled: true,
      subdomain: response.subdomain,
      publicUrl: this.buildPublicUrl(response.subdomain),
      tunnelId: response.tunnel_id,
      lastError: null,
    });

    await this.audit.log(actor, {
      action: 'UPDATE',
      entity: TUNNEL,
      entityId: state.id,
      newValues: toJsonValue({
        event: 'enabled',
        subdomain: updated.subdomain,
        tunnelId: updated.tunnelId,
      }),
    });

    return this.toResponse(updated);
  }

  // ---------- disable ----------

  async disable(actor: AuditActor): Promise<TunnelStatusResponse> {
    const state = await this.repo.getOrCreate();
    await stopCloudflared(this.log);

    const machineId = getOrCreateMachineId();
    let warning: string | undefined;
    try {
      await managementApi.disable(machineId);
    } catch (err) {
      warning = 'remote_api_disable_failed';
      this.log.warn(`[tunnel] disable API call failed: ${this.errorMessage(err)}`);
    }

    const updated = await this.repo.update(state.id, {
      enabled: false,
      lastError: warning ? this.errorMessage(warning) : null,
    });

    await this.audit.log(actor, {
      action: 'UPDATE',
      entity: TUNNEL,
      entityId: state.id,
      newValues: toJsonValue({ event: 'disabled', warning: warning ?? null }),
    });

    const response = this.toResponse(updated);
    if (warning) response.warning = warning;
    return response;
  }

  // ---------- boot-time resume ----------

  async resumeIfPreviouslyEnabled(): Promise<{ resumed: boolean; reason?: string }> {
    const state = await this.repo.getOrCreate();
    if (!state.enabled) {
      return { resumed: false, reason: 'not_enabled' };
    }
    if (!tunnelArtifactsExist()) {
      this.log.warn('[tunnel] auto-resume: config or credentials missing, skipping');
      return { resumed: false, reason: 'config_missing' };
    }
    const cloudflared = resolveCloudflaredPath();
    if (cloudflared.status !== 'found') {
      this.log.warn('[tunnel] auto-resume: cloudflared binary not found, skipping');
      return { resumed: false, reason: 'binary_missing' };
    }
    startCloudflared(cloudflared.path, this.log);
    this.log.info('[tunnel] auto-resume: spawned cloudflared');
    return { resumed: true };
  }

  async shutdown(): Promise<void> {
    await stopCloudflared(this.log);
  }

  // ---------- helpers ----------

  private toResponse(state: TunnelState): TunnelStatusResponse {
    const cloudflared = resolveCloudflaredPath();
    return {
      enabled: state.enabled,
      running: isRunning(),
      subdomain: state.subdomain,
      publicUrl: state.publicUrl,
      tunnelId: state.tunnelId,
      machineId: getOrCreateMachineId(),
      configExists: tunnelArtifactsExist(),
      cloudflaredAvailable: cloudflared.status === 'found',
      lastError: state.lastError,
      updatedAt: state.updatedAt.toISOString(),
    };
  }

  private buildPublicUrl(subdomain: string | null | undefined): string | null {
    if (!subdomain) return null;
    if (subdomain.startsWith('http://') || subdomain.startsWith('https://')) return subdomain;
    return `https://${subdomain}`;
  }

  private errorMessage(err: unknown): string {
    if (err instanceof ManagementApiError) return err.message;
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
