// ============================================================
// OpenRouter model discovery — the SAFE, backend-only bridge to the catalog.
//
// The frontend NEVER calls OpenRouter directly. This service fetches the model
// catalog from OpenRouter's public GET /models, projects each entry to a small
// UI-safe DTO, caches it (in-memory + a durable last-good snapshot in
// system_settings), and serves the cache when OpenRouter is temporarily
// unavailable. Capability filtering (modality / tool-calling / context / price /
// free) is applied on the projected DTOs.
//
// The API key is optional here (the catalog is public) but is sent when present
// to lift OpenRouter's per-IP rate limits — it is never returned to the client.
// ============================================================

import type { PrismaClient } from '@prisma/client';
import type { OpenRouterModel, OpenRouterModelFilter, OpenRouterModelsResult } from '@contractor-plus/shared';
import { logger } from '../logger.js';
import { LLMError } from './llm-client.js';
import { OPENROUTER_PROVIDER, resolveBaseUrl, type StructuredOutputMode } from './llm.config.js';

const CACHE_KEY = 'ai.modelsCacheV1';
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour — the catalog changes slowly.
const FETCH_TIMEOUT_MS = 12000;

/** The raw OpenRouter /models entry (only the fields we consume). */
interface RawOpenRouterModel {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number | null;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    modality?: string;
  };
  top_provider?: { context_length?: number | null };
  pricing?: Record<string, string | undefined>;
  supported_parameters?: string[];
}

type FetchFn = typeof fetch;

interface CacheSnapshot {
  fetchedAt: string;
  models: OpenRouterModel[];
}

// Process-wide in-memory cache (shared across requests within a process).
let memoryCache: CacheSnapshot | null = null;

export class OpenRouterModelsService {
  private readonly fetchImpl: FetchFn;
  private readonly ttlMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    opts: { fetchImpl?: FetchFn; ttlMs?: number } = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  }

  /** Best-effort, CACHE-ONLY structured-output capability for a model id (memory
   *  snapshot → durable DB snapshot; never a live fetch, so it is safe on the
   *  per-turn hot path). Returns null when the catalog was never fetched or the
   *  model is absent — callers then fall back to `auto` (client-side detection). */
  async peekStructuredOutputMode(modelId: string): Promise<StructuredOutputMode | null> {
    const snapshot = memoryCache ?? (await this.readPersisted());
    const model = snapshot?.models.find((m) => m.id === modelId);
    if (!model) return null;
    return structuredOutputModeFor(model.supportedParameters);
  }

  /** List models (from cache when fresh, else refetch), filtered by capability. */
  async list(filter: OpenRouterModelFilter = {}, apiKey?: string | null): Promise<OpenRouterModelsResult> {
    const { snapshot, stale } = await this.load(apiKey ?? null);
    const models = snapshot ? applyFilter(snapshot.models, filter) : [];
    return { models, stale, fetchedAt: snapshot?.fetchedAt ?? null };
  }

  /** Resolve a snapshot: fresh memory → live fetch → stale memory → DB snapshot. */
  private async load(apiKey: string | null): Promise<{ snapshot: CacheSnapshot | null; stale: boolean }> {
    if (memoryCache && Date.now() - Date.parse(memoryCache.fetchedAt) < this.ttlMs) {
      return { snapshot: memoryCache, stale: false };
    }

    try {
      const models = await this.fetchLive(apiKey);
      const snapshot: CacheSnapshot = { fetchedAt: new Date().toISOString(), models };
      memoryCache = snapshot;
      await this.persist(snapshot);
      return { snapshot, stale: false };
    } catch (err) {
      const code = err instanceof LLMError ? err.code : 'network_error';
      logger.warn({ code }, '[ai-models] live fetch failed — falling back to cache');
      const fallback = memoryCache ?? (await this.readPersisted());
      if (fallback) {
        memoryCache = fallback;
        return { snapshot: fallback, stale: true };
      }
      // No cache anywhere — surface the failure to the caller.
      throw err instanceof LLMError ? err : new LLMError(OPENROUTER_PROVIDER, null, 'network_error', false);
    }
  }

  private async fetchLive(apiKey: string | null): Promise<OpenRouterModel[]> {
    const url = `${resolveBaseUrl()}/models`;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      const code = name === 'AbortError' || name === 'TimeoutError' ? 'timeout' : 'network_error';
      throw new LLMError(OPENROUTER_PROVIDER, null, code, false);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const code = res.status === 401 || res.status === 403 ? 'invalid_api_key' : 'server_error';
      throw new LLMError(OPENROUTER_PROVIDER, res.status, code, false);
    }

    const json = (await res.json()) as { data?: RawOpenRouterModel[] };
    const data = Array.isArray(json.data) ? json.data : [];
    return data.map(mapModel).filter((m): m is OpenRouterModel => m !== null);
  }

  private async persist(snapshot: CacheSnapshot): Promise<void> {
    try {
      await this.prisma.systemSetting.upsert({
        where: { key: CACHE_KEY },
        create: { key: CACHE_KEY, value: snapshot as never },
        update: { value: snapshot as never },
      });
    } catch (err) {
      logger.warn({ err: (err as Error)?.message }, '[ai-models] failed to persist cache snapshot');
    }
  }

  private async readPersisted(): Promise<CacheSnapshot | null> {
    try {
      const row = await this.prisma.systemSetting.findUnique({ where: { key: CACHE_KEY } });
      const v = row?.value as unknown as CacheSnapshot | undefined;
      if (v && Array.isArray(v.models) && typeof v.fetchedAt === 'string') return v;
      return null;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Mapping + filtering (pure)
// ---------------------------------------------------------------------------

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Derive a model's structured-output capability from OpenRouter's
 *  `supported_parameters`. `structured_outputs` ⇒ strict JSON Schema; a bare
 *  `response_format` ⇒ json_object only; neither ⇒ prompt-only. */
export function structuredOutputModeFor(supportedParameters: string[]): StructuredOutputMode {
  if (supportedParameters.includes('structured_outputs')) return 'json_schema';
  if (supportedParameters.includes('response_format')) return 'json_object';
  return 'none';
}

export function mapModel(raw: RawOpenRouterModel): OpenRouterModel | null {
  if (!raw.id) return null;
  const pricing = raw.pricing
    ? {
        prompt: raw.pricing.prompt ?? null,
        completion: raw.pricing.completion ?? null,
        request: raw.pricing.request ?? null,
        image: raw.pricing.image ?? null,
      }
    : null;
  const promptPrice = num(pricing?.prompt ?? undefined);
  const completionPrice = num(pricing?.completion ?? undefined);
  const isFree = promptPrice === 0 && completionPrice === 0;

  return {
    id: raw.id,
    name: raw.name ?? raw.id,
    description: raw.description,
    contextLength: raw.context_length ?? raw.top_provider?.context_length ?? null,
    pricing,
    inputModalities: raw.architecture?.input_modalities ?? [],
    outputModalities: raw.architecture?.output_modalities ?? [],
    supportedParameters: raw.supported_parameters ?? [],
    isFree,
  };
}

export function applyFilter(models: OpenRouterModel[], filter: OpenRouterModelFilter): OpenRouterModel[] {
  const search = filter.search?.trim().toLowerCase();
  return models.filter((m) => {
    if (filter.input && !m.inputModalities.includes(filter.input)) return false;
    if (filter.output && !m.outputModalities.includes(filter.output)) return false;
    if (filter.tools && !m.supportedParameters.includes('tools')) return false;
    if (filter.minContext != null && (m.contextLength ?? 0) < filter.minContext) return false;
    if (filter.free && !m.isFree) return false;
    if (filter.maxPromptPrice != null) {
      const p = num(m.pricing?.prompt ?? undefined);
      if (!Number.isFinite(p) || p > filter.maxPromptPrice) return false;
    }
    if (search && !`${m.id} ${m.name}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

/** Test hook — clear the process-wide in-memory cache between test cases. */
export function __resetModelCacheForTests(): void {
  memoryCache = null;
}
