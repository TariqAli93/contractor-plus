import { NotImplementedError } from '../../../shared/errors/not-implemented.error.js';

// Phase 2 — normalises ReportsService results (CashFlow, DelayedProjects,
// OverduePayments, ProjectProfitability) into sensitive-field-free DTOs the
// prompt builders consume. Reads ONLY via the reports module's public service.
export class AiContextService {
  async buildReportContext(): Promise<never> {
    throw new NotImplementedError('AI report context arrives in Phase 2', 'AI_NOT_IMPLEMENTED');
  }
}
