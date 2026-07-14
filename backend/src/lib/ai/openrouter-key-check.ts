// Phase 2.5 — lightweight validation of an OpenRouter key BEFORE it is stored.
// Hits GET /key (auth-required, does NOT consume credits), so a valid-but-
// depleted key still validates. Never logs the key.

export type KeyCheckResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'unreachable' };

export interface OpenRouterKeyCheckOptions {
  baseUrl: string;
  timeoutMs?: number;
  /** Injectable for unit tests. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function checkOpenRouterKey(
  rawKey: string,
  options: OpenRouterKeyCheckOptions,
): Promise<KeyCheckResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${options.baseUrl}/key`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${rawKey}` },
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    // Can't reach OpenRouter — do NOT accept a key we couldn't confirm.
    return { ok: false, reason: 'unreachable' };
  }
  if (response.status === 200) return { ok: true };
  if (response.status === 401 || response.status === 403) return { ok: false, reason: 'invalid' };
  // Any other status is unverifiable; refuse rather than store blindly.
  return { ok: false, reason: 'unreachable' };
}
