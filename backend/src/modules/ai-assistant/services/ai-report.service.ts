import { NotImplementedError } from '../../../shared/errors/not-implemented.error.js';

// Phase 2 — builds messages from prompts/report-narrative.<type>.ts, calls the
// provider with AI_MODEL_DEFAULT and returns a narrative + factor list.
// Read-only: never writes domain data.
export class AiReportService {
  async narrative(): Promise<never> {
    throw new NotImplementedError('AI report narratives arrive in Phase 2', 'AI_NOT_IMPLEMENTED');
  }
}
