import { NotImplementedError } from '../../../shared/errors/not-implemented.error.js';

// Phase 5 — scheduled fetch of external material reference prices inside the
// backend Windows Service (never Electron), appended to MaterialReferencePrice
// via the module repository. Offline-tolerant: failures are silent + logged.
export class AiMaterialPricesService {
  async syncPrices(): Promise<never> {
    throw new NotImplementedError('Material price sync arrives in Phase 5', 'AI_NOT_IMPLEMENTED');
  }
}
