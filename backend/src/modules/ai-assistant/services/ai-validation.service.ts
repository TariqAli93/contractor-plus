import { NotImplementedError } from '../../../shared/errors/not-implemented.error.js';

// Phase 3 — THE security gate of the NL→report path: validates model output
// against a closed report-type + filter whitelist (ai-query.schema.ts) and
// rejects anything outside it. No query executes without passing here.
// This service gets dedicated tests when it lands.
export class AiValidationService {
  async validateQuery(): Promise<never> {
    throw new NotImplementedError('AI query validation arrives in Phase 3', 'AI_NOT_IMPLEMENTED');
  }
}
