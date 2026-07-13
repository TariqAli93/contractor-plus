import { z } from 'zod';
import type { MaterialPriceSource } from '../../config/app-config.js';

// Phase 5 — the external material-price source client. Deliberately LLM-FREE:
// a source exposes a STRUCTURED JSON document, so plain fetch + strict schema
// validation is enough (the execution prompt reserves OpenRouter for
// unstructured extraction only). Any malformed source is rejected here before
// a single row is trusted.

/** Numbers may arrive as JSON numbers or numeric strings; normalise to string. */
const priceValue = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n) || n < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'price must be a number >= 0' });
    return z.NEVER;
  }
  return n.toString();
});

const priceRowSchema = z.object({
  /** Material name to match against the local catalogue (normalised in code). */
  material: z.string().trim().min(1).max(200),
  price: priceValue,
  /** ISO 4217-ish code; kept as the source gives it (rule #5: never converted). */
  currency: z.string().trim().min(1).max(10),
  /** Optional; when absent the sync stamps "now" as the source date. */
  updatedAt: z.string().trim().min(1).optional(),
});

export const materialPriceDocumentSchema = z.object({
  prices: z.array(priceRowSchema).max(5000),
});

export type MaterialPriceRow = z.infer<typeof priceRowSchema>;
export type MaterialPriceDocument = z.infer<typeof materialPriceDocumentSchema>;

export interface FetchedSource {
  source: MaterialPriceSource;
  rows: MaterialPriceRow[];
}

export type SourceFetchOutcome =
  | { ok: true; result: FetchedSource }
  | { ok: false; source: MaterialPriceSource; message: string };

export interface MaterialPriceSourceClientOptions {
  /** Injectable for unit tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Fetches + validates ONE source at a time, never throwing: a bad source
 * returns a typed failure so the sync can log it and carry on (offline
 * resilience — one dead source must not abort the whole run).
 */
export class MaterialPriceSourceClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: MaterialPriceSourceClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async fetchSource(source: MaterialPriceSource): Promise<SourceFetchOutcome> {
    let response: Response;
    try {
      response = await this.fetchImpl(source.url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      return { ok: false, source, message: reason(err, 'unreachable') };
    }

    if (!response.ok) {
      return { ok: false, source, message: `HTTP ${response.status}` };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, source, message: 'response is not valid JSON' };
    }

    const parsed = materialPriceDocumentSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, source, message: 'response does not match the price schema' };
    }

    return { ok: true, result: { source, rows: parsed.data.prices } };
  }
}

function reason(err: unknown, fallback: string): string {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return 'request timed out';
  }
  return err instanceof Error ? err.message : fallback;
}
