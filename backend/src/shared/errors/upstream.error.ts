import { AppError } from './app-error.js';

/**
 * 502 — a required upstream (the LLM gateway, an integration provider) is
 * unavailable. Not the user's fault, and retryable once the upstream recovers
 * (BACKEND.md §14.1; INTEGRATIONS.md §12).
 */
export class UpstreamError extends AppError {
  constructor(message = 'An upstream service is unavailable', code = 'PROVIDER_DOWN', details?: unknown) {
    super(502, code, message, details, true);
  }
}
