/** The token substituted for any redacted value. */
export const REDACTED = '[REDACTED]';

const MAX_DEPTH = 12;

/**
 * Keys whose VALUES are secrets, matched case-insensitively at ANY nesting
 * depth. The patterns are deliberately specific so that non-secret fields which
 * merely contain a sensitive word are NOT over-redacted:
 *  - `passwordHash`, `tokenHash`, `refreshToken`, `apiKey`, `authorization`,
 *    `cookie`, `passphrase`, `clientSecret` → redacted.
 *  - `promptTokens`, `tokenCount` → NOT redacted (they are metrics, not secrets).
 */
const SECRET_KEY =
  /(password|passphrase|secret|credential|authorization|apikey|api[_-]?key|private[_-]?key|(access|refresh|csrf|session|bearer|jwt)[_-]?token|token[_-]?hash|refresh[_-]?token)/i;

// The `cookie` header carries the session; match it exactly so unrelated keys
// such as `cookieConsent` are left alone.
const COOKIE_KEY = /^set-cookie$|^cookie$/i;

function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key) || COOKIE_KEY.test(key);
}

/**
 * Return a deep copy of `value` with the value of any secret-named key replaced
 * by {@link REDACTED}, at every depth. Cycles are broken with `[Circular]` and
 * depth is bounded, so it is safe on arbitrary log payloads (request objects,
 * integration configs, AI plan args).
 *
 * WHY RECURSIVE AND NOT pino's `redact` PATHS: pino's path syntax cannot express
 * "any secret key at any depth" — a nested `integration.config.apiKey` needs a
 * literal path. A financial system logs deeply-nested objects (a serialized
 * request, a provider config), and a single missed path is a leaked secret. A
 * key-name walk covers depth uniformly (SECURITY.md §5, §10.1).
 */
export function redactSecrets(value: unknown): unknown {
  return walk(value, new WeakSet<object>(), 0);
}

function walk(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (depth > MAX_DEPTH) return '[MaxDepth]';
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, seen, depth + 1));
  }

  if (value instanceof Error) {
    // Preserve the error's shape for pino's serializer; redact any secret
    // fields an error might carry (e.g. a wrapped request).
    const out: Record<string, unknown> = { message: value.message, name: value.name };
    if (value.stack) out.stack = value.stack;
    for (const [k, v] of Object.entries(value)) {
      out[k] = isSecretKey(k) ? REDACTED : walk(v, seen, depth + 1);
    }
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSecretKey(k) ? REDACTED : walk(v, seen, depth + 1);
  }
  return out;
}
