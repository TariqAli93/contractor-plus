import { createHash } from 'node:crypto';
import type { AiModelListItem } from '@contractor-plus/shared';
import { fetchOpenRouterModels } from '../../../lib/ai/openrouter-models.js';

// A short-lived in-memory cache over the live OpenRouter catalogue, so the
// panel doesn't hit OpenRouter on every render. The cache is keyed by a HASH of
// the API key (never the raw key): a key change simply misses the old entry,
// and invalidate() clears everything on key/model changes. A cached list is
// only ever reused for the SAME key.

export interface ModelsResult {
  items: AiModelListItem[];
  /** true when a refresh failed and we served the previous list for this key. */
  stale: boolean;
  /** epoch ms when the served list was fetched. */
  fetchedAt: number;
}

interface CacheEntry {
  items: AiModelListItem[];
  fetchedAt: number;
}

export interface AiModelsServiceOptions {
  baseUrl: string;
  ttlMs?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Injectable fetcher for tests (bypasses the real HTTP call). */
  fetcher?: (rawKey: string) => Promise<AiModelListItem[]>;
  /** Injectable clock for TTL tests. */
  now?: () => number;
}

const DEFAULT_TTL_MS = 10 * 60_000; // 10 minutes

export class AiModelsService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly fetcher: (rawKey: string) => Promise<AiModelListItem[]>;

  constructor(options: AiModelsServiceOptions) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? (() => Date.now());
    this.fetcher =
      options.fetcher ??
      ((rawKey) =>
        fetchOpenRouterModels(rawKey, {
          baseUrl: options.baseUrl,
          fetchImpl: options.fetchImpl,
          timeoutMs: options.timeoutMs,
        }));
  }

  /**
   * Models available to `rawKey`, cached for the TTL. `refresh` bypasses the
   * cache. On a failed refresh a still-cached list for the SAME key is served
   * as `stale` rather than surfacing an error; a cold cache re-throws.
   */
  async list(rawKey: string, opts: { refresh?: boolean } = {}): Promise<ModelsResult> {
    const hash = this.keyHash(rawKey);
    const cached = this.cache.get(hash);
    const isFresh = cached !== undefined && this.now() - cached.fetchedAt < this.ttlMs;

    if (!opts.refresh && isFresh && cached) {
      return { items: cached.items, stale: false, fetchedAt: cached.fetchedAt };
    }

    try {
      const items = await this.fetcher(rawKey);
      const entry: CacheEntry = { items, fetchedAt: this.now() };
      this.cache.set(hash, entry);
      return { items, stale: false, fetchedAt: entry.fetchedAt };
    } catch (err) {
      if (cached) return { items: cached.items, stale: true, fetchedAt: cached.fetchedAt };
      throw err;
    }
  }

  /**
   * Capabilities of one model, read from cache ONLY (no forced fetch) — a
   * best-effort signal for the tools/structured-output guard. null when the
   * model isn't in the cached list (caller should fail open).
   */
  capabilities(
    rawKey: string,
    modelId: string,
  ): { supportsTools: boolean; supportsStructuredOutput: boolean } | null {
    const cached = this.cache.get(this.keyHash(rawKey));
    const found = cached?.items.find((m) => m.id === modelId);
    if (!found) return null;
    return {
      supportsTools: found.supportsTools,
      supportsStructuredOutput: found.supportsStructuredOutput,
    };
  }

  /** Clear every cached list — called on key set/clear and model changes. */
  invalidate(): void {
    this.cache.clear();
  }

  /** Cache key is a SHA-256 of the raw key — the raw key is never the map key. */
  private keyHash(rawKey: string): string {
    return createHash('sha256').update(rawKey).digest('hex');
  }
}
