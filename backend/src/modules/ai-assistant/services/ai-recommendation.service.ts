import { NotImplementedError } from '../../../shared/errors/not-implemented.error.js';

// Phase 4 — save-guards (cost/payment sanity warnings that NEVER block saving)
// and pattern-derived recommendations. Impactful suggestions are returned as
// PENDING and only applied through the explicit approval endpoint.
export class AiRecommendationService {
  async guardCost(): Promise<never> {
    throw new NotImplementedError('AI save-guards arrive in Phase 4', 'AI_NOT_IMPLEMENTED');
  }

  async guardPayment(): Promise<never> {
    throw new NotImplementedError('AI save-guards arrive in Phase 4', 'AI_NOT_IMPLEMENTED');
  }

  async listRecommendations(): Promise<never> {
    throw new NotImplementedError('AI recommendations arrive in Phase 4', 'AI_NOT_IMPLEMENTED');
  }
}
