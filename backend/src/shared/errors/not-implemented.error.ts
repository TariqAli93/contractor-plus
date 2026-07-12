import { AppError } from './app-error.js';

/**
 * 501 — the endpoint/service is scaffolded but its feature phase has not
 * landed yet (ai-assistant phased rollout). Not retryable: the same request
 * fails until the phase ships.
 */
export class NotImplementedError extends AppError {
  constructor(message = 'Not implemented yet', code = 'NOT_IMPLEMENTED') {
    super(501, code, message);
  }
}
