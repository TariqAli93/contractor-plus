import { z } from 'zod';
import {
  deriveModelProvider,
  isFreeModelId,
  isZeroPrice,
  type AiModelListItem,
} from '@contractor-plus/shared';
import { UpstreamError } from '../../shared/errors/upstream.error.js';
import { TimeoutError } from '../../shared/errors/timeout.error.js';

// Live OpenRouter catalogue fetch. The models available to a key come from
// GET {base}/models/user; if that path is absent on this OpenRouter version we
// fall back to the public GET {base}/models. There is NO local model list and
// NO provider filtering — every provider OpenRouter returns (OpenAI, Google,
// Anthropic, Meta, DeepSeek, Qwen, Mistral, …) is surfaced.

export interface FetchModelsOptions {
  baseUrl: string;
  timeoutMs?: number;
  /** Injectable for unit tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** Loose per-model shape — OpenRouter adds fields over time, so we passthrough. */
const priceLike = z.union([z.string(), z.number()]).optional();

const modelSchema = z
  .object({
    id: z.string().trim().min(1),
    name: z.string().optional(),
    description: z.string().optional(),
    context_length: z.number().nullable().optional(),
    // Present on time-limited (often promotional/free) models.
    expiration_date: z.union([z.string(), z.number()]).nullable().optional(),
    architecture: z
      .object({
        input_modalities: z.array(z.string()).optional(),
        output_modalities: z.array(z.string()).optional(),
        modality: z.string().optional(),
      })
      .passthrough()
      .optional(),
    pricing: z
      .object({ prompt: priceLike, completion: priceLike, request: priceLike })
      .passthrough()
      .optional(),
    top_provider: z
      .object({ context_length: z.number().nullable().optional() })
      .passthrough()
      .optional(),
    supported_parameters: z.array(z.string()).optional(),
  })
  .passthrough();

type RawModel = z.infer<typeof modelSchema>;

// The envelope IS validated strictly (must be { data: [...] }); individual
// entries are validated leniently so one malformed row never drops the list.
const envelopeSchema = z.object({ data: z.array(z.unknown()) });

/**
 * Fetch + classify the models available to `rawKey`. Throws the app error
 * family on failure (rejected key / unreachable / bad response) so callers
 * (key validation, the cache) can react. Never logs the key.
 */
export async function fetchOpenRouterModels(
  rawKey: string,
  options: FetchModelsOptions,
): Promise<AiModelListItem[]> {
  const raw = await requestModels(rawKey, options);
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new UpstreamError('OpenRouter models response was malformed', 'AI_MODELS_BAD_RESPONSE');
  }

  const now = Date.now();
  const items: AiModelListItem[] = [];
  for (const entry of envelope.data.data) {
    const parsed = modelSchema.safeParse(entry);
    if (!parsed.success) continue; // skip an unparseable row, keep the rest
    const model = parsed.data;
    if (isExpired(model.expiration_date, now)) continue;
    if (!supportsText(model)) continue;
    items.push(toModelListItem(model));
  }

  // Free first, then paid; alphabetical (by label) within each group.
  items.sort((a, b) => {
    if (a.isFree !== b.isFree) return a.isFree ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
  return items;
}

async function requestModels(rawKey: string, options: FetchModelsOptions): Promise<unknown> {
  // Prefer the key-scoped endpoint; fall back to the public catalogue only when
  // /models/user is absent (404) on this OpenRouter version.
  const primary = await getJson(`${trimBase(options.baseUrl)}/models/user`, rawKey, options);
  if (primary.status === 404) {
    const fallback = await getJson(`${trimBase(options.baseUrl)}/models`, rawKey, options);
    return unwrap(fallback);
  }
  return unwrap(primary);
}

interface JsonResponse {
  status: number;
  body: unknown;
}

async function getJson(url: string, rawKey: string, options: FetchModelsOptions): Promise<JsonResponse> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${rawKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new TimeoutError('OpenRouter models request timed out', 'UPSTREAM_TIMEOUT');
    }
    throw new UpstreamError('OpenRouter is unreachable', 'PROVIDER_DOWN');
  }
  if (response.status === 401 || response.status === 403) {
    throw new UpstreamError('OpenRouter rejected the API key', 'AI_PROVIDER_REJECTED', {
      status: response.status,
    });
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // 404 with an empty body is fine (drives the fallback); other bad bodies fail below.
    if (response.status === 404) return { status: 404, body: null };
    throw new UpstreamError('OpenRouter returned a non-JSON response', 'AI_MODELS_BAD_RESPONSE');
  }
  return { status: response.status, body };
}

function unwrap(res: JsonResponse): unknown {
  if (res.status >= 200 && res.status < 300) return res.body;
  throw new UpstreamError(`OpenRouter models request failed (${res.status})`, 'AI_MODELS_ERROR', {
    status: res.status,
  });
}

/** Strip a trailing slash so `${base}/models` never doubles up. */
function trimBase(base: string): string {
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

function toModelListItem(model: RawModel): AiModelListItem {
  const promptPrice = pricePerMillion(model.pricing?.prompt);
  const completionPrice = pricePerMillion(model.pricing?.completion);
  const params = model.supported_parameters ?? [];
  return {
    id: model.id,
    name: model.name ?? model.id,
    provider: deriveModelProvider(model.id),
    displayName: model.name && model.name.trim().length > 0 ? model.name : model.id,
    ...(model.description ? { description: model.description } : {}),
    isFree: isFreeModel(model),
    contextLength: model.context_length ?? model.top_provider?.context_length ?? null,
    promptPricePerMillion: promptPrice,
    completionPricePerMillion: completionPrice,
    supportsTools: params.includes('tools') || params.includes('tool_choice'),
    supportsStructuredOutput:
      params.includes('response_format') ||
      params.includes('structured_outputs') ||
      params.includes('structured_output'),
  };
}

/** Free by slug convention OR by all-zero pricing (prices may be strings). */
function isFreeModel(model: RawModel): boolean {
  if (isFreeModelId(model.id)) return true;
  const p = model.pricing;
  return isZeroPrice(p?.prompt) && isZeroPrice(p?.completion) && isZeroPrice(p?.request);
}

/** USD-per-token → USD-per-million; null when the price is absent/unparseable. */
function pricePerMillion(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n * 1_000_000;
}

/**
 * Keep a model only if it can take text in AND emit text out. When the wire
 * gives us no modality info we assume text (avoid dropping valid models over
 * schema drift); we filter only when the data POSITIVELY says non-text.
 */
function supportsText(model: RawModel): boolean {
  const arch = model.architecture;
  const input = arch?.input_modalities;
  const output = arch?.output_modalities;

  const textIn = input ? input.includes('text') : modalitySideHasText(arch?.modality, 'in');
  const textOut = output ? output.includes('text') : modalitySideHasText(arch?.modality, 'out');
  return textIn && textOut;
}

/** Parse the older `"text+image->text"` modality string; unknown → assume text. */
function modalitySideHasText(modality: string | undefined, side: 'in' | 'out'): boolean {
  if (!modality || !modality.includes('->')) return true;
  const [lhs, rhs] = modality.split('->');
  return (side === 'in' ? lhs : rhs)?.includes('text') ?? true;
}

function isExpired(value: string | number | null | undefined, nowMs: number): boolean {
  if (value === undefined || value === null || value === '') return false;
  const ms = typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : Date.parse(value);
  if (!Number.isFinite(ms)) return false;
  return ms < nowMs;
}
